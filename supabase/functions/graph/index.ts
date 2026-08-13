/**
 * POST /functions/v1/graph
 *
 * The whole trust boundary. Holds the Microsoft client secret and the token
 * encryption key; the installed package holds neither.
 *
 * TREAT /v1/ AS A PUBLIC CONTRACT. Copies on npm upgrade on their own schedule
 * and will keep calling this shape indefinitely. Add /v2/ rather than changing
 * a field.
 *
 * Request:  { op: "list_notes" | "read_note" | "list_emails" | "read_email"
 *                 | "read_attachment" | "list_events" | "read_event" | "verify",
 *              note_id?, email_id?, attachment_id?, event_id?, calendar_id?,
 *              query?, time_min?, time_max? }
 *           Authorization: Bearer <connection key>
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const MS_CLIENT_ID = Deno.env.get("MS_CLIENT_ID")!;
const MS_CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY")!;

// Service role: the edge function resolves a key to a user and reads that
// user's row, which RLS would otherwise forbid. Isolation comes from the key
// lookup below, not from RLS.
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPES = "Notes.Read offline_access User.Read";

const GMAIL = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Read-only and deliberately narrow. Every additional scope widens the consent
// screen and the blast radius of a leaked refresh token, so this must stay in
// step with the web app's authorize call — a refresh that asks for more than
// the grant carries is rejected.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
].join(" ");

/**
 * Anything not here is a 400 before any work happens.
 *
 * Adding operations is additive and safe for /v1/: an older installed copy
 * never sends the new ops, and the shape of the existing four is untouched.
 */
const OPERATIONS = new Set([
  "list_notes",
  "read_note",
  "list_emails",
  "read_email",
  "read_attachment",
  "list_events",
  "read_event",
  "verify",
]);

/** Which connection each operation needs. `verify` needs none. */
const PROVIDER_FOR: Record<string, "microsoft" | "google"> = {
  list_notes: "microsoft",
  read_note: "microsoft",
  list_emails: "google",
  read_email: "google",
  read_attachment: "google",
  list_events: "google",
  read_event: "google",
};

// ------------------------------------------------------------------- helpers

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Per-key rate limit, 30 requests/minute.
 *
 * In-isolate only: Supabase may run several isolates, so the effective ceiling
 * is a small multiple of this. That's adequate to stop a runaway client, which
 * is what this is for. A hard global limit would need shared state.
 */
const RATE_LIMIT = 30;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(keyHash: string): boolean {
  const now = Date.now();
  const recent = (hits.get(keyHash) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(keyHash, recent);
  return recent.length > RATE_LIMIT;
}

/** Strips OneNote's HTML down to readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    // Numeric entities first: OneNote emits these for accented characters, so
    // without this "Müller" arrives as "M&#252;ller".
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // &amp; last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, "&")
    // OneNote nests deeply, leaving every line indented with tabs and stray
    // blank lines between them. Flatten both so the model reads prose.
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------ token exchange

type Provider = "microsoft" | "google";

const PROVIDER_LABEL: Record<Provider, string> = {
  microsoft: "Microsoft",
  google: "Google",
};

/**
 * Exchange the stored refresh token for an access token.
 *
 * The two providers differ in one way that matters. Microsoft rotates refresh
 * tokens — every exchange returns a new one and invalidates the old, so the
 * write-back is not optional; miss it and the connection dies silently after
 * the first call. Google returns no refresh token on an ordinary refresh and
 * keeps the original valid, so there is normally nothing to write back.
 *
 * Writing back whatever comes returns therefore handles both: it is mandatory
 * for Microsoft and a no-op for Google, rather than two divergent paths.
 */
async function accessTokenFor(
  userId: string,
  provider: Provider,
): Promise<string> {
  const label = PROVIDER_LABEL[provider];

  const { data: refreshToken, error } = await db.rpc(
    "connection_refresh_token",
    { p_user_id: userId, p_key: TOKEN_ENCRYPTION_KEY, p_provider: provider },
  );
  if (error || !refreshToken) {
    throw new HttpError(403, `No ${label} connection. Reconnect needed.`, true);
  }

  const google = provider === "google";
  const res = await fetch(google ? GOOGLE_TOKEN_URL : TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: google ? GOOGLE_CLIENT_ID : MS_CLIENT_ID,
      client_secret: google ? GOOGLE_CLIENT_SECRET : MS_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: google ? GOOGLE_SCOPES : SCOPES,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(
      403,
      `${label} rejected the refresh token: ${body.error_description ?? res.status}. Reconnect needed.`,
      true,
    );
  }

  if (body.refresh_token) {
    const { error: writeBackError } = await db.rpc("set_connection", {
      p_user_id: userId,
      p_refresh_token: body.refresh_token,
      p_key: TOKEN_ENCRYPTION_KEY,
      p_provider: provider,
    });
    // Failing to persist a rotated token means the next call will present a
    // dead one. Better to fail loudly now than to silently break later.
    if (writeBackError) {
      throw new HttpError(500, "Could not persist the rotated refresh token.", false);
    }
  }

  return body.access_token as string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reconnectNeeded = false,
  ) {
    super(message);
  }
}

/**
 * The OneNote endpoints return transient 503/504 often enough to fail roughly
 * one call in three, so a read is retried briefly. Only 5xx and 429 are
 * retried — a 4xx is a real answer and retrying it would just be slower.
 */
async function getWithRetry(
  url: string,
  token: string,
  api: string,
): Promise<Response> {
  const delays = [400, 1200];

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) return res;

    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || attempt >= delays.length) {
      // Both APIs explain their 4xx in the body. Without it every failure looks
      // the same and the only debugging tool left is guesswork.
      const detail = (await res.text().catch(() => "")).slice(0, 300);

      // A refresh token carries the scopes it was granted with, and adding a
      // scope later does not widen it. A connection made before Calendar
      // existed here therefore authenticates fine and is refused per-call, so
      // this has to read as "reconnect", not as a broken integration.
      if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(detail)) {
        throw new HttpError(
          403,
          `This connection predates ${api} access. Reconnect Google in the web app to grant it.`,
          true,
        );
      }

      throw new HttpError(
        502,
        `${api} returned ${res.status}.${detail ? ` ${detail}` : ""}`,
      );
    }
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}

function graphGet(path: string, token: string): Promise<Response> {
  // Path is built here from a fixed set of literals below. Nothing from the
  // caller is ever concatenated into a URL.
  return getWithRetry(`${GRAPH}${path}`, token, "Microsoft Graph");
}

function gmailGet(path: string, token: string): Promise<Response> {
  return getWithRetry(`${GMAIL}${path}`, token, "Gmail");
}

function calendarGet(path: string, token: string): Promise<Response> {
  return getWithRetry(`${CALENDAR}${path}`, token, "Google Calendar");
}

// ---------------------------------------------------------------- operations

type OneNotePage = {
  id: string;
  title: string;
  lastModifiedDateTime: string;
};

type OneNoteSection = {
  id: string;
  displayName?: string;
  parentNotebook?: { displayName?: string };
};

/**
 * `/me/onenote/pages` looks like the obvious call and works right up until the
 * account has too many sections, at which point Graph fails the whole request
 * with error 20266 and tells you to page per section instead. Organised
 * notebooks hit this, so sections are enumerated first and their pages fetched
 * one section at a time. The notebook name comes along for free.
 */
async function listNotes(token: string) {
  const sectionsRes = await graphGet(
    "/me/onenote/sections?$select=id,displayName" +
      "&$expand=parentNotebook($select=displayName)&$top=100",
    token,
  );
  const sections = ((await sectionsRes.json()).value ?? []) as OneNoteSection[];

  const perSection = await Promise.all(
    sections
      // Ids come from Graph, never from the caller, but the id is concatenated
      // into a URL below so it is checked like any other untrusted value.
      .filter((s) => typeof s.id === "string" && /^[A-Za-z0-9!._~-]{1,300}$/.test(s.id))
      .map(async (section) => {
        const res = await graphGet(
          `/me/onenote/sections/${section.id}/pages` +
            "?$select=id,title,lastModifiedDateTime&$top=100",
          token,
        );
        const pages = ((await res.json()).value ?? []) as OneNotePage[];
        return pages.map((p) => ({
          id: p.id,
          title: p.title ?? "(untitled)",
          section: section.displayName ?? null,
          // Additive field: older installed copies ignore it, so /v1/ stays intact.
          notebook: section.parentNotebook?.displayName ?? null,
          last_modified: p.lastModifiedDateTime ?? null,
        }));
      }),
  );

  // Newest first, matching the order the single-call version happened to
  // return; pages with no timestamp sort last rather than jumping to the top.
  const notes = perSection
    .flat()
    .sort((a, b) => (b.last_modified ?? "").localeCompare(a.last_modified ?? ""));
  return { notes };
}

async function readNote(token: string, noteId: unknown) {
  if (typeof noteId !== "string" || !/^[A-Za-z0-9!._~-]{1,300}$/.test(noteId)) {
    throw new HttpError(400, "note_id is missing or malformed.");
  }
  // Encoded, and shape-checked above, so it can only ever be one path segment.
  const id = encodeURIComponent(noteId);

  const meta = await graphGet(`/me/onenote/pages/${id}?$select=title`, token);
  const { title } = await meta.json();

  const content = await graphGet(`/me/onenote/pages/${id}/content`, token);
  return { title: title ?? "(untitled)", text: htmlToText(await content.text()) };
}

// --------------------------------------------------------------------- gmail

type GmailHeader = { name?: string; value?: string };

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};

/** Gmail ids are opaque hex-ish strings; anything else never reaches a URL. */
const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  const found = (headers ?? []).find(
    (h) => (h.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

/**
 * Gmail encodes bodies as base64url, which atob does not accept: it uses - and
 * _ in place of + and /, and drops the padding. Translating before decoding is
 * the whole difference between readable text and a throw.
 */
function decodeBody(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const full = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  try {
    // atob yields one byte per char; UTF-8 has to be reassembled from those
    // bytes or every non-ASCII character arrives mojibaked.
    const bytes = Uint8Array.from(atob(full), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

/**
 * Walk the MIME tree for something readable, preferring text/plain.
 *
 * A real message is rarely one part: it is usually multipart/alternative with
 * plain and HTML siblings, often nested inside multipart/mixed alongside
 * attachments. Taking payload.body directly works only for the simplest mails.
 */
function extractText(part: GmailPart | undefined): string {
  if (!part) return "";

  const plain: string[] = [];
  const html: string[] = [];

  const walk = (node: GmailPart) => {
    const mime = (node.mimeType ?? "").toLowerCase();
    const data = node.body?.data;
    if (data) {
      if (mime === "text/plain") plain.push(decodeBody(data));
      else if (mime === "text/html") html.push(decodeBody(data));
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(part);

  if (plain.length > 0) return plain.join("\n").trim();
  // htmlToText is written for OneNote but the job is identical here, and a
  // second stripper would drift from this one.
  if (html.length > 0) return htmlToText(html.join("\n"));
  return "";
}

/**
 * List what is attached, without fetching any of it.
 *
 * Everything here is already in the payload `read_email` fetches, so the
 * manifest costs nothing: a part is an attachment when Gmail has given it an
 * attachmentId, which is also the handle needed to fetch the bytes later.
 * Inline images carry one too and are listed the same way — the model can see
 * a signature logo for what it is, and a stage plot pasted into the body is
 * exactly as interesting as one clipped to it.
 */
function extractAttachments(part: GmailPart | undefined) {
  const found: {
    id: string;
    filename: string;
    mime_type: string;
    size: number | null;
  }[] = [];
  if (!part) return found;

  const walk = (node: GmailPart) => {
    const id = node.body?.attachmentId;
    if (typeof id === "string" && id) {
      found.push({
        id,
        filename: node.filename || "(unnamed)",
        mime_type: node.mimeType ?? "application/octet-stream",
        size: typeof node.body?.size === "number" ? node.body.size : null,
      });
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(part);

  return found;
}

/**
 * List recent messages, newest first.
 *
 * Gmail's list endpoint returns ids and nothing else, so each message needs a
 * second metadata call to become a usable line. That is an N+1 by the API's
 * design, which is why the page is small and the calls run together.
 */
async function listEmails(token: string, rawQuery: unknown) {
  // Gmail search syntax is the user's own; it is sent as a query parameter,
  // never interpolated into a path, and capped so it cannot become a URL bomb.
  const query = typeof rawQuery === "string" ? rawQuery.slice(0, 500).trim() : "";

  const params = new URLSearchParams({ maxResults: "25" });
  if (query) params.set("q", query);

  const listRes = await gmailGet(`/users/me/messages?${params}`, token);
  const ids = (((await listRes.json()).messages ?? []) as GmailMessage[])
    .map((m) => m.id)
    .filter((id) => typeof id === "string" && GMAIL_ID.test(id));

  const emails = await Promise.all(
    ids.map(async (id) => {
      const res = await gmailGet(
        `/users/me/messages/${encodeURIComponent(id)}` +
          "?format=metadata&metadataHeaders=Subject&metadataHeaders=From" +
          "&metadataHeaders=To&metadataHeaders=Date",
        token,
      );
      const msg = (await res.json()) as GmailMessage;
      return {
        id: msg.id,
        thread_id: msg.threadId ?? null,
        subject: header(msg.payload?.headers, "Subject") ?? "(no subject)",
        from: header(msg.payload?.headers, "From"),
        to: header(msg.payload?.headers, "To"),
        date: header(msg.payload?.headers, "Date"),
        snippet: msg.snippet ?? null,
      };
    }),
  );

  return { emails };
}

async function readEmail(token: string, emailId: unknown) {
  if (typeof emailId !== "string" || !GMAIL_ID.test(emailId)) {
    throw new HttpError(400, "email_id is missing or malformed.");
  }
  const id = encodeURIComponent(emailId);

  const res = await gmailGet(`/users/me/messages/${id}?format=full`, token);
  const msg = (await res.json()) as GmailMessage;

  return {
    id: msg.id,
    thread_id: msg.threadId ?? null,
    subject: header(msg.payload?.headers, "Subject") ?? "(no subject)",
    from: header(msg.payload?.headers, "From"),
    to: header(msg.payload?.headers, "To"),
    cc: header(msg.payload?.headers, "Cc"),
    date: header(msg.payload?.headers, "Date"),
    text: extractText(msg.payload) || (msg.snippet ?? ""),
    attachments: extractAttachments(msg.payload),
  };
}

// ------------------------------------------------------- attachment contents

/**
 * Two ceilings, and neither is decoration.
 *
 * Extraction decodes a PDF into memory, and the cost tracks pages and text
 * volume rather than file size: a 195 KB, 176-page file measured 185 MB of
 * heap when every page was read at once, against a 256 MB function. So the
 * character cap is enforced *during* the page loop with an early stop, which
 * held the same file to 19 MB. A byte cap alone does not protect this.
 *
 * The byte cap is the cruder guard, on what is fetched at all. Contracts and
 * riders sit far below it — a real 7-page rider was 0.6 MB.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 40_000;

/**
 * Below this many characters, a page is carrying no content of its own.
 *
 * Testing for literally zero characters does not work, and the reason is
 * mundane: nearly every rider is letterheaded, so the page holding the stage
 * plan still yields its running header. A measured example returned 99
 * characters of boilerplate against 1,633 to 2,695 on the prose pages — a page
 * that is entirely a diagram, reported as a clean read. The gap between those
 * two populations is wide, so a threshold well above a header and far below a
 * real page separates them without arithmetic nobody can follow later.
 */
const MIN_PAGE_CHARS = 150;

/** Gmail attachment ids are long — far longer than a message id. */
const ATTACHMENT_ID = /^[A-Za-z0-9_-]{1,4096}$/;

/**
 * Decode base64url to bytes. Sibling of decodeBody, which decodes to text;
 * a PDF has to stay bytes or the parser gets mojibake.
 */
function decodeBytes(data: string): Uint8Array {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const full = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return Uint8Array.from(atob(full), (c) => c.charCodeAt(0));
}

/**
 * Pull text out of a PDF, page by page, stopping at the cap.
 *
 * Reports per page rather than per document, because the dangerous case is not
 * the fully scanned file — it is the ordinary rider whose prose extracts fine
 * and whose stage plan is an image. Whole-document detection calls that a
 * success and silently omits the one page the reader most needs. Naming the
 * pages that carry no text is what stops a summary being written over a hole.
 *
 * unpdf is imported here rather than at module load so that reading a note or
 * an email never pays for a PDF parser it does not use.
 */
async function extractPdfText(bytes: Uint8Array) {
  const { getDocumentProxy } = await import("npm:unpdf@1");
  const pdf = await getDocumentProxy(bytes);

  const parts: string[] = [];
  const emptyPages: number[] = [];
  let chars = 0;
  let read = 0;

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = (content.items as { str?: string }[])
      .map((item) => item.str ?? "")
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    // Release the page's decoded content before the next one is opened; this
    // is the difference between a flat loop and a growing heap.
    page.cleanup();

    read = n;
    // Boilerplate is not content: a page under the threshold is reported as a
    // gap and its header is left out, rather than being passed off as what the
    // page said.
    if (text.length < MIN_PAGE_CHARS) emptyPages.push(n);
    else {
      parts.push(`[page ${n}]\n${text}`);
      chars += text.length;
    }
    if (chars >= MAX_TEXT_CHARS) break;
  }

  return {
    text: parts.join("\n\n").slice(0, MAX_TEXT_CHARS),
    pages_total: pdf.numPages,
    pages_read: read,
    pages_without_text: emptyPages,
    truncated: read < pdf.numPages || chars > MAX_TEXT_CHARS,
  };
}

/**
 * Read one attachment's contents.
 *
 * The message is fetched first, which sounds wasteful next to a direct
 * attachment call but is what makes the answer trustworthy: it proves the
 * attachment belongs to the message asked about, and supplies the filename and
 * declared type, which the attachment endpoint does not return. The size is
 * there too, so an oversized file is refused before its bytes are fetched.
 */
async function readAttachment(
  token: string,
  emailId: unknown,
  attachmentId: unknown,
) {
  if (typeof emailId !== "string" || !GMAIL_ID.test(emailId)) {
    throw new HttpError(400, "email_id is missing or malformed.");
  }
  if (typeof attachmentId !== "string" || !ATTACHMENT_ID.test(attachmentId)) {
    throw new HttpError(400, "attachment_id is missing or malformed.");
  }
  const id = encodeURIComponent(emailId);

  const msgRes = await gmailGet(`/users/me/messages/${id}?format=full`, token);
  const msg = (await msgRes.json()) as GmailMessage;
  const meta = extractAttachments(msg.payload).find((a) => a.id === attachmentId);
  if (!meta) {
    throw new HttpError(404, "That attachment is not part of that message.");
  }

  if (meta.size !== null && meta.size > MAX_ATTACHMENT_BYTES) {
    return {
      filename: meta.filename,
      mime_type: meta.mime_type,
      size: meta.size,
      kind: "too_large" as const,
      text: "",
      note:
        `This file is ${Math.round(meta.size / (1024 * 1024))} MB, above the ` +
        `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit for reading in chat. ` +
        `It was not fetched.`,
    };
  }

  const attRes = await gmailGet(
    `/users/me/messages/${id}/attachments/${encodeURIComponent(attachmentId)}`,
    token,
  );
  const payload = (await attRes.json()) as { data?: string; size?: number };
  if (typeof payload.data !== "string") {
    throw new HttpError(502, "Gmail returned no data for that attachment.");
  }
  const bytes = decodeBytes(payload.data);

  const mime = meta.mime_type.toLowerCase();
  const base = {
    filename: meta.filename,
    mime_type: meta.mime_type,
    size: meta.size ?? bytes.byteLength,
  };

  if (mime !== "application/pdf") {
    return {
      ...base,
      kind: "unsupported" as const,
      text: "",
      note:
        `Reading ${meta.mime_type} attachments is not supported yet, so the ` +
        `contents of this file have not been read.`,
    };
  }

  let extracted;
  try {
    extracted = await extractPdfText(bytes);
  } catch (err) {
    console.error("pdf extraction failed", err);
    return {
      ...base,
      kind: "unreadable" as const,
      text: "",
      note:
        "This PDF could not be parsed. It may be encrypted, password " +
        "protected, or damaged.",
    };
  }

  // A PDF with pages and no text anywhere is a scan. Saying so is the whole
  // point: an empty string presented as the contents reads as an empty file.
  const scanned = extracted.text.length === 0 && extracted.pages_total > 0;

  return {
    ...base,
    kind: scanned ? ("scan" as const) : ("text" as const),
    ...extracted,
    note: scanned
      ? "No text layer: this file appears to be a scan or a set of page " +
        "images. Its contents have not been read."
      : extracted.pages_without_text.length > 0
      ? `${extracted.pages_without_text.length === 1 ? "Page" : "Pages"} ` +
        `${extracted.pages_without_text.join(", ")} of ${extracted.pages_total} ` +
        `carried little or no text and appear to be images or diagrams. ` +
        `Nothing from ${extracted.pages_without_text.length === 1 ? "it" : "them"} ` +
        `is included below — in a rider this is typically the stage plan, so do ` +
        `not describe one from the rest of the document.`
      : null,
  };
}

// ------------------------------------------------------------------ calendar

type CalendarTime = { dateTime?: string; date?: string; timeZone?: string };

type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: CalendarTime;
  end?: CalendarTime;
  recurringEventId?: string;
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  organizer?: { email?: string; displayName?: string };
};

/**
 * Calendar ids are `primary` or an email-shaped address. Checked because the
 * value is a caller-supplied path segment.
 */
const CALENDAR_ID = /^[A-Za-z0-9._%+@#-]{1,320}$/;
/** Event ids are base32hex-ish; recurring instances append `_<timestamp>`. */
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;

/**
 * Normalise a Calendar time into one shape.
 *
 * An event carries `dateTime` OR `date`, never both: timed events use the
 * first, all-day events the second. Reading only `dateTime` therefore returns
 * nothing for every all-day event, which is how a festival or a tour block is
 * usually recorded — the failure is silent and looks like an empty calendar.
 */
function eventTime(t: CalendarTime | undefined): {
  value: string | null;
  all_day: boolean;
  time_zone: string | null;
} {
  if (!t) return { value: null, all_day: false, time_zone: null };
  if (t.date) return { value: t.date, all_day: true, time_zone: t.timeZone ?? null };
  return { value: t.dateTime ?? null, all_day: false, time_zone: t.timeZone ?? null };
}

/**
 * Events carry their own time zone, which need not be the musician's. Times are
 * returned as the API states them and always paired with their zone, rather
 * than rendered into an ambient local time that silently differs between
 * whoever formats it.
 */
function shapeEvent(e: CalendarEvent) {
  const start = eventTime(e.start);
  const end = eventTime(e.end);
  return {
    id: e.id,
    summary: e.summary ?? "(no title)",
    status: e.status ?? null,
    location: e.location ?? null,
    start: start.value,
    end: end.value,
    all_day: start.all_day,
    time_zone: start.time_zone ?? end.time_zone,
    // Present only on an instance of a recurring series, which is worth saying:
    // "every Tuesday" and "this Tuesday" are different claims about a page.
    recurring: Boolean(e.recurringEventId),
  };
}

/** Events returned per call, and how many occurrences of one series may fill it. */
const PAGE = 25;
const MAX_PER_SERIES = 3;

/**
 * Keep at most `limit` occurrences of any one recurring series.
 *
 * A weekly rehearsal expands to dozens of instances and, ordered by start time,
 * crowds every other event out of the page: a real calendar returned 23
 * rehearsals and two other events. The first few occurrences answer "when does
 * this recur"; the rest push out the concert the page is actually about.
 *
 * Non-recurring events are never thinned, and the count of what was dropped is
 * returned so the caller can say so rather than implying an empty diary.
 */
function thinRecurring(
  events: CalendarEvent[],
  limit: number,
): { kept: CalendarEvent[]; omitted: number } {
  const seen = new Map<string, number>();
  const kept: CalendarEvent[] = [];
  let omitted = 0;

  for (const e of events) {
    const series = e.recurringEventId;
    if (!series) {
      kept.push(e);
      continue;
    }
    const n = (seen.get(series) ?? 0) + 1;
    seen.set(series, n);
    if (n <= limit) kept.push(e);
    else omitted += 1;
  }
  return { kept, omitted };
}

/**
 * List events in a window, earliest first.
 *
 * singleEvents=true is not optional. Without it the API returns recurrence
 * *rules* rather than occurrences, so a weekly rehearsal appears once, at its
 * first date, carrying an RRULE that reads as a single event on the wrong day.
 * orderBy=startTime is only accepted alongside it.
 */
async function listEvents(
  token: string,
  rawCalendarId: unknown,
  rawQuery: unknown,
  rawTimeMin: unknown,
  rawTimeMax: unknown,
) {
  const calendarId = typeof rawCalendarId === "string" && rawCalendarId.trim()
    ? rawCalendarId.trim()
    : "primary";
  if (!CALENDAR_ID.test(calendarId)) {
    throw new HttpError(400, "calendar_id is malformed.");
  }

  const iso = (v: unknown, fallback: string): string => {
    if (typeof v !== "string" || !v.trim()) return fallback;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, `Not a date: ${v}`);
    return d.toISOString();
  };

  // Defaults lean recent-and-ahead: corroborating next month's concert is the
  // common case, but a page about last week still needs its evidence, so the
  // window opens slightly in the past rather than at now.
  const now = Date.now();
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    // Fetched wide and thinned below. A weekly series expands to ~50 instances
    // a year, so asking for exactly the number to be returned means one
    // rehearsal fills the whole page and a concert three months out is never
    // seen at all.
    maxResults: "100",
    timeMin: iso(rawTimeMin, new Date(now - 7 * 86_400_000).toISOString()),
    timeMax: iso(rawTimeMax, new Date(now + 365 * 86_400_000).toISOString()),
  });
  if (typeof rawQuery === "string" && rawQuery.trim()) {
    params.set("q", rawQuery.slice(0, 500).trim());
  }

  const res = await calendarGet(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    token,
  );
  const items = ((await res.json()).items ?? []) as CalendarEvent[];

  // Expanding a series also yields its cancelled instances. A cancelled
  // occurrence is not evidence that something is happening, so it is dropped
  // here — read_event still reports the status if one is asked for by id.
  const live = items.filter((e) => e.status !== "cancelled");

  const { kept, omitted } = thinRecurring(live, MAX_PER_SERIES);
  return {
    events: kept.slice(0, PAGE).map(shapeEvent),
    // Stated rather than silent: "nothing else is booked" and "the rest of the
    // page was rehearsals" are different answers about a musician's diary.
    omitted_occurrences: omitted + Math.max(0, kept.length - PAGE),
  };
}

async function readEvent(token: string, rawEventId: unknown, rawCalendarId: unknown) {
  if (typeof rawEventId !== "string" || !EVENT_ID.test(rawEventId)) {
    throw new HttpError(400, "event_id is missing or malformed.");
  }
  const calendarId = typeof rawCalendarId === "string" && rawCalendarId.trim()
    ? rawCalendarId.trim()
    : "primary";
  if (!CALENDAR_ID.test(calendarId)) {
    throw new HttpError(400, "calendar_id is malformed.");
  }

  const res = await calendarGet(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawEventId)}`,
    token,
  );
  const e = (await res.json()) as CalendarEvent;

  return {
    ...shapeEvent(e),
    description: e.description ?? null,
    organizer: e.organizer?.email ?? e.organizer?.displayName ?? null,
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.email ?? null,
      name: a.displayName ?? null,
      response: a.responseStatus ?? null,
    })),
  };
}

// -------------------------------------------------------------------- router

/**
 * The trust boundary: authenticates the caller, rate limits, then dispatches.
 *
 * Named rather than passed inline to Deno.serve so it appears in stack traces
 * and in structural analysis. As an anonymous arrow it had no node in the call
 * graph, which made everything it calls — the operation whitelist, sha256, the
 * rate limiter, the key lookup — look unreachable.
 */
export const handleRequest = async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const auth = req.headers.get("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!key) throw new HttpError(401, "Missing connection key.", true);

    const body = await req.json().catch(() => ({}));
    const op = body.op;
    if (!OPERATIONS.has(op)) throw new HttpError(400, "Unknown operation.");

    const keyHash = await sha256(key);
    if (rateLimited(keyHash)) {
      throw new HttpError(429, "Too many requests. Slow down.");
    }

    const { data: keyRow } = await db
      .from("mcp_keys")
      .select("id, user_id")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (!keyRow) throw new HttpError(401, "Invalid connection key.", true);

    // Best-effort; a failed timestamp update shouldn't fail the request.
    await db
      .from("mcp_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRow.id);

    if (op === "verify") return json({ ok: true });

    // The operation decides the provider, so a Gmail call never spends a
    // Microsoft token and a missing Google connection is reported as such
    // instead of surfacing as an unrelated Microsoft error.
    const token = await accessTokenFor(keyRow.user_id, PROVIDER_FOR[op]);

    let result: unknown;
    switch (op) {
      case "list_notes":
        result = await listNotes(token);
        break;
      case "read_note":
        result = await readNote(token, body.note_id);
        break;
      case "list_emails":
        result = await listEmails(token, body.query);
        break;
      case "read_email":
        result = await readEmail(token, body.email_id);
        break;
      case "read_attachment":
        result = await readAttachment(token, body.email_id, body.attachment_id);
        break;
      case "list_events":
        result = await listEvents(
          token,
          body.calendar_id,
          body.query,
          body.time_min,
          body.time_max,
        );
        break;
      default:
        result = await readEvent(token, body.event_id, body.calendar_id);
    }

    return json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return json(
        { error: err.message, reconnect_needed: err.reconnectNeeded },
        err.status,
      );
    }
    console.error(err);
    return json({ error: "Unexpected server error." }, 500);
  }
};

// Guarded so the module can be imported by a test without binding a port.
// Deno runs this as the entry point in production, where import.meta.main is
// true, so the served behaviour is unchanged.
if (import.meta.main) {
  Deno.serve(handleRequest);
}

// Exported for tests only. These are the parts with no network and no auth:
// pure transformations where a bug is silent rather than loud.
export {
  decodeBody,
  decodeBytes,
  extractAttachments,
  extractPdfText,
  extractText,
  htmlToText,
  eventTime,
  shapeEvent,
  thinRecurring,
};
