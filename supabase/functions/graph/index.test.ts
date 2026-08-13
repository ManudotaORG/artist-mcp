/**
 * Tests for the pure transformations in the Graph function.
 *
 * These are the parts that fail silently. A broken decode does not throw, it
 * returns plausible-looking rubbish, and a MIME walk that misses a nesting
 * level returns an empty body that reads as "the email had no content".
 *
 * Run with: deno test supabase/functions/graph/index.test.ts
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  decodeBody,
  eventTime,
  extractAttachments,
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
