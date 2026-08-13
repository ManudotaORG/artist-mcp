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
  eventTime,
  extractAttachments,
  extractPdfText,
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
  assertEquals(extractAttachments(part), [
    { id: "att-1", filename: "contract.pdf", mime_type: "application/pdf", size: 240_000 },
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
    { id: "att-2", filename: "(unnamed)", mime_type: "image/jpeg", size: 900 },
  ]);
});

Deno.test("extractAttachments tolerates a missing payload", () => {
  assertEquals(extractAttachments(undefined), []);
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

/**
 * Build a PDF by hand, one content stream per page.
 *
 * A page given null draws nothing, which is how a page carrying only a scanned
 * image looks to a text extractor — the case a real rider's stage plan lands
 * in. Generating it here beats committing someone's actual contract.
 */
function minimalPdf(pages: (string | null)[]): Uint8Array {
  const objects: string[] = [];
  const kids: string[] = [];
  // 1 = catalogue, 2 = page tree, 3 = font, then a page and a stream each.
  pages.forEach((text, i) => {
    const pageObj = 4 + i * 2;
    const streamObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObj} 0 R >>`;
    // Laid out as lines rather than one enormous string: a single Tj does not
    // survive extraction intact past a hundred characters or so, and a real
    // page is lines anyway.
    const lines = (text ?? "").match(/.{1,80}/g) ?? [];
    const content = text === null
      ? ""
      : `BT /F1 12 Tf 72 720 Td 14 TL\n` +
        lines
          .map((line) => `(${line.replace(/[()\\]/g, "\\$&")}) Tj T*`)
          .join("\n") +
        `\nET`;
    objects[streamObj] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
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

Deno.test("extractPdfText reads a text PDF and labels its pages", async () => {
  const result = await extractPdfText(minimalPdf([page("Fee: EUR 2400 net")]));
  assertStringIncludes(result.text, "Fee: EUR 2400 net");
  assertStringIncludes(result.text, "[page 1]");
  assertEquals(result.pages_total, 1);
  assertEquals(result.pages_without_text, []);
  assertEquals(result.truncated, false);
});

Deno.test("extractPdfText names the page a stage plan would occupy", async () => {
  // The shape that matters: prose extracts, one page is a diagram. Reporting
  // per document would call this a clean read and lose page 2 in silence.
  const result = await extractPdfText(
    minimalPdf([page("Soundcheck at 17:00"), null, page("Patch list: SM57 on snare")]),
  );
  assertEquals(result.pages_total, 3);
  assertEquals(result.pages_without_text, [2]);
  assertStringIncludes(result.text, "Soundcheck at 17:00");
  assertStringIncludes(result.text, "[page 3]");
});

Deno.test("extractPdfText sees past a letterhead on an image-only page", async () => {
  // The regression that a zero-length check misses. Riders are letterheaded,
  // so the page that is nothing but a stage plan still returns its running
  // header — measured at 99 characters against 1,633+ on prose pages. Treating
  // that as content reports a clean read and loses the stage plan silently.
  const header = "TECHNICAL RIDER, SOUND, BACKLINE, LIGHTS (page 2 / 3)";
  const result = await extractPdfText(
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

Deno.test("extractPdfText reports a scan as having no text at all", async () => {
  const result = await extractPdfText(minimalPdf([null, null]));
  assertEquals(result.text, "");
  assertEquals(result.pages_total, 2);
  assertEquals(result.pages_without_text, [1, 2]);
});

Deno.test("extractPdfText stops early rather than reading every page", async () => {
  // The memory guard: a long document must not be read in full and trimmed
  // afterwards. 2000 chars a page means the 40k cap lands well before page 40.
  const pages = Array.from({ length: 40 }, () => "x".repeat(2000));
  const result = await extractPdfText(minimalPdf(pages));
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
