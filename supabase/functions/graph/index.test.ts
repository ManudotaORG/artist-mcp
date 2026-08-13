/**
 * Tests for the pure transformations in the Graph function.
 *
 * These are the parts that fail silently. A broken decode does not throw, it
 * returns plausible-looking rubbish, and a MIME walk that misses a nesting
 * level returns an empty body that reads as "the email had no content".
 *
 * Run with: deno test supabase/functions/graph/index.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  decodeBody,
  decodeBytes,
  describeGaps,
  eventTime,
  extractAttachments,
  extractPdfContent,
  extractText,
  htmlToText,
  shapeEvent,
  thinRecurring,
} from "./index.ts";

/** Encode as Gmail does: base64url, padding stripped. */
const gmailEncode = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

Deno.test("decodeBody reads plain base64url", () => {
  assertEquals(decodeBody(gmailEncode("Soundcheck at 17:00")), "Soundcheck at 17:00");
});

Deno.test("decodeBody survives stripped padding at every length", () => {
  // Gmail drops '=' padding. A decoder that forwards the string to atob
  // unchanged throws on exactly the lengths where padding was removed, so all
  // three residues are covered rather than whichever the first sample hit.
  for (const text of ["a", "ab", "abc", "abcd", "abcde"]) {
    assertEquals(decodeBody(gmailEncode(text)), text, `round trip failed for ${text!}`);
  }
});

Deno.test("decodeBody handles the - and _ alphabet", () => {
  // Bytes chosen so standard base64 produces both + and /, which become - and
  // _ in base64url. Feeding those to atob unchanged is the classic failure.
  const raw = String.fromCharCode(0xfb, 0xff, 0xbf, 0xfe);
  const standard = btoa(raw);
  const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (!/[-_]/.test(urlSafe)) throw new Error("fixture no longer exercises - or _");

  const decoded = decodeBody(urlSafe);
  assertEquals([...decoded].length > 0, true);
});

Deno.test("decodeBody reassembles multi-byte UTF-8", () => {
  // Accented names and punctuation are the norm in this corpus, not the edge
  // case: atob yields bytes, and treating them as characters mangles these.
  const text = "Müller — café, naïve, 日本語";
  assertEquals(decodeBody(gmailEncode(text)), text);
});

Deno.test("decodeBody returns empty string on malformed input", () => {
  // A throw here would fail the whole read_email call for one bad part.
  assertEquals(decodeBody("!!!not base64!!!"), "");
});

Deno.test("extractText prefers text/plain over text/html", () => {
  const part = {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: gmailEncode("plain wins") } },
      { mimeType: "text/html", body: { data: gmailEncode("<p>html loses</p>") } },
    ],
  };
  assertEquals(extractText(part), "plain wins");
});

Deno.test("extractText falls back to html when there is no plain part", () => {
  const part = {
    mimeType: "multipart/alternative",
    parts: [{ mimeType: "text/html", body: { data: gmailEncode("<p>Fee: <b>800</b></p>") } }],
  };
  assertStringIncludes(extractText(part), "Fee: 800");
});

Deno.test("extractText descends nested multipart with attachments", () => {
  // The shape a real booking email arrives in: mixed(alternative(plain, html),
  // attachment). Reading payload.body directly finds nothing here.
  const part = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: gmailEncode("Contract attached.") } },
          { mimeType: "text/html", body: { data: gmailEncode("<p>Contract attached.</p>") } },
        ],
      },
      { mimeType: "application/pdf", body: { size: 1024 } },
    ],
  };
  assertEquals(extractText(part), "Contract attached.");
});

Deno.test("extractText returns empty string for an attachment-only message", () => {
  const part = {
    mimeType: "multipart/mixed",
    parts: [{ mimeType: "application/pdf", body: { size: 1024 } }],
  };
  assertEquals(extractText(part), "");
});

Deno.test("extractText tolerates a missing payload", () => {
  assertEquals(extractText(undefined), "");
});

Deno.test("extractAttachments finds attachments nested beside the body", () => {
  const part = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: gmailEncode("Contract attached.") } },
        ],
      },
      {
        mimeType: "application/pdf",
        filename: "contract.pdf",
        body: { size: 240_000, attachmentId: "att-1" },
      },
    ],
  };
  // The id is the MIME position, not Gmail's attachmentId — that one is minted
  // fresh on every fetch and is useless the moment it is quoted back.
  assertEquals(extractAttachments(part), [
    {
      id: "2",
      gmail_id: "att-1",
      filename: "contract.pdf",
      mime_type: "application/pdf",
      size: 240_000,
    },
  ]);
});

Deno.test("extractAttachments ignores body parts, which carry no attachmentId", () => {
  const part = {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: gmailEncode("No files here.") } },
      { mimeType: "text/html", body: { data: gmailEncode("<p>No files here.</p>") } },
    ],
  };
  assertEquals(extractAttachments(part), []);
});

Deno.test("extractAttachments names an attachment that arrives without a filename", () => {
  // Some senders omit it; "(unnamed)" is still fetchable by id, an empty
  // string in a list of files is not.
  const part = {
    mimeType: "multipart/mixed",
    parts: [{ mimeType: "image/jpeg", body: { size: 900, attachmentId: "att-2" } }],
  };
  assertEquals(extractAttachments(part), [
    {
      id: "1",
      gmail_id: "att-2",
      filename: "(unnamed)",
      mime_type: "image/jpeg",
      size: 900,
    },
  ]);
});

Deno.test("extractAttachments tolerates a missing payload", () => {
  assertEquals(extractAttachments(undefined), []);
});

Deno.test("extractAttachments numbers nested parts by their position", () => {
  // Positions have to survive a re-fetch, because that is the whole reason they
  // are handed out instead of Gmail's ids. Nesting is where an off-by-one would
  // silently point at the wrong file rather than at nothing.
  const part = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/related",
        parts: [
          { mimeType: "text/plain", body: {} },
          { mimeType: "image/png", filename: "plan.png", body: { attachmentId: "x" } },
        ],
      },
      { mimeType: "application/pdf", filename: "rider.pdf", body: { attachmentId: "y" } },
    ],
  };
  assertEquals(
    extractAttachments(part).map((a) => `${a.id}:${a.filename}`),
    ["1.2:plan.png", "2:rider.pdf"],
  );
});

Deno.test("extractAttachments gives the same position on a re-fetch", () => {
  // The bug this replaced: Gmail returned two different 404-character ids for
  // one file, seconds apart, so an id quoted back matched nothing. Positions
  // are derived from structure, so a second fetch agrees with the first.
  const fetched = (gmailId: string) => ({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: {} },
      {
        mimeType: "application/pdf",
        filename: "rider.pdf",
        body: { size: 601_599, attachmentId: gmailId },
      },
    ],
  });
  const first = extractAttachments(fetched("ANGjdJ9sb_GR_iN_6rGj3tTV"));
  const second = extractAttachments(fetched("ANGjdJ94Td7H9bUMt9ASALTB"));

  assertEquals(first[0].id, second[0].id);
  assertEquals(first[0].id, "2");
  // The volatile handle still differs, and each read must use its own.
  assert(first[0].gmail_id !== second[0].gmail_id);
});

Deno.test("decodeBytes keeps a PDF's bytes intact", () => {
  // decodeBody would hand back mojibake here: a PDF is not text.
  const raw = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0x00, 0x80]);
  const encoded = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assertEquals(decodeBytes(encoded), raw);
});

type PageSpec = { text?: string | null; image?: { width: number; height: number } };

/**
 * Build a PDF by hand, one content stream per page.
 *
 * A page given no text draws nothing, which is how a page carrying only a
 * scanned image looks to a text extractor — the case a real rider's stage plan
 * lands in. A page can also be given an image, so the combination that matters
 * most (prose and a diagram together) is expressible. Generating these beats
 * committing someone's actual contract.
 *
 * Image data goes in as ASCIIHexDecode: it keeps every byte of the file
 * printable, so the whole generator stays a string.
 */
function minimalPdf(specs: (string | null | PageSpec)[]): Uint8Array {
  const pages: PageSpec[] = specs.map((spec) =>
    spec === null || typeof spec === "string" ? { text: spec } : spec
  );
  const objects: string[] = [];
  const kids: string[] = [];
  // 1 = catalogue, 2 = page tree, 3 = font, then a page, a stream and
  // optionally an image per page.
  let next = 4;
  pages.forEach(({ text, image }) => {
    const pageObj = next++;
    const streamObj = next++;
    const imageObj = image ? next++ : null;
    kids.push(`${pageObj} 0 R`);

    const xobject = imageObj ? ` /XObject << /Im0 ${imageObj} 0 R >>` : "";
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >>${xobject} >> /Contents ${streamObj} 0 R >>`;

    // Laid out as lines rather than one enormous string: a single Tj does not
    // survive extraction intact past a hundred characters or so, and a real
    // page is lines anyway.
    const lines = (text ?? "").match(/.{1,80}/g) ?? [];
    const drawText = text == null
      ? ""
      : `BT /F1 12 Tf 72 720 Td 14 TL\n` +
        lines
          .map((line) => `(${line.replace(/[()\\]/g, "\\$&")}) Tj T*`)
          .join("\n") +
        `\nET\n`;
    // q/cm/Do: scale the unit image square up to something page-sized.
    const drawImage = image ? `q 400 0 0 500 100 100 cm /Im0 Do Q` : "";
    const content = `${drawText}${drawImage}`;
    objects[streamObj] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

    if (image && imageObj) {
      // Mid-grey throughout: the encoder only has to survive it, not read it.
      const hex = "80".repeat(image.width * image.height * 3);
      objects[imageObj] =
        `<< /Type /XObject /Subtype /Image /Width ${image.width} ` +
        `/Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /ASCIIHexDecode /Length ${hex.length + 1} >>\n` +
        `stream\n${hex}>\nendstream`;
    }
  });
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

/** A page's worth of prose: anything shorter reads as a header, by design. */
const page = (text: string) =>
  `${text} ${"The Promoter shall provide sound, lighting and hospitality. ".repeat(4)}`;

Deno.test("extractPdfContent reads a text PDF and labels its pages", async () => {
  const result = await extractPdfContent(minimalPdf([page("Fee: EUR 2400 net")]));
  assertStringIncludes(result.text, "Fee: EUR 2400 net");
  assertStringIncludes(result.text, "[page 1]");
  assertEquals(result.pages_total, 1);
  assertEquals(result.pages_without_text, []);
  assertEquals(result.truncated, false);
});

Deno.test("extractPdfContent names the page a stage plan would occupy", async () => {
  // The shape that matters: prose extracts, one page is a diagram. Reporting
  // per document would call this a clean read and lose page 2 in silence.
  const result = await extractPdfContent(
    minimalPdf([page("Soundcheck at 17:00"), null, page("Patch list: SM57 on snare")]),
  );
  assertEquals(result.pages_total, 3);
  assertEquals(result.pages_without_text, [2]);
  assertStringIncludes(result.text, "Soundcheck at 17:00");
  assertStringIncludes(result.text, "[page 3]");
});

Deno.test("extractPdfContent sees past a letterhead on an image-only page", async () => {
  // The regression that a zero-length check misses. Riders are letterheaded,
  // so the page that is nothing but a stage plan still returns its running
  // header — measured at 99 characters against 1,633+ on prose pages. Treating
  // that as content reports a clean read and loses the stage plan silently.
  const header = "TECHNICAL RIDER, SOUND, BACKLINE, LIGHTS (page 2 / 3)";
  const result = await extractPdfContent(
    minimalPdf([
      `${header} ${"Soundcheck at 17:00. ".repeat(20)}`,
      header,
      `${header} ${"Patch list: SM57 on snare. ".repeat(20)}`,
    ]),
  );
  assertEquals(result.pages_without_text, [2]);
  // The header must not survive as though it were the page's contents.
  assertEquals(result.text.includes("[page 2]"), false);
});

Deno.test("extractPdfContent reports a scan as having no text at all", async () => {
  const result = await extractPdfContent(minimalPdf([null, null]));
  assertEquals(result.text, "");
  assertEquals(result.pages_total, 2);
  assertEquals(result.pages_without_text, [1, 2]);
});

Deno.test("extractPdfContent finds a diagram on a page that also has text", async () => {
  // The gap that text-emptiness detection cannot see: a floor plan under two
  // paragraphs. The page reads as a clean extraction, so keying image
  // detection off "this page gave no text" would never mention the picture.
  const result = await extractPdfContent(
    minimalPdf([
      { text: page("Stage layout follows"), image: { width: 600, height: 400 } },
    ]),
  );
  assertEquals(result.pages_without_text, []);
  assertEquals(result.images.length, 1);
  assertEquals(result.images[0].page, 1);
  assertStringIncludes(result.text, "Stage layout follows");
});

Deno.test("extractPdfContent ignores a letterhead-sized image", async () => {
  // A logo is not a diagram. The measured pair was 0.11 MP of letterhead
  // against 4.84 MP of stage plan, which is what the floor sits between.
  const result = await extractPdfContent(
    minimalPdf([{ text: page("Dear organiser"), image: { width: 120, height: 40 } }]),
  );
  assertEquals(result.images, []);
});

Deno.test("extractPdfContent returns a PNG that decodes to the right size", async () => {
  // The encoder is hand-rolled, so a malformed header would travel all the way
  // to a client as a broken picture rather than failing here.
  const result = await extractPdfContent(
    minimalPdf([{ image: { width: 600, height: 400 } }]),
  );
  assertEquals(result.images.length, 1);
  const png = Uint8Array.from(atob(result.images[0].data), (c) => c.charCodeAt(0));
  assertEquals([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  // IHDR payload starts at byte 16: width then height.
  assertEquals(view.getUint32(16), result.images[0].width);
  assertEquals(view.getUint32(20), result.images[0].height);
  assertEquals(new TextDecoder().decode(png.subarray(12, 16)), "IHDR");
});

Deno.test("extractPdfContent caps how many images it returns", async () => {
  const pages = Array.from({ length: 5 }, () => ({
    image: { width: 600, height: 400 },
  }));
  const result = await extractPdfContent(minimalPdf(pages));
  assertEquals(result.images.length, 3);
  // The call ends when the image budget is spent, and says where to resume;
  // the remaining pages are reachable rather than quietly dropped.
  assertEquals(result.pages_read, 3);
  assertEquals(result.next_from_page, 4);
});

/** Defaults for a clean 7-page read; each test bends only what it is about. */
const extraction = (over: Partial<Parameters<typeof describeGaps>[0]> = {}) => ({
  text: "a".repeat(5000),
  pages_total: 7,
  pages_read: 7,
  pages_without_text: [],
  images: [],
  pages_with_skipped_images: [],
  pages_searched_for_images: 7,
  ...over,
});

Deno.test("describeGaps stays quiet when nothing was missed", () => {
  assertEquals(describeGaps(extraction()), null);
});

Deno.test("describeGaps distinguishes a shown diagram from a lost one", () => {
  const shown = describeGaps(extraction({
    pages_without_text: [6],
    images: [{ page: 6, width: 500, height: 800, media_type: "image/png", data: "" }],
  }));
  assertStringIncludes(shown!, "attached below");
  assertEquals(shown!.includes("do not describe"), false);

  const lost = describeGaps(extraction({ pages_without_text: [6] }));
  assertStringIncludes(lost!, "could not be recovered");
  assertStringIncludes(lost!, "do not describe");
});

Deno.test("describeGaps flags a diagram on a page that also had text", () => {
  const note = describeGaps(extraction({
    images: [{ page: 4, width: 500, height: 800, media_type: "image/png", data: "" }],
  }));
  assertStringIncludes(note!, "Page 4");
  assertStringIncludes(note!, "does not describe it");
});

Deno.test("describeGaps admits which pages were never searched", () => {
  // The difference between "no more diagrams" and "nobody looked" is the whole
  // reason this sentence exists.
  const note = describeGaps(extraction({
    pages_read: 7,
    pages_searched_for_images: 3,
    images: [
      { page: 1, width: 10, height: 10, media_type: "image/png", data: "" },
      { page: 2, width: 10, height: 10, media_type: "image/png", data: "" },
      { page: 3, width: 10, height: 10, media_type: "image/png", data: "" },
    ],
  }));
  assertStringIncludes(note!, "pages 4 to 7 were not searched");
});

Deno.test("describeGaps says a full scan is unreadable exactly once", () => {
  // Observed on a real scanned attachment: the whole-file sentence and the
  // per-page sentence both fired, so one problem was reported as two.
  const note = describeGaps(extraction({
    text: "",
    pages_total: 1,
    pages_read: 1,
    pages_without_text: [1],
    pages_searched_for_images: 1,
  }));
  assertEquals(note!.match(/recovered/g)?.length, 1);
  assertStringIncludes(note!, "appears to be a scan");
});

Deno.test("describeGaps still names unrecovered pages of a partly recovered scan", () => {
  // The suppression above must not hide a real gap: when some pages came back
  // as pictures and others did not, the ones that did not still matter.
  const note = describeGaps(extraction({
    text: "",
    pages_total: 3,
    pages_read: 3,
    pages_without_text: [1, 2, 3],
    pages_searched_for_images: 3,
    images: [{ page: 1, width: 10, height: 10, media_type: "image/png", data: "" }],
  }));
  assertStringIncludes(note!, "Pages 2, 3");
});

Deno.test("describeGaps does not claim recovery failed on pages it never searched", () => {
  // An 8-page scan: the image cap stops the search at page 3, so pages 4-8
  // were never attempted. Reporting them as "could not be recovered" is false,
  // contradicts the sentence that says they were not searched, and is the more
  // reassuring of the two readings.
  const note = describeGaps(extraction({
    text: "",
    pages_total: 8,
    pages_read: 8,
    pages_without_text: [1, 2, 3, 4, 5, 6, 7, 8],
    pages_searched_for_images: 3,
    images: [1, 2, 3].map((page) => ({
      page,
      width: 900,
      height: 1200,
      media_type: "image/png" as const,
      data: "",
    })),
  }));
  assertEquals(note!.includes("could not be recovered"), false);
  assertStringIncludes(note!, "pages 4 to 8 were not searched");
  // And it should say how much of the document actually came back.
  assertStringIncludes(note!, "3 of its 8 pages are attached");
});

Deno.test("describeGaps calls a scan a scan", () => {
  const note = describeGaps(extraction({
    text: "",
    pages_without_text: [1, 2],
    pages_total: 2,
    pages_read: 2,
  }));
  assertStringIncludes(note!, "appears to be a scan");
  assertStringIncludes(note!, "have not been read");
});

Deno.test("extractPdfContent starts where it is told and says where to resume", async () => {
  const pdf = minimalPdf([
    page("Clause one"),
    page("Clause two"),
    page("Clause three"),
  ]);
  const rest = await extractPdfContent(pdf, 2);

  assertEquals(rest.first_page, 2);
  assertEquals(rest.pages_read, 3);
  assertEquals(rest.next_from_page, null);
  assertStringIncludes(rest.text, "Clause two");
  // Pages before the start are absent, not silently folded in.
  assertEquals(rest.text.includes("Clause one"), false);
});

Deno.test("extractPdfContent walks a whole scan across successive calls", async () => {
  // The case that motivated the range: a scanned document is entirely
  // pictures, so the image cap alone would return three pages of eight and
  // call the rest unread. Successive calls have to cover it without gaps or
  // repeats.
  const pdf = minimalPdf(
    Array.from({ length: 8 }, () => ({ image: { width: 600, height: 400 } })),
  );

  const seen: number[] = [];
  let from: number | null = 1;
  let calls = 0;
  while (from !== null && calls < 10) {
    const part = await extractPdfContent(pdf, from);
    for (const img of part.images) seen.push(img.page);
    assertEquals(part.first_page, from);
    from = part.next_from_page;
    calls++;
  }

  assertEquals(from, null, "the walk must terminate");
  assertEquals(seen, [1, 2, 3, 4, 5, 6, 7, 8]);
});

Deno.test("extractPdfContent reads only the window it is given", async () => {
  const pdf = minimalPdf([1, 2, 3, 4, 5].map((n) => page(`Clause ${n}`)));
  const result = await extractPdfContent(pdf, 2, 2);

  assertEquals(result.first_page, 2);
  assertEquals(result.pages_read, 3);
  assertEquals(result.next_from_page, 4);
  assertStringIncludes(result.text, "Clause 2");
  assertEquals(result.text.includes("Clause 4"), false);
});

Deno.test("extractPdfContent caps a window that asks for too much", async () => {
  // Otherwise the window is a way to request an entire document in one call,
  // which is the thing every other cap here exists to prevent.
  const pdf = minimalPdf(
    Array.from({ length: 30 }, (_, n) => page(`Clause ${n + 1}`)),
  );
  const result = await extractPdfContent(pdf, 1, 500);
  assert(result.pages_read <= 10, `read ${result.pages_read} pages`);
  assertEquals(result.next_from_page, result.pages_read + 1);
});

Deno.test("describeGaps declines to walk a scan too large to finish", () => {
  // A hundred pages of pictures is about 150k tokens. Advertising the next
  // page invites a walk that ends in a wall thirty calls later, so the answer
  // states the scale and points at targeted pages instead.
  const note = describeGaps(extraction({
    text: "",
    pages_total: 100,
    first_page: 1,
    pages_read: 3,
    pages_without_text: [1, 2, 3],
    pages_searched_for_images: 3,
    next_from_page: 4,
    images: [1, 2, 3].map((page) => ({
      page,
      width: 900,
      height: 1200,
      media_type: "image/png" as const,
      data: "",
    })),
  }));
  assertStringIncludes(note!, "100-page document of page images");
  assertStringIncludes(note!, "150k tokens");
  assertStringIncludes(note!, "do not page");
  // The invitation to continue sequentially must not also be present.
  assertEquals(note!.includes("calling again with from_page"), false);
});

Deno.test("describeGaps still offers the walk for a scan that can finish", () => {
  const note = describeGaps(extraction({
    text: "",
    pages_total: 8,
    first_page: 1,
    pages_read: 3,
    pages_without_text: [1, 2, 3],
    pages_searched_for_images: 3,
    next_from_page: 4,
    images: [{ page: 1, width: 900, height: 1200, media_type: "image/png", data: "" }],
  }));
  assertStringIncludes(note!, "calling again with from_page 4");
});

Deno.test("extractPdfContent returns every page of a window it was asked for", async () => {
  // The window raises the image budget with it. Otherwise asking for four
  // pages of a scan returns three, silently, and the fourth looks blank.
  const pdf = minimalPdf(
    Array.from({ length: 6 }, () => ({ image: { width: 600, height: 400 } })),
  );
  const result = await extractPdfContent(pdf, 2, 4);
  assertEquals(result.images.map((i) => i.page), [2, 3, 4, 5]);
});

Deno.test("describeGaps drops the large-file advice for a targeted read", () => {
  // Someone asking for pages 12-15 has already made the judgement that advice
  // exists to prompt; repeating it reads as not having listened.
  const note = describeGaps(extraction({
    text: "",
    pages_total: 100,
    first_page: 12,
    pages_read: 15,
    pages_without_text: [12, 13, 14, 15],
    pages_searched_for_images: 15,
    targeted: true,
    next_from_page: null,
    images: [12, 13, 14, 15].map((page) => ({
      page,
      width: 900,
      height: 1200,
      media_type: "image/png" as const,
      data: "",
    })),
  }));
  assertEquals(note!.includes("do not page"), false);
  assertStringIncludes(note!, "4 of its 100 pages are attached");
});

Deno.test("extractPdfContent clamps a start page past the end", async () => {
  // Rather than returning an empty read that looks like an empty document.
  const result = await extractPdfContent(minimalPdf([page("Only page")]), 99);
  assertEquals(result.first_page, 1);
  assertEquals(result.next_from_page, null);
});

Deno.test("extractPdfContent stops early rather than reading every page", async () => {
  // The memory guard: a long document must not be read in full and trimmed
  // afterwards. 2000 chars a page means the 40k cap lands well before page 40.
  const pages = Array.from({ length: 40 }, () => "x".repeat(2000));
  const result = await extractPdfContent(minimalPdf(pages));
  assertEquals(result.pages_total, 40);
  assertEquals(result.truncated, true);
  assert(result.pages_read < 40, `read ${result.pages_read} of 40 pages`);
  assert(result.text.length <= 40_000, `got ${result.text.length} chars`);
});

Deno.test("htmlToText decodes the entities Gmail and OneNote both emit", () => {
  // Shared with the OneNote path deliberately; a second stripper would drift.
  assertEquals(htmlToText("<p>M&#252;ller &amp; Sons</p>"), "Müller & Sons");
});

// ------------------------------------------------------------ calendar shaping

Deno.test("eventTime reads a timed event", () => {
  assertEquals(
    eventTime({ dateTime: "2026-09-14T19:30:00+02:00", timeZone: "Europe/Madrid" }),
    { value: "2026-09-14T19:30:00+02:00", all_day: false, time_zone: "Europe/Madrid" },
  );
});

Deno.test("eventTime reads an all-day event", () => {
  // A festival or tour block arrives as `date`, never `dateTime`. Code that
  // reads only dateTime returns null here and the event looks contentless.
  assertEquals(
    eventTime({ date: "2026-09-14" }),
    { value: "2026-09-14", all_day: true, time_zone: null },
  );
});

Deno.test("eventTime tolerates a missing time", () => {
  assertEquals(eventTime(undefined), { value: null, all_day: false, time_zone: null });
});

Deno.test("shapeEvent keeps an all-day event's dates", () => {
  const e = shapeEvent({
    id: "abc",
    summary: "Tour block",
    start: { date: "2026-09-14" },
    end: { date: "2026-09-18" },
  });
  assertEquals(e.start, "2026-09-14");
  assertEquals(e.end, "2026-09-18");
  assertEquals(e.all_day, true);
});

Deno.test("shapeEvent flags a recurring instance", () => {
  // "every Tuesday" and "this Tuesday" are different claims about a page, so
  // the distinction has to survive into the output.
  const once = shapeEvent({ id: "a", start: { dateTime: "2026-09-14T10:00:00Z" } });
  const series = shapeEvent({
    id: "b_20260914T100000Z",
    recurringEventId: "b",
    start: { dateTime: "2026-09-14T10:00:00Z" },
  });
  assertEquals(once.recurring, false);
  assertEquals(series.recurring, true);
});

Deno.test("shapeEvent falls back to a placeholder title", () => {
  assertEquals(shapeEvent({ id: "a" }).summary, "(no title)");
});

Deno.test("shapeEvent carries the time zone from whichever end has one", () => {
  const e = shapeEvent({
    id: "a",
    start: { dateTime: "2026-09-14T19:30:00+02:00" },
    end: { dateTime: "2026-09-14T22:00:00+02:00", timeZone: "Europe/Madrid" },
  });
  assertEquals(e.time_zone, "Europe/Madrid");
});

Deno.test("shapeEvent preserves status so a cancelled event reads as cancelled", () => {
  assertEquals(shapeEvent({ id: "a", status: "cancelled" }).status, "cancelled");
});

Deno.test("thinRecurring caps one series without touching single events", () => {
  // The shape a real calendar produced: a weekly rehearsal expanded to 50
  // occurrences and pushed every other event off the page.
  const events = [
    { id: "concert", start: { dateTime: "2026-08-14T15:00:00Z" } },
    ...Array.from({ length: 50 }, (_, i) => ({
      id: `r_${i}`,
      recurringEventId: "rehearsal",
      start: { dateTime: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T14:00:00Z` },
    })),
    { id: "tour", start: { date: "2026-08-20" } },
  ];

  const { kept, omitted } = thinRecurring(events, 3);
  assertEquals(omitted, 47);
  assertEquals(kept.filter((e) => e.recurringEventId).length, 3);
  // Both one-off events survive, which is the point of the exercise.
  assertEquals(kept.some((e) => e.id === "concert"), true);
  assertEquals(kept.some((e) => e.id === "tour"), true);
});

Deno.test("thinRecurring counts each series separately", () => {
  const events = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, recurringEventId: "a" })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, recurringEventId: "b" })),
  ];
  const { kept, omitted } = thinRecurring(events, 2);
  assertEquals(kept.length, 4);
  assertEquals(omitted, 6);
});

Deno.test("thinRecurring leaves a calendar of one-offs alone", () => {
  const events = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}` }));
  const { kept, omitted } = thinRecurring(events, 3);
  assertEquals(kept.length, 10);
  assertEquals(omitted, 0);
});
