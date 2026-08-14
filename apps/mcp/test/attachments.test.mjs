import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeBytes,
  describeGaps,
  docxToText,
  extractDocxContent,
  extractPdfContent,
  extractPdfMap,
  imageResult,
  imageSize,
  unsupportedNote,
} from '../dist/attachments.js';

/**
 * Ported from supabase/functions/graph/index.test.ts alongside the code they
 * cover. These are the parts that fail silently — a broken decode returns
 * plausible rubbish rather than throwing — so they came across with the code
 * rather than being rewritten against it.
 */
/** A PNG's first 24 bytes are enough for imageSize: IHDR is required to be first. */
const pngHeader = (w, h) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

const jpegHeader = (w, h) => {
  // SOI, then an APP0 segment to be skipped, then a real SOF0 carrying the size.
  const b = new Uint8Array(40);
  const v = new DataView(b.buffer);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xe0; v.setUint16(4, 6); // APP0, length 6
  const sof = 10;
  b[sof] = 0xff; b[sof + 1] = 0xc0; v.setUint16(sof + 2, 17);
  v.setUint16(sof + 5, h);
  v.setUint16(sof + 7, w);
  return b;
};

const assertIncludes = (haystack, needle) =>
  assert.ok(
    String(haystack).includes(needle),
    `expected to find ${JSON.stringify(needle)} in ${JSON.stringify(String(haystack).slice(0, 300))}`,
  );

test("imageSize reads dimensions without decoding", () => {
  assert.deepEqual(imageSize(pngHeader(1200, 800)), { width: 1200, height: 800 });
  assert.deepEqual(imageSize(jpegHeader(4032, 3024)), { width: 4032, height: 3024 });
});

test("imageSize returns null rather than guessing", () => {
  assert.deepEqual(imageSize(new Uint8Array(40)), null);
  assert.deepEqual(imageSize(new Uint8Array(4)), null);
});

test("imageSize does not loop forever on a malformed JPEG", () => {
  // A zero-length segment would advance the cursor by nothing. Real files are
  // truncated and corrupted often enough that this must terminate.
  const b = jpegHeader(100, 100);
  b[2] = 0xff; b[3] = 0xe0;
  new DataView(b.buffer).setUint16(4, 0);
  assert.deepEqual(imageSize(b), null);
});

test("imageResult passes a viewable image through untouched", () => {
  const bytes = pngHeader(1200, 800);
  const result = imageResult(
    { filename: "plan.png", mime_type: "image/png", size: bytes.length },
    bytes,
  );
  assert.deepEqual(result.kind, "image");
  assert.deepEqual(result.images.length, 1);
  assert.deepEqual(result.images[0].width, 1200);
  assert.deepEqual(result.images[0].media_type, "image/png");
  // Untouched: what comes back must decode to exactly what went in.
  const returned = Uint8Array.from(atob(result.images[0].data), (c) => c.charCodeAt(0));
  assert.deepEqual(returned, bytes);
});

test("imageResult names HEIC rather than calling it unsupported", () => {
  // The format an iPhone sends by default, so the most likely to arrive and
  // the one a generic message would explain worst.
  const result = imageResult(
    { filename: "plan.heic", mime_type: "image/heic", size: 900 },
    new Uint8Array(40),
  );
  assert.deepEqual(result.kind, "unsupported");
  assert.deepEqual(result.images, []);
  assertIncludes(result.note, "HEIC");
  assertIncludes(result.note, "JPEG");
});

test("imageResult refuses an image too large to travel, and says how big", () => {
  const big = new Uint8Array(4_000_000);
  big.set(pngHeader(1200, 800).subarray(0, 24));
  const result = imageResult(
    { filename: "photo.png", mime_type: "image/png", size: big.length },
    big,
  );
  assert.deepEqual(result.kind, "too_large");
  assertIncludes(result.note, "3.8 MB");
  // Nothing here can shrink it, and the note must not imply otherwise.
  assertIncludes(result.note, "smaller copy");
});

test("imageResult still attaches an image whose header it cannot read", () => {
  // Unknown dimensions are worth reporting, but not worth refusing over.
  const bytes = new Uint8Array(40);
  bytes[0] = 0x89; bytes[1] = 0x50; bytes[2] = 0x4e; bytes[3] = 0x47;
  const result = imageResult(
    { filename: "odd.png", mime_type: "image/png", size: 40 },
    bytes,
  );
  assert.deepEqual(result.kind, "image");
  assert.deepEqual(result.images[0].width, 0);
});

/** A paragraph as Word writes one. */
const para = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test("docxToText reads paragraphs as lines", () => {
  const xml = `<w:body>${para("Fee: EUR 2400")}${para("Soundcheck at 17:00")}</w:body>`;
  assert.deepEqual(docxToText(xml), "Fee: EUR 2400\nSoundcheck at 17:00");
});

test("docxToText does not mistake table markup for text", () => {
  // <w:t[^>]*> also matches <w:tbl>, <w:tblPr>, <w:tc> and <w:tr>, so a
  // document with a table returned its own markup as prose. Two thirds of a
  // real 43,000-character read turned out to be this.
  const xml =
    `<w:body><w:tbl><w:tblPr><w:tblW w:w="4000"/></w:tblPr>` +
    `<w:tr><w:tc>${para("Venue")}</w:tc><w:tc>${para("Sala Apolo")}</w:tc></w:tr>` +
    `</w:tbl>${para("Fee agreed")}</w:body>`;
  const text = docxToText(xml);
  assert.deepEqual(text.includes("w:tbl"), false, `leaked markup: ${text.slice(0, 80)}`);
  assertIncludes(text, "Venue");
  assertIncludes(text, "Sala Apolo");
  assertIncludes(text, "Fee agreed");
});

test("docxToText decodes entities in the order that matters", () => {
  // &amp; last, or "&amp;lt;" becomes "<" rather than "&lt;".
  const xml = `<w:body>${para("Sound &amp;lt; lights &amp; staging")}</w:body>`;
  assert.deepEqual(docxToText(xml), "Sound &lt; lights & staging");
});

test("docxToText joins the runs Word splits a sentence into", () => {
  // Word breaks a line into runs at every formatting change, including
  // spellcheck boundaries, so a sentence arrives in pieces.
  const xml = `<w:body><w:p><w:r><w:t>Fee: </w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">EUR </w:t></w:r>` +
    `<w:r><w:t>2400</w:t></w:r></w:p></w:body>`;
  assert.deepEqual(docxToText(xml), "Fee: EUR 2400");
});

test("extractDocxContent refuses bytes that are not a Word document", async () => {
  assert.deepEqual(await extractDocxContent(new Uint8Array(64)), null);
  assert.deepEqual(await extractDocxContent(new TextEncoder().encode("%PDF-1.4")), null);
});

test("unsupportedNote says a legacy .doc will never be readable", () => {
  // "Not supported yet" invites waiting. The old binary Word format needs a
  // parser this runtime does not have and is not getting, so the useful answer
  // tells the reader what to ask the sender for.
  const note = unsupportedNote("application/msword", "contract.doc");
  assertIncludes(note, "legacy Word document");
  assertIncludes(note, "PDF or a .docx");
  assert.deepEqual(note.includes("not built yet"), false);
});

test("unsupportedNote distinguishes formats that are merely unbuilt", () => {
  const docx = unsupportedNote(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "rider.docx",
  );
  assertIncludes(docx, "not built yet");

  const image = unsupportedNote("image/jpeg", "stage-plan.jpg");
  assertIncludes(image, "not built yet");
  assertIncludes(image, "stage-plan.jpg");
});

test("unsupportedNote falls back on an extension when the type is generic", () => {
  // Senders and clients mislabel attachments as octet-stream often enough that
  // the filename is the more reliable signal.
  const note = unsupportedNote("application/octet-stream", "contract.doc");
  assertIncludes(note, "legacy Word document");
});

test("decodeBytes keeps a PDF's bytes intact", () => {
  // decodeBody would hand back mojibake here: a PDF is not text.
  const raw = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0x00, 0x80]);
  const encoded = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.deepEqual(decodeBytes(encoded), raw);
});


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
function minimalPdf(specs) {
  const pages = specs.map((spec) =>
    spec === null || typeof spec === "string" ? { text: spec } : spec
  );
  const objects = [];
  const kids = [];
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
  const offsets = [];
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
const page = (text) =>
  `${text} ${"The Promoter shall provide sound, lighting and hospitality. ".repeat(4)}`;

test("extractPdfContent reads a text PDF and labels its pages", async () => {
  const result = await extractPdfContent(minimalPdf([page("Fee: EUR 2400 net")]));
  assertIncludes(result.text, "Fee: EUR 2400 net");
  assertIncludes(result.text, "[page 1]");
  assert.deepEqual(result.pages_total, 1);
  assert.deepEqual(result.pages_without_text, []);
  assert.deepEqual(result.truncated, false);
});

test("extractPdfContent names the page a stage plan would occupy", async () => {
  // The shape that matters: prose extracts, one page is a diagram. Reporting
  // per document would call this a clean read and lose page 2 in silence.
  const result = await extractPdfContent(
    minimalPdf([page("Soundcheck at 17:00"), null, page("Patch list: SM57 on snare")]),
  );
  assert.deepEqual(result.pages_total, 3);
  assert.deepEqual(result.pages_without_text, [2]);
  assertIncludes(result.text, "Soundcheck at 17:00");
  assertIncludes(result.text, "[page 3]");
});

test("extractPdfContent sees past a letterhead on an image-only page", async () => {
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
  assert.deepEqual(result.pages_without_text, [2]);
  // The header must not survive as though it were the page's contents.
  assert.deepEqual(result.text.includes("[page 2]"), false);
});

test("extractPdfContent reports a scan as having no text at all", async () => {
  const result = await extractPdfContent(minimalPdf([null, null]));
  assert.deepEqual(result.text, "");
  assert.deepEqual(result.pages_total, 2);
  assert.deepEqual(result.pages_without_text, [1, 2]);
});

test("extractPdfContent finds a diagram on a page that also has text", async () => {
  // The gap that text-emptiness detection cannot see: a floor plan under two
  // paragraphs. The page reads as a clean extraction, so keying image
  // detection off "this page gave no text" would never mention the picture.
  const result = await extractPdfContent(
    minimalPdf([
      { text: page("Stage layout follows"), image: { width: 600, height: 400 } },
    ]),
  );
  assert.deepEqual(result.pages_without_text, []);
  assert.deepEqual(result.images.length, 1);
  assert.deepEqual(result.images[0].page, 1);
  assertIncludes(result.text, "Stage layout follows");
});

test("extractPdfContent ignores a letterhead-sized image", async () => {
  // A logo is not a diagram. The measured pair was 0.11 MP of letterhead
  // against 4.84 MP of stage plan, which is what the floor sits between.
  const result = await extractPdfContent(
    minimalPdf([{ text: page("Dear organiser"), image: { width: 120, height: 40 } }]),
  );
  assert.deepEqual(result.images, []);
});

test("extractPdfContent returns a PNG that decodes to the right size", async () => {
  // The encoder is hand-rolled, so a malformed header would travel all the way
  // to a client as a broken picture rather than failing here.
  const result = await extractPdfContent(
    minimalPdf([{ image: { width: 600, height: 400 } }]),
  );
  assert.deepEqual(result.images.length, 1);
  const png = Uint8Array.from(atob(result.images[0].data), (c) => c.charCodeAt(0));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  // IHDR payload starts at byte 16: width then height.
  assert.deepEqual(view.getUint32(16), result.images[0].width);
  assert.deepEqual(view.getUint32(20), result.images[0].height);
  assert.deepEqual(new TextDecoder().decode(png.subarray(12, 16)), "IHDR");
});

test("extractPdfContent caps how many images it returns", async () => {
  const pages = Array.from({ length: 5 }, () => ({
    image: { width: 600, height: 400 },
  }));
  const result = await extractPdfContent(minimalPdf(pages));
  assert.deepEqual(result.images.length, 3);
  // The call ends when the image budget is spent, and says where to resume;
  // the remaining pages are reachable rather than quietly dropped.
  assert.deepEqual(result.pages_read, 3);
  assert.deepEqual(result.next_from_page, 4);
});

/** Defaults for a clean 7-page read; each test bends only what it is about. */
const extraction = (over = {}) => ({
  text: "a".repeat(5000),
  pages_total: 7,
  pages_read: 7,
  pages_without_text: [],
  images: [],
  pages_with_skipped_images: [],
  pages_searched_for_images: 7,
  ...over,
});

test("describeGaps stays quiet when nothing was missed", () => {
  assert.deepEqual(describeGaps(extraction()), null);
});

test("describeGaps distinguishes a shown diagram from a lost one", () => {
  const shown = describeGaps(extraction({
    pages_without_text: [6],
    images: [{ page: 6, width: 500, height: 800, media_type: "image/png", data: "" }],
  }));
  assertIncludes(shown, "attached below");
  assert.deepEqual(shown.includes("do not describe"), false);

  const lost = describeGaps(extraction({ pages_without_text: [6] }));
  assertIncludes(lost, "could not be recovered");
  assertIncludes(lost, "do not describe");
});

test("describeGaps flags a diagram on a page that also had text", () => {
  const note = describeGaps(extraction({
    images: [{ page: 4, width: 500, height: 800, media_type: "image/png", data: "" }],
  }));
  assertIncludes(note, "Page 4");
  assertIncludes(note, "does not describe it");
});

test("describeGaps admits which pages were never searched", () => {
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
  assertIncludes(note, "pages 4 to 7 were not searched");
});

test("describeGaps says a full scan is unreadable exactly once", () => {
  // Observed on a real scanned attachment: the whole-file sentence and the
  // per-page sentence both fired, so one problem was reported as two.
  const note = describeGaps(extraction({
    text: "",
    pages_total: 1,
    pages_read: 1,
    pages_without_text: [1],
    pages_searched_for_images: 1,
  }));
  assert.deepEqual(note.match(/recovered/g)?.length, 1);
  assertIncludes(note, "appears to be a scan");
});

test("describeGaps still names unrecovered pages of a partly recovered scan", () => {
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
  assertIncludes(note, "Pages 2, 3");
});

test("describeGaps does not claim recovery failed on pages it never searched", () => {
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
      media_type: "image/png",
      data: "",
    })),
  }));
  assert.deepEqual(note.includes("could not be recovered"), false);
  assertIncludes(note, "pages 4 to 8 were not searched");
  // And it should say how much of the document actually came back.
  assertIncludes(note, "3 of its 8 pages are attached");
});

test("describeGaps does not mention a rest that does not exist", () => {
  // A one-page file returned whole was told to "treat the rest of the document
  // as unread", of a document with no rest.
  const whole = describeGaps(extraction({
    text: "",
    pages_total: 1,
    pages_read: 1,
    pages_without_text: [1],
    pages_searched_for_images: 1,
    images: [{ page: 1, width: 900, height: 1200, media_type: "image/png", data: "" }],
  }));
  assert.deepEqual(whole.includes("the rest of the document"), false);

  const partial = describeGaps(extraction({
    text: "",
    pages_total: 8,
    pages_read: 3,
    pages_without_text: [1, 2, 3],
    pages_searched_for_images: 3,
    images: [1, 2, 3].map((page) => ({
      page, width: 900, height: 1200, media_type: "image/png", data: "",
    })),
  }));
  assertIncludes(partial, "the rest of the document");
});

test("describeGaps calls a scan a scan", () => {
  const note = describeGaps(extraction({
    text: "",
    pages_without_text: [1, 2],
    pages_total: 2,
    pages_read: 2,
  }));
  assertIncludes(note, "appears to be a scan");
  assertIncludes(note, "have not been read");
});

test("extractPdfContent starts where it is told and says where to resume", async () => {
  const pdf = minimalPdf([
    page("Clause one"),
    page("Clause two"),
    page("Clause three"),
  ]);
  const rest = await extractPdfContent(pdf, 2);

  assert.deepEqual(rest.first_page, 2);
  assert.deepEqual(rest.pages_read, 3);
  assert.deepEqual(rest.next_from_page, null);
  assertIncludes(rest.text, "Clause two");
  // Pages before the start are absent, not silently folded in.
  assert.deepEqual(rest.text.includes("Clause one"), false);
});

test("extractPdfContent walks a whole scan across successive calls", async () => {
  // The case that motivated the range: a scanned document is entirely
  // pictures, so the image cap alone would return three pages of eight and
  // call the rest unread. Successive calls have to cover it without gaps or
  // repeats.
  const pdf = minimalPdf(
    Array.from({ length: 8 }, () => ({ image: { width: 600, height: 400 } })),
  );

  const seen = [];
  let from = 1;
  let calls = 0;
  while (from !== null && calls < 10) {
    const part = await extractPdfContent(pdf, from);
    for (const img of part.images) seen.push(img.page);
    assert.deepEqual(part.first_page, from);
    from = part.next_from_page;
    calls++;
  }

  assert.deepEqual(from, null, "the walk must terminate");
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("extractPdfContent reads only the window it is given", async () => {
  const pdf = minimalPdf([1, 2, 3, 4, 5].map((n) => page(`Clause ${n}`)));
  const result = await extractPdfContent(pdf, 2, 2);

  assert.deepEqual(result.first_page, 2);
  assert.deepEqual(result.pages_read, 3);
  assert.deepEqual(result.next_from_page, 4);
  assertIncludes(result.text, "Clause 2");
  assert.deepEqual(result.text.includes("Clause 4"), false);
});

test("extractPdfContent caps a window that asks for too much", async () => {
  // Otherwise the window is a way to request an entire document in one call,
  // which is the thing every other cap here exists to prevent.
  const pdf = minimalPdf(
    Array.from({ length: 30 }, (_, n) => page(`Clause ${n + 1}`)),
  );
  const result = await extractPdfContent(pdf, 1, 500);
  assert.ok(result.pages_read <= 10, `read ${result.pages_read} pages`);
  assert.deepEqual(result.next_from_page, result.pages_read + 1);
});

test("describeGaps declines to walk a scan too large to finish", () => {
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
      media_type: "image/png",
      data: "",
    })),
  }));
  assertIncludes(note, "100-page document of page images");
  assertIncludes(note, "150k tokens");
  assertIncludes(note, "do not page");
  // The invitation to continue sequentially must not also be present.
  assert.deepEqual(note.includes("calling again with from_page"), false);
});

test("describeGaps still offers the walk for a scan that can finish", () => {
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
  assertIncludes(note, "calling again with from_page 4");
});

test("extractPdfContent returns every page of a window it was asked for", async () => {
  // The window raises the image budget with it. Otherwise asking for four
  // pages of a scan returns three, silently, and the fourth looks blank.
  const pdf = minimalPdf(
    Array.from({ length: 6 }, () => ({ image: { width: 600, height: 400 } })),
  );
  const result = await extractPdfContent(pdf, 2, 4);
  assert.deepEqual(result.images.map((i) => i.page), [2, 3, 4, 5]);
});

test("describeGaps drops the large-file advice for a targeted read", () => {
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
      media_type: "image/png",
      data: "",
    })),
  }));
  assert.deepEqual(note.includes("do not page"), false);
  assertIncludes(note, "4 of its 100 pages are attached");
});

test("extractPdfContent clamps a start page past the end", async () => {
  // Rather than returning an empty read that looks like an empty document.
  const result = await extractPdfContent(minimalPdf([page("Only page")]), 99);
  assert.deepEqual(result.first_page, 1);
  assert.deepEqual(result.next_from_page, null);
});

test("extractPdfMap reports what is on each page", async () => {
  const pdf = minimalPdf([
    { text: page("Soundcheck at 17:00") },
    { image: { width: 600, height: 400 } },
    { text: page("Patch list follows") },
  ]);
  const map = await extractPdfMap(pdf);

  assert.deepEqual(map.pages_total, 3);
  assert.deepEqual(map.scanned, false);
  assert.deepEqual(map.pages.map((p) => p.image_only), [false, true, false]);
  assert.ok(map.pages[0].chars > 100, "a prose page should report its length");
  assert.deepEqual(map.pages[1].chars, 0);
});

test("extractPdfMap says a scan cannot be mapped", async () => {
  // Every page a picture: there is nothing to summarise, and pretending
  // otherwise would hand back a list of empty rows.
  const map = await extractPdfMap(
    minimalPdf([1, 2].map(() => ({ image: { width: 600, height: 400 } }))),
  );
  assert.deepEqual(map.scanned, true);
  assert.deepEqual(map.pages.every((p) => p.image_only && p.heading === null), true);
});

test("extractPdfMap does not offer a running header as a heading", async () => {
  // The letterhead is set large and appears on every page, so it wins on size
  // alone. Repetition is what disqualifies it — and page numbers make each
  // copy textually unique, so digits have to be folded together first.
  const pdf = minimalPdf(
    [1, 2, 3].map((n) => ({
      text: `TECHNICAL RIDER (page ${n} / 3) ${"Body text about the stage. ".repeat(8)}`,
    })),
  );
  const map = await extractPdfMap(pdf);
  for (const entry of map.pages) {
    assert.deepEqual(
      /TECHNICAL RIDER/.test(entry.heading ?? ""),
      false,
      `page ${entry.page} offered the running header as its heading`,
    );
  }
});

test("extractPdfContent stops early rather than reading every page", async () => {
  // The memory guard: a long document must not be read in full and trimmed
  // afterwards. 2000 chars a page means the 40k cap lands well before page 40.
  const pages = Array.from({ length: 40 }, () => "x".repeat(2000));
  const result = await extractPdfContent(minimalPdf(pages));
  assert.deepEqual(result.pages_total, 40);
  assert.deepEqual(result.truncated, true);
  assert.ok(result.pages_read < 40, `read ${result.pages_read} of 40 pages`);
  assert.ok(result.text.length <= 40_000, `got ${result.text.length} chars`);
});

