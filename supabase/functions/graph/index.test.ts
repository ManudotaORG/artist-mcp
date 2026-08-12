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
import { decodeBody, extractText, htmlToText } from "./index.ts";

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

Deno.test("htmlToText decodes the entities Gmail and OneNote both emit", () => {
  // Shared with the OneNote path deliberately; a second stripper would drift.
  assertEquals(htmlToText("<p>M&#252;ller &amp; Sons</p>"), "Müller & Sons");
});
