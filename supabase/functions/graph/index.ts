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
 *                 | "read_attachment" | "map_attachment" | "list_events"
 *                 | "read_event" | "verify",
 *              note_id?, email_id?, attachment_id?, from_page?, page_count?,
 *              event_id?,
 *              calendar_id?, query?, time_min?, time_max? }
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
  // Read-only, and the one scope here that is not about events themselves. It
  // names which calendars exist; without it a search of "primary" that finds
  // nothing cannot say whether it looked in the right place.
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
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
  "map_attachment",
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
  map_attachment: "google",
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
 * Say which of the three failures this is, because the advice differs.
 *
 * `connection_refresh_token` returns null when the account has no row for that
 * provider, and *errors* when a row exists but will not decrypt — pgp_sym_decrypt
 * throws rather than returning null. One message covered both, and told the
 * user to reconnect either way. Reconnecting fixes the first and cannot fix the
 * second: the web app writes a new row with the same key the function still
 * cannot read, so the advice sends someone round a loop that never closes.
 * That cost an afternoon here, twice, with the true cause a deployment
 * mismatch nobody was looking for.
 *
 * A decrypt failure is also not the caller's fault, so it is a 503 rather than
 * a 403 — the connection is fine, the server is misconfigured.
 */
function connectionFailure(label: string, errorMessage: string | null): HttpError {
  if (errorMessage === null) {
    return new HttpError(
      403,
      `No ${label} connection for this account. Connect ${label} in the web app.`,
      true,
    );
  }
  if (/wrong key or corrupt data/i.test(errorMessage)) {
    return new HttpError(
      503,
      `The stored ${label} connection cannot be decrypted: this server's ` +
        `token encryption key does not match the one that saved it. ` +
        `Reconnecting will not help — it would store another connection the ` +
        `same key cannot read. The deployment's key needs correcting.`,
      false,
    );
  }
  return new HttpError(
    503,
    `Could not read the stored ${label} connection: ${errorMessage}`,
    false,
  );
}

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
    if (error) console.error(`${label} connection read failed`, error);
    throw connectionFailure(label, error?.message ?? null);
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

/**
 * What a call needs from the grant, for the one 403 that is not a fault.
 * Mirrors ScopeNeed in apps/mcp/src/api.ts.
 */
type ScopeNeed = { capability: string; optional: boolean };

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
  need?: ScopeNeed,
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
      // Which reconnect prompt depends on what was missing. Telling someone
      // whose calendar reading works perfectly that their connection predates
      // Google Calendar access is false and alarming; what failed was the
      // newer, narrower thing this particular call needed. Kept in step with
      // ScopeNeed in apps/mcp/src/api.ts — the two custody models must answer
      // a scope gap the same way.
      if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(detail)) {
        if (need) {
          throw new HttpError(
            403,
            need.optional
              ? `This connection cannot ${need.capability}. Everything else still works; ` +
                "reconnect Google in the web app if you want it to."
              : `This connection cannot ${need.capability}. ` +
                "Reconnect Google in the web app to grant it.",
            !need.optional,
          );
        }
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

function calendarGet(path: string, token: string, need?: ScopeNeed): Promise<Response> {
  return getWithRetry(`${CALENDAR}${path}`, token, "Google Calendar", need);
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
 * attachmentId. Inline images carry one too and are listed the same way — the
 * model can see a signature logo for what it is, and a stage plot pasted into
 * the body is exactly as interesting as one clipped to it.
 *
 * What is handed out is the part's position in the MIME tree, not Gmail's
 * attachmentId. Gmail mints a fresh attachmentId on every fetch of the same
 * message — verified against a real message, where two reads a second apart
 * returned different 404-character ids for the same file — so an id quoted back
 * later matches nothing and cannot be fetched. The position does not move,
 * because the stored message does not change. Gmail's own id is carried
 * alongside for the caller that fetched it, and never published.
 */
function extractAttachments(part: GmailPart | undefined) {
  const found: {
    /** Position in the MIME tree: stable, and what callers quote back. */
    id: string;
    /** Gmail's own handle. Valid only for the fetch that produced it. */
    gmail_id: string;
    filename: string;
    mime_type: string;
    size: number | null;
  }[] = [];
  if (!part) return found;

  const walk = (node: GmailPart, path: string) => {
    const gmailId = node.body?.attachmentId;
    if (typeof gmailId === "string" && gmailId) {
      found.push({
        id: path,
        gmail_id: gmailId,
        filename: node.filename || "(unnamed)",
        mime_type: node.mimeType ?? "application/octet-stream",
        size: typeof node.body?.size === "number" ? node.body.size : null,
      });
    }
    (node.parts ?? []).forEach((child, i) =>
      walk(child, path === "0" ? `${i + 1}` : `${path}.${i + 1}`)
    );
  };
  walk(part, "0");

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
    // gmail_id is dropped: it expires with this fetch, so publishing it would
    // hand the caller a handle that is already going stale.
    attachments: extractAttachments(msg.payload).map(
      ({ gmail_id: _gmail_id, ...rest }) => rest,
    ),
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

/**
 * Caps for images, which are not optional either.
 *
 * pdf.js decodes to a raw bitmap rather than handing back the original stream,
 * so nothing can be passed through untouched: a 1702x2845 stage plan is 14.5 MB
 * of RGB in memory before it is encoded, and a scanned page is worse. Hence a
 * ceiling on how many are returned and how large each is sent.
 *
 * The pixel floor is what separates a diagram from furniture. A measured rider
 * carried a 0.11 MP letterhead on every page and a 4.84 MP stage plan on one;
 * that is not a close call, and a threshold between them costs nothing to
 * explain.
 */
const MAX_IMAGE_EDGE = 1200;
const MAX_IMAGES_PER_CALL = 3;

/**
 * How much of an image-only document is worth offering to walk through.
 *
 * At a 1200px edge a page image costs roughly 1,500 tokens to look at, so a
 * hundred-page scan is on the order of 150,000 — more than a context window,
 * and not worth spending even where it fits. Past this many pages the answer
 * stops advertising the next page and says what the file is instead, because
 * inviting a walk that cannot finish is worse than declining it: the caller
 * finds out thirty calls in.
 *
 * Raising how many pages come back per call does not help. It reaches the same
 * ceiling sooner.
 */
const WALKABLE_SCAN_PAGES = 20;
const TOKENS_PER_PAGE_IMAGE = 1500;

/** Ceiling on a requested window. The default stays small; this bounds asking. */
const MAX_PAGES_PER_CALL = 10;
const MIN_IMAGE_PIXELS = 200_000;

/**
 * pdf.js gives an image reused across pages a document-wide id prefixed `g_`,
 * which is structurally what letterhead is: the same artwork on every page. It
 * refines the pixel floor rather than replacing it — on its first appearance
 * the logo is still page-local, so the floor is what catches that one, and this
 * is an internal pdf.js convention rather than anything the PDF spec promises.
 * That is why unpdf is pinned.
 */
const SHARED_IMAGE_ID = /^g_/;

/**
 * A MIME position such as "2" or "2.1", never Gmail's own id.
 *
 * Narrow on purpose: this value is interpolated into no URL, but it is quoted
 * back into an error message, and digits and dots cannot carry anything.
 */
const ATTACHMENT_ID = /^\d+(\.\d+){0,8}$/;

/**
 * Decode base64url to bytes. Sibling of decodeBody, which decodes to text;
 * a PDF has to stay bytes or the parser gets mojibake.
 */
function decodeBytes(data: string): Uint8Array {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const full = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return Uint8Array.from(atob(full), (c) => c.charCodeAt(0));
}

// PNG encoding, because pdf.js hands back pixels and MCP wants a file. Doing
// it by hand keeps the rasteriser and the canvas polyfill out of the component
// that holds the OAuth secrets: a CRC, a deflate, and four chunks.

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Normalise pdf.js's three bitmap layouts to plain RGB.
 *
 * Kind 1 is one *bit* per pixel with rows padded to a byte boundary, not one
 * byte — reading it as bytes yields noise, which is the kind of bug that looks
 * like a corrupt file rather than a decoding mistake.
 */
function toRgb(
  data: Uint8Array,
  width: number,
  height: number,
  kind: number,
): Uint8Array | null {
  if (kind === 2) return data;
  const rgb = new Uint8Array(width * height * 3);
  if (kind === 3) {
    for (let p = 0; p < width * height; p++) {
      rgb[p * 3] = data[p * 4];
      rgb[p * 3 + 1] = data[p * 4 + 1];
      rgb[p * 3 + 2] = data[p * 4 + 2];
    }
    return rgb;
  }
  if (kind === 1) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = bit ? 255 : 0;
        const at = (y * width + x) * 3;
        rgb[at] = value;
        rgb[at + 1] = value;
        rgb[at + 2] = value;
      }
    }
    return rgb;
  }
  return null;
}

/** Box filter by an integer factor: cheap, and kind to line art and labels. */
function downscale(rgb: Uint8Array, width: number, height: number, factor: number) {
  if (factor <= 1) return { rgb, width, height };
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Uint8Array(w * h * 3);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const s = ((y * factor + dy) * width + (x * factor + dx)) * 3;
          r += rgb[s]; g += rgb[s + 1]; b += rgb[s + 2];
        }
      }
      const d = (y * w + x) * 3;
      out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n;
    }
  }
  return { rgb: out, width: w, height: h };
}

async function encodePng(
  rgb: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  // Each scanline is prefixed with its filter byte; 0 (None) leaves the work
  // to deflate, which is plenty for line art.
  const stride = width * 3;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const deflated = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflated),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
  let at = 0;
  for (const part of parts) { png.set(part, at); at += part.length; }
  return png;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: spreading a megabyte into apply() overflows the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Wait for pdf.js to finish decoding one image.
 *
 * `getOperatorList()` resolving does not mean the images it references are
 * ready: decoding is asynchronous, and the plain `objs.get(id)` *throws* for
 * one still in flight rather than returning nothing. Catching that and moving
 * on turns a timing difference into a missing picture — observed on a real
 * scanned page whose 2782x1224 image was present the whole time. The callback
 * form waits, and the timeout keeps a never-resolving object from holding the
 * function open until the platform kills it.
 */
function resolveImage(
  // deno-lint-ignore no-explicit-any -- pdf.js ships no type for the page proxy
  page: any,
  id: string,
  ms = 5000,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`image ${id} did not decode within ${ms}ms`)),
      ms,
    );
    try {
      page.objs.get(id, (obj: unknown) => {
        clearTimeout(timer);
        resolve(obj);
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Pages whose images pdf.js gave up on, collected from the only signal it gives.
 *
 * When an image cannot be decoded — JPEG 2000 is the common case, and 4 of 88
 * real documents here contain one — pdf.js drops the paint operation entirely,
 * so the operator list shows no trace and nothing downstream can tell the
 * picture apart from a page that never had one. It does log a warning, so the
 * warning is listened to.
 *
 * Patched once at module load rather than around each call: two reads sharing
 * an isolate would otherwise restore each other's patch and leak it. The sink
 * is swapped per read, so concurrent reads at worst leave one of them detecting
 * nothing — under-reporting, never attributing a page to the wrong document.
 */
let undecodableSink: Set<number> | null = null;
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const found = /Unable to decode image "img_p(\d+)_/.exec(String(args[0] ?? ""));
  // The object id counts pages from zero.
  if (found && undecodableSink) undecodableSink.add(Number(found[1]) + 1);
  originalWarn(...args);
};

type PdfImage = {
  page: number;
  width: number;
  height: number;
  media_type: "image/png";
  data: string;
};

/**
 * Read a PDF page by page: text, and the pictures the text cannot describe.
 *
 * Both are reported per page rather than per document, because the dangerous
 * case is not the fully scanned file — it is the ordinary rider whose prose
 * extracts fine and whose stage plan is a picture. Whole-document detection
 * calls that a success and silently omits the one page the crew most needs.
 *
 * Crucially the two are independent. Deciding "there is a diagram here"
 * from "this page yielded no text" only ever finds diagrams that are alone on
 * their page; a floor plan sitting under two paragraphs would extract as a
 * clean read with the picture never mentioned. So pages are searched for
 * images whether or not they gave up text.
 *
 * unpdf is imported here rather than at module load so that reading a note or
 * an email never pays for a PDF parser it does not use.
 */
/**
 * Where things are in a document, so pages can be chosen rather than walked.
 *
 * Reading a long contract from page 1 to find one clause spends a call and a
 * chunk of context per few pages. The information needed to go straight there
 * is nearly free: the page loop already reads text, and a map keeps almost none
 * of it — a character count, an apparent heading, and whether the page is a
 * picture.
 *
 * Headings are guessed from font size, which is the only structural signal
 * available without a layout model: an item set larger than the page's median
 * is a candidate. That alone picks the letterhead, because a running header is
 * also set large, so anything repeating across most pages is dropped — the same
 * reasoning that excludes a repeated logo from the images.
 *
 * A scan cannot be mapped. There is no text to summarise, so every page comes
 * back as a picture and the caller is told plainly rather than handed a list of
 * empty rows.
 */
/**
 * Compare running headers by shape, not by their text.
 *
 * "(page 1 / 7)" and "(page 2 / 7)" are the same furniture wearing different
 * numbers, and counting them literally makes each one unique, so the repetition
 * filter never sees them. Folding digits together is what makes a page counter
 * recognisable as boilerplate.
 */
/**
 * A heading is noticeably larger than the text around it, not marginally.
 *
 * Bold body copy sits a point above the median and would otherwise win on a
 * page with no real heading, offering a sentence fragment as the title. At this
 * ratio the section headings of a measured rider (13-14pt against an 11pt
 * median) qualify and emphasised prose at 12pt does not, so a cover page
 * honestly reports no heading instead of inventing one.
 */
const HEADING_SIZE_RATIO = 1.15;

const boilerplateKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#");

async function extractPdfMap(bytes: Uint8Array) {
  const { getDocumentProxy } = await import("npm:unpdf@1");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  type Candidate = { text: string; size: number };
  const pages: {
    page: number;
    chars: number;
    heading: string | null;
    image_only: boolean;
  }[] = [];
  const candidates: Candidate[][] = [];
  // How many pages each string appears on, which is what marks it boilerplate.
  const appearances = new Map<string, number>();

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[] }[])
      .map((item) => ({
        text: (item.str ?? "").trim(),
        // transform[3] is the vertical scale, which is the rendered font size.
        size: Math.abs(item.transform?.[3] ?? 0),
      }))
      .filter((item) => item.text.length > 0);
    page.cleanup();

    const chars = items.map((i) => i.text).join(" ").replace(/[ \t]+/g, " ").trim().length;
    const sizes = items.map((i) => i.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;

    // Emphasised body text is also set large, so length does the rest of the
    // work: a heading is short. Without this a bold sentence in the middle of a
    // paragraph is offered as the page's title.
    const large = items.filter(
      (i) =>
        i.size >= median * HEADING_SIZE_RATIO &&
        i.text.length >= 3 && i.text.length <= 80,
    );

    // Count every large item, not only the few in contention for the heading.
    // A running header loses to the section titles on a busy page, so counting
    // just the top few means it is seen on too few pages to look repetitive —
    // which is how a letterhead ended up as page one's heading.
    for (const text of new Set(large.map((c) => boilerplateKey(c.text)))) {
      appearances.set(text, (appearances.get(text) ?? 0) + 1);
    }

    const pageCandidates = [...large].sort((a, b) => b.size - a.size).slice(0, 6);

    candidates.push(pageCandidates);
    pages.push({
      page: n,
      chars,
      heading: null,
      image_only: chars < MIN_PAGE_CHARS,
    });
  }

  // Anything on more than half the pages is furniture, not a heading. The
  // threshold needs at least two sightings so a two-page document does not
  // discard its only real heading.
  const boilerplate = new Set(
    [...appearances.entries()]
      .filter(([, count]) => count >= Math.max(2, Math.ceil(pdf.numPages / 2)))
      .map(([text]) => text),
  );

  pages.forEach((entry, i) => {
    const heading = candidates[i].find(
      (c) => !boilerplate.has(boilerplateKey(c.text)),
    );
    entry.heading = heading ? heading.text.slice(0, 120) : null;
  });

  return {
    pages_total: pdf.numPages,
    pages,
    scanned: pages.every((p) => p.image_only),
  };
}

async function extractPdfContent(
  bytes: Uint8Array,
  fromPage = 1,
  pageCount?: number,
) {
  const { getDocumentProxy } = await import("npm:unpdf@1");
  const { OPS } = await import("npm:unpdf@1/pdfjs");
  // pdf.js transfers the buffer to its worker, which detaches it — the
  // caller's array is unusable afterwards, and a second read of the same bytes
  // throws DataCloneError. Reading a document in page ranges means exactly
  // that second read, so the copy is what makes ranges possible at all.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  const first = Math.min(Math.max(1, Math.trunc(fromPage)), pdf.numPages);
  // A window is for asking about pages someone already has reason to care
  // about — "40 to 45" — not for reading faster. Unbounded, it would be a way
  // to request the whole document in one call and exhaust the function.
  const window = pageCount === undefined
    ? undefined
    : Math.min(Math.max(1, Math.trunc(pageCount)), MAX_PAGES_PER_CALL);
  const last = window === undefined
    ? pdf.numPages
    : Math.min(first + window - 1, pdf.numPages);

  const parts: string[] = [];
  const emptyPages: number[] = [];
  const images: PdfImage[] = [];
  const skipped: number[] = [];
  const unreadable: number[] = [];

  // See undecodableSink: a picture pdf.js cannot decode leaves no trace in the
  // operator list, and naming it is the difference between "no picture here"
  // and "a picture nobody could read".
  const undecodable = new Set<number>();
  const outerSink = undecodableSink;
  undecodableSink = undecodable;
  let chars = 0;
  let read = first - 1;
  // One before the start, so "searched as far as read" holds when the very
  // first page already fills the image budget.
  let searched = first - 1;
  // Asking for a window is an explicit request for those pages, so it raises
  // the image budget to match; the default stays deliberately small.
  const imageBudget = window ?? MAX_IMAGES_PER_CALL;

  try {
  for (let n = first; n <= last; n++) {
    const page = await pdf.getPage(n);

    const content = await page.getTextContent();
    const text = (content.items as { str?: string }[])
      .map((item) => item.str ?? "")
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();

    read = n;
    // Boilerplate is not content: a page under the threshold is reported as a
    // gap and its header is left out, rather than being passed off as what the
    // page said.
    if (text.length < MIN_PAGE_CHARS) emptyPages.push(n);
    else {
      parts.push(`[page ${n}]\n${text}`);
      chars += text.length;
    }

    // Building the operator list decodes this page's images, so it is skipped
    // entirely once enough have been collected — that is the expensive half of
    // the loop on a long document. The price is that later pages are not
    // searched at all, which must be reported rather than left to look like a
    // document with no further diagrams in it.
    if (images.length < imageBudget) {
      searched = n;
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
        const id = ops.argsArray[i][0];
        if (typeof id !== "string" || SHARED_IMAGE_ID.test(id)) continue;

        let raw: { width: number; height: number; kind: number; data: Uint8Array };
        try {
          raw = await resolveImage(page, id);
        } catch (err) {
          // A picture that exists and could not be fetched is not the same as
          // no picture, and reporting it as absence is how a stage plan
          // disappears without anyone noticing.
          console.error(`image ${id} on page ${n} did not resolve`, err);
          if (!unreadable.includes(n)) unreadable.push(n);
          continue;
        }
        if (!raw?.data || raw.width * raw.height < MIN_IMAGE_PIXELS) continue;

        if (images.length >= imageBudget) {
          if (!skipped.includes(n)) skipped.push(n);
          continue;
        }

        const rgb = toRgb(raw.data, raw.width, raw.height, raw.kind);
        if (!rgb) continue;
        const factor = Math.ceil(Math.max(raw.width, raw.height) / MAX_IMAGE_EDGE);
        const small = downscale(rgb, raw.width, raw.height, factor);
        images.push({
          page: n,
          width: small.width,
          height: small.height,
          media_type: "image/png",
          data: toBase64(await encodePng(small.rgb, small.width, small.height)),
        });
      }
    }

    // Release the page's decoded content before the next one is opened; this
    // is the difference between a flat loop and a growing heap.
    page.cleanup();

    // A call ends when either budget is spent, and the caller resumes from the
    // next page. Stopping only on the text budget was the subtler mistake: on
    // a scan the text budget is never touched, so the loop ran to the end,
    // declared the file finished, and left every page past the image cap
    // permanently unreachable — a page range that could not reach them.
    if (chars >= MAX_TEXT_CHARS || images.length >= imageBudget) break;
  }
  } finally {
    undecodableSink = outerSink;
  }

  for (const page of undecodable) {
    if (page >= first && page <= read && !unreadable.includes(page)) {
      unreadable.push(page);
    }
  }
  unreadable.sort((a, b) => a - b);

  // Image-only and longer than anyone can read here: see WALKABLE_SCAN_PAGES.
  const unwalkable = chars === 0 && pdf.numPages > WALKABLE_SCAN_PAGES;

  return {
    text: parts.join("\n\n").slice(0, MAX_TEXT_CHARS),
    pages_total: pdf.numPages,
    first_page: first,
    pages_read: read,
    pages_without_text: emptyPages,
    images,
    pages_with_skipped_images: skipped,
    pages_with_unreadable_images: unreadable,
    pages_searched_for_images: searched,
    // Whether the caller named a window. Someone who asked for pages 12-15 has
    // already made the judgement the large-file advice exists to prompt.
    targeted: window !== undefined,
    // What to ask for to carry on — withheld for an image-only document too
    // large to finish, where the note declines the walk. Leaving a page number
    // here while the prose says "do not page through it" is the same
    // contradiction in machine-readable form, and a caller following fields
    // rather than sentences would walk anyway. Targeted pages are still
    // available through from_page and page_count.
    next_from_page: read < pdf.numPages && !unwalkable ? read + 1 : null,
    truncated: read < pdf.numPages || chars > MAX_TEXT_CHARS,
  };
}

/**
 * Say, in words, what of this file did not make it into the answer.
 *
 * A PDF with pages and no text anywhere is a scan, and an empty string offered
 * as its contents reads as an empty file. But the gaps are several different
 * things and flattening them into one sentence leaves a reader unsure whether
 * they saw the stage plan: a page whose picture is attached, a page whose
 * picture could not be recovered, a page of prose that also carries a diagram,
 * and pages nothing ever looked at. The last is the easiest to misread as
 * "there were no more diagrams".
 */
function describeGaps(extracted: {
  text: string;
  pages_total: number;
  pages_read: number;
  pages_without_text: number[];
  images: PdfImage[];
  pages_with_skipped_images: number[];
  pages_with_unreadable_images?: number[];
  pages_searched_for_images: number;
  first_page?: number;
  next_from_page?: number | null;
  targeted?: boolean;
}): string | null {
  const scanned = extracted.text.length === 0 && extracted.pages_total > 0;
  const bigScan = scanned && extracted.pages_total > WALKABLE_SCAN_PAGES &&
    !extracted.targeted;
  const shown = new Set(extracted.images.map((img) => img.page));
  const list = (pages: number[]) =>
    `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ")}`;

  // "Could not be recovered" must mean tried and failed. A page past the point
  // where the image search stopped was never attempted, and saying recovery
  // failed there is both false and the more reassuring of the two readings —
  // it implies someone looked. Those pages belong to the "not searched"
  // sentence alone.
  const blind = extracted.pages_without_text.filter(
    (p) => !shown.has(p) && p <= extracted.pages_searched_for_images,
  );
  const recovered = extracted.pages_without_text.filter((p) => shown.has(p));
  const alongside = [...shown].filter(
    (p) => !extracted.pages_without_text.includes(p),
  );

  const notes = [
    scanned && extracted.images.length === 0
      ? "No text layer: this file appears to be a scan or a set of page " +
        "images, and none could be recovered as pictures. Its contents have " +
        "not been read."
      : null,
    scanned && extracted.images.length > 0 && !bigScan
      ? `No text layer: this file is page images rather than text — a scan, ` +
        `or something exported as a picture. Its contents are the pictures, ` +
        `and ${extracted.images.length} of its ${extracted.pages_total} ` +
        `${extracted.pages_total === 1 ? "page is" : "pages are"} attached ` +
        `below. Read ${extracted.images.length === 1 ? "it" : "them"} as the ` +
        `contents` +
        // Only when there is a rest. A one-page file returned whole was being
        // told to treat the remainder as unread, of a document with none.
        (extracted.images.length < extracted.pages_total
          ? `, and treat the rest of the document as unread.`
          : `.`)
      : null,
    !scanned && recovered.length > 0
      ? `${list(recovered)} carried little or no text and ${
        recovered.length === 1 ? "is" : "are"
      } attached below as ${recovered.length === 1 ? "a picture" : "pictures"}` +
        ` — in a rider this is typically the stage plan.`
      : null,
    // Suppressed when the whole file is an unrecoverable scan: the sentence
    // above has already said every page is unreadable, and repeating it per
    // page reads as two separate problems.
    blind.length > 0 && !(scanned && extracted.images.length === 0)
      ? `${list(blind)} of ${extracted.pages_total} carried little or no text ` +
        `and could not be recovered as pictures either. Nothing from ` +
        `${blind.length === 1 ? "that page" : "those pages"} is included, so ` +
        `do not describe what ${blind.length === 1 ? "it" : "they"} might show.`
      : null,
    alongside.length > 0
      ? `${list(alongside)} also carr${alongside.length === 1 ? "ies" : "y"} a ` +
        `diagram or picture, attached below; the extracted text does not ` +
        `describe ${alongside.length === 1 ? "it" : "them"}.`
      : null,
    extracted.pages_with_skipped_images.length > 0
      ? `Further pictures on ${list(extracted.pages_with_skipped_images)
        .toLowerCase()} were left out: only ${MAX_IMAGES_PER_CALL} are ` +
        `returned per read.`
      : null,
    (extracted.pages_with_unreadable_images ?? []).length > 0
      ? `A picture on ${list(extracted.pages_with_unreadable_images ?? [])
        .toLowerCase()} could not be decoded and is missing from this answer. ` +
        `It is there in the file — this is a failure to read it, not an ` +
        `absence, so do not conclude the page is blank.`
      : null,
    // A document too large to walk gets told what it is, not where to go next.
    // Inviting a walk that cannot finish is worse than declining it: the caller
    // discovers the ceiling thirty calls in, having spent the context getting
    // there. Targeted pages stay available, because that is the request worth
    // serving — nobody needs a hundred pages, they need the clause on page 40.
    bigScan
      ? `This is a ${extracted.pages_total}-page document of page images. ` +
        `Reading all of it would be roughly ${
          Math.round(extracted.pages_total * TOKENS_PER_PAGE_IMAGE / 1000)
        }k tokens of pictures, which is not practical here, so do not page ` +
        `through it. Pages ${extracted.first_page ?? 1} to ` +
        `${extracted.pages_read} are attached so the file can be identified. ` +
        `Ask which pages are needed and request those with from_page and ` +
        `page_count, or say plainly that this one is better opened directly.`
      : null,
    // The way out of every cap above: ask for the rest. Without this the
    // caller is told what is missing and not that it is obtainable.
    extracted.next_from_page && !bigScan
      ? `This read covered pages ${extracted.first_page ?? 1} to ` +
        `${extracted.pages_read} of ${extracted.pages_total}. Read the rest by ` +
        `calling again with from_page ${extracted.next_from_page}.`
      : null,
    extracted.pages_searched_for_images < extracted.pages_read
      ? `Only the first ${MAX_IMAGES_PER_CALL} pictures are returned per read, ` +
        `so pages ${extracted.pages_searched_for_images + 1} to ` +
        `${extracted.pages_read} were not searched for diagrams at all — ` +
        `there may be more that nothing here reports.`
      : null,
  ].filter((line): line is string => line !== null);

  return notes.length > 0 ? notes.join(" ") : null;
}

/**
 * Read one attachment's contents.
 *
 * The message is fetched first, and not as a formality. Gmail's attachmentId
 * is per-fetch, so the only way to get one that works is to take it from the
 * fetch about to be used; a caller quotes back a MIME position instead, which
 * is resolved here. The same fetch supplies the filename and declared type,
 * which the attachment endpoint does not return, and the size, so an oversized
 * file is refused before its bytes are moved.
 *
 * Resolving through the message's own tree is also what keeps an attachment
 * from being read out of a message it does not belong to — a property of the
 * lookup rather than a check bolted on beside it.
 */
/**
 * Resolve an attachment and fetch its bytes, or report that it is too large.
 *
 * Shared by reading and mapping, because both need the same three things: a
 * live Gmail id resolved from the stable MIME position, the filename and type
 * that the attachment endpoint does not return, and the size — so an oversized
 * file is refused before its bytes are moved rather than after.
 */
/**
 * Explain an attachment we will not read, in terms the sender could act on.
 *
 * "Not supported yet" is true of everything and useful about nothing. A legacy
 * .doc will not become readable by waiting — the old binary Word format needs a
 * parser that does not exist in this runtime — so the honest answer names the
 * file and suggests what to ask for instead. A format that is merely not built
 * yet says that, which is a different sentence and a different expectation.
 */
/**
 * What Claude can actually look at. Anything else is declined by name.
 *
 * HEIC in particular is worth naming: an iPhone sends it by default, so it is
 * the most likely image to arrive and the one a generic "unsupported" would
 * explain worst.
 */
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Whether an attachment is a Word document, by type or by name. */
const isDocx = (mimeType: string, filename: string) =>
  mimeType.toLowerCase() === DOCX_TYPE || /\.docx$/i.test(filename);

const VIEWABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * An image attachment is passed through untouched, so the ceiling is transport
 * rather than pixels: it is carried base64-encoded, which adds a third, and
 * clients reject an oversized payload outright. Nothing here can shrink a photo
 * — that needs a decoder this deliberately does not have — so the honest move
 * at the limit is to refuse and say how big it was.
 */
const MAX_IMAGE_BYTES_FOR_CHAT = 3_500_000;
const MAX_IMAGE_EDGE_FOR_CHAT = 8000;

/**
 * Read width and height from the header, without decoding the image.
 *
 * Costs microseconds and needs no decoder, which is the point: a decoder for
 * hostile input is exactly what this component should not be running. Returns
 * null when the bytes are not a format we recognise, which is a fact worth
 * reporting rather than guessing past.
 */
function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: IHDR is required to be the first chunk, so the size is at a fixed spot.
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: walk the marker chain to a start-of-frame, which is the only segment
  // carrying dimensions. C4, C8 and CC share the range but are not frames.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (
        marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      ) {
        return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      }
      const length = view.getUint16(i + 2);
      if (length < 2) return null; // malformed; refuse to loop on it
      i += 2 + length;
    }
    return null;
  }

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // WebP: "RIFF" .... "WEBP", then a VP8/VP8L/VP8X chunk holding the size.
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X") {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === "VP8 " && bytes.length > 30) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes.length > 25) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  return null;
}

/**
 * Hand an image attachment over as something to look at.
 *
 * Nothing is decoded or re-encoded: the bytes go through as they arrived, which
 * is both cheaper and safer than the PDF path, where pdf.js gives back raw
 * pixels that have to be encoded before they can travel.
 */
function imageResult(
  meta: { filename: string; mime_type: string; size: number | null },
  bytes: Uint8Array,
) {
  const base = {
    filename: meta.filename,
    mime_type: meta.mime_type,
    size: meta.size ?? bytes.byteLength,
    text: "",
  };
  const mime = meta.mime_type.toLowerCase();

  if (!VIEWABLE_IMAGE_TYPES.has(mime)) {
    return {
      ...base,
      kind: "unsupported" as const,
      images: [],
      note: `${meta.filename} is ${meta.mime_type}, which cannot be displayed ` +
        `in chat. JPEG, PNG, GIF and WebP can. An iPhone sends HEIC by default, ` +
        `so asking the sender to share it as a JPEG usually solves this.`,
    };
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES_FOR_CHAT) {
    return {
      ...base,
      kind: "too_large" as const,
      images: [],
      note: `${meta.filename} is ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB, ` +
        `above the ${(MAX_IMAGE_BYTES_FOR_CHAT / (1024 * 1024)).toFixed(1)} MB an ` +
        `image can be to travel through chat. It was fetched but not shown, and ` +
        `nothing here can shrink it — ask the sender for a smaller copy.`,
    };
  }

  const size = imageSize(bytes);
  if (size && Math.max(size.width, size.height) > MAX_IMAGE_EDGE_FOR_CHAT) {
    return {
      ...base,
      kind: "too_large" as const,
      images: [],
      note: `${meta.filename} is ${size.width}x${size.height}, beyond the ` +
        `${MAX_IMAGE_EDGE_FOR_CHAT} pixel limit for an image in chat.`,
    };
  }

  return {
    ...base,
    kind: "image" as const,
    images: [{
      width: size?.width ?? null,
      height: size?.height ?? null,
      media_type: mime,
      data: toBase64(bytes),
    }],
    note: size
      ? null
      : `The header of ${meta.filename} could not be read, so its dimensions ` +
        `are unknown. It is attached as it arrived.`,
  };
}

function unsupportedNote(mimeType: string, filename: string): string {
  const mime = mimeType.toLowerCase();
  if (mime === "application/msword" || /\.doc$/i.test(filename)) {
    return `${filename} is a legacy Word document (.doc), a binary format this ` +
      `cannot read and is not planned to. Ask the sender for a PDF or a .docx, ` +
      `or open it yourself.`;
  }
  if (mime.startsWith("image/")) {
    return `${filename} is an image. Reading images is not built yet, so it ` +
      `has not been looked at.`;
  }
  return `Reading ${mimeType} attachments is not built yet, so the contents of ` +
    `${filename} have not been read.`;
}

async function loadAttachment(
  token: string,
  emailId: unknown,
  attachmentId: unknown,
): Promise<
  | { oversized: true; meta: AttachmentMeta }
  | { oversized: false; meta: AttachmentMeta; bytes: Uint8Array }
> {
  if (typeof emailId !== "string" || !GMAIL_ID.test(emailId)) {
    throw new HttpError(400, "email_id is missing or malformed.");
  }
  if (typeof attachmentId !== "string" || !ATTACHMENT_ID.test(attachmentId)) {
    throw new HttpError(400, "attachment_id is missing or malformed.");
  }
  const id = encodeURIComponent(emailId);

  const msgRes = await gmailGet(`/users/me/messages/${id}?format=full`, token);
  const msg = (await msgRes.json()) as GmailMessage;
  const attachments = extractAttachments(msg.payload);
  const meta = attachments.find((a) => a.id === attachmentId);
  if (!meta) {
    // Name what is there. A bare "not found" invites the caller to retry with
    // the same id, and this is the one error a caller can actually act on.
    const available = attachments.length
      ? attachments.map((a) => `${a.id} (${a.filename})`).join(", ")
      : "none";
    throw new HttpError(
      404,
      `That message has no attachment ${attachmentId}. Available: ${available}.`,
    );
  }

  if (meta.size !== null && meta.size > MAX_ATTACHMENT_BYTES) {
    return { oversized: true, meta };
  }

  const attRes = await gmailGet(
    `/users/me/messages/${id}/attachments/${encodeURIComponent(meta.gmail_id)}`,
    token,
  );
  const payload = (await attRes.json()) as { data?: string; size?: number };
  if (typeof payload.data !== "string") {
    throw new HttpError(502, "Gmail returned no data for that attachment.");
  }
  return { oversized: false, meta, bytes: decodeBytes(payload.data) };
}

type AttachmentMeta = ReturnType<typeof extractAttachments>[number];

/** The refusal, worded once so reading and mapping cannot drift apart. */
function tooLargeResult(meta: AttachmentMeta) {
  return {
    filename: meta.filename,
    mime_type: meta.mime_type,
    size: meta.size ?? 0,
    kind: "too_large" as const,
    text: "",
    note:
      // One decimal: rounding 13.8 to "14" overstates a file sitting near
      // the limit, and near the limit is exactly when the number is read.
      `This file is ${((meta.size ?? 0) / (1024 * 1024)).toFixed(1)} MB, above the ` +
      `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit for reading in chat. ` +
      `It was not fetched.`,
  };
}

/**
 * Map an attachment: what is on each page, without reading any of it.
 *
 * The answer to "what does it say about cancellation" should not be a walk from
 * page one. This costs one text pass and returns a few hundred bytes, so a
 * caller can name the pages worth reading and then read only those.
 */
async function mapAttachment(
  token: string,
  emailId: unknown,
  attachmentId: unknown,
) {
  const loaded = await loadAttachment(token, emailId, attachmentId);
  if (loaded.oversized) return tooLargeResult(loaded.meta);
  const { meta, bytes } = loaded;

  const base = {
    filename: meta.filename,
    mime_type: meta.mime_type,
    size: meta.size ?? bytes.byteLength,
  };

  if (isDocx(meta.mime_type, meta.filename)) {
    const doc = await extractDocxContent(bytes).catch(() => null);
    return {
      ...base,
      kind: doc ? ("text" as const) : ("unreadable" as const),
      pages: [],
      note: doc
        ? `${meta.filename} is a Word document of ${doc.chars_total} characters` +
          (doc.parts_total > 1 ? ` in ${doc.parts_total} parts` : "") +
          `. There is no page map to give: a .docx records no pages, and its ` +
          `heading styles are not dependable enough to divide it honestly. ` +
          `Read it with read_attachment.`
        : `${meta.filename} could not be opened as a Word document.`,
    };
  }

  if (meta.mime_type.toLowerCase() !== "application/pdf") {
    return {
      ...base,
      kind: "unsupported" as const,
      pages: [],
      note: `Only PDF attachments can be mapped. ` +
        unsupportedNote(meta.mime_type, meta.filename),
    };
  }

  let map;
  try {
    map = await extractPdfMap(bytes);
  } catch (err) {
    console.error("pdf map failed", err);
    return {
      ...base,
      kind: "unreadable" as const,
      pages: [],
      note:
        "This PDF could not be parsed. It may be encrypted, password " +
        "protected, or damaged.",
    };
  }

  return {
    ...base,
    kind: map.scanned ? ("scan" as const) : ("text" as const),
    pages_total: map.pages_total,
    pages: map.pages,
    note: map.scanned
      ? (map.pages_total === 1
        ? `This file is a single page image, so there is nothing to map. `
        : `Every page of this ${map.pages_total}-page file is a picture, so ` +
          `there is nothing to map. `) +
        `A scan cannot be searched without reading the pages themselves — ask ` +
        `read_attachment for them.`
      : `${map.pages_total} pages. Use read_attachment with from_page and ` +
        `page_count to read the ones that matter, rather than reading it all.`,
  };
}

async function readAttachment(
  token: string,
  emailId: unknown,
  attachmentId: unknown,
  fromPage: unknown,
  pageCount: unknown,
) {
  if (typeof emailId !== "string" || !GMAIL_ID.test(emailId)) {
    throw new HttpError(400, "email_id is missing or malformed.");
  }
  if (typeof attachmentId !== "string" || !ATTACHMENT_ID.test(attachmentId)) {
    throw new HttpError(400, "attachment_id is missing or malformed.");
  }
  if (
    fromPage !== undefined && fromPage !== null &&
    (typeof fromPage !== "number" || !Number.isFinite(fromPage) || fromPage < 1)
  ) {
    throw new HttpError(400, "from_page must be a page number, 1 or greater.");
  }
  if (
    pageCount !== undefined && pageCount !== null &&
    (typeof pageCount !== "number" || !Number.isFinite(pageCount) || pageCount < 1)
  ) {
    throw new HttpError(400, "page_count must be a number of pages, 1 or greater.");
  }
  const loaded = await loadAttachment(token, emailId, attachmentId);
  if (loaded.oversized) return tooLargeResult(loaded.meta);
  const { meta, bytes } = loaded;

  const mime = meta.mime_type.toLowerCase();
  const base = {
    filename: meta.filename,
    mime_type: meta.mime_type,
    size: meta.size ?? bytes.byteLength,
  };

  if (mime.startsWith("image/")) return imageResult(meta, bytes);

  if (isDocx(meta.mime_type, meta.filename)) {
    let doc;
    try {
      doc = await extractDocxContent(bytes, (fromPage as number) ?? 1);
    } catch (err) {
      console.error("docx read failed", err);
      doc = null;
    }
    if (!doc) {
      return {
        ...base,
        kind: "unreadable" as const,
        text: "",
        note: `${meta.filename} could not be opened as a Word document. It may ` +
          `be damaged, password protected, or not really a .docx.`,
      };
    }
    return {
      ...base,
      kind: "text" as const,
      // Said out loud: a Word file has no pages, so from_page selects parts of
      // the text rather than pages of a rendering.
      unit: "part" as const,
      text: doc.text,
      chars_total: doc.chars_total,
      parts_total: doc.parts_total,
      first_page: doc.part,
      pages_read: doc.part,
      next_from_page: doc.next_from_page,
      truncated: doc.next_from_page !== null,
      images: [],
      note: doc.parts_total > 1
        ? `A Word document has no pages, so this is part ${doc.part} of ` +
          `${doc.parts_total}, split by length alone — a heading may fall ` +
          `across the join. Continue with from_page ${doc.next_from_page}.`
        : null,
    };
  }

  if (mime !== "application/pdf") {
    return {
      ...base,
      kind: "unsupported" as const,
      text: "",
      note: unsupportedNote(meta.mime_type, meta.filename),
    };
  }

  let extracted;
  try {
    extracted = await extractPdfContent(
      bytes,
      (fromPage as number) ?? 1,
      pageCount as number | undefined,
    );
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

  const scanned = extracted.text.length === 0 && extracted.pages_total > 0;

  return {
    ...base,
    kind: scanned ? ("scan" as const) : ("text" as const),
    ...extracted,
    note: describeGaps(extracted),
  };
}

// ------------------------------------------------------------ word documents

/**
 * Find one file inside a ZIP and inflate it.
 *
 * A .docx is a ZIP of XML, and the runtime already has what this needs:
 * DecompressionStream("deflate-raw") is the same web standard the PNG encoder
 * uses in the other direction. That is why no dependency appears here — a ZIP
 * reader is a central-directory walk, and a library pulled in for this would be
 * one more thing parsing hostile input beside the OAuth secrets.
 */
async function unzipEntry(
  bytes: Uint8Array,
  wanted: string,
): Promise<Uint8Array | null> {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record sits at the back, behind a comment of
  // unknown length, so it is found by scanning backwards for its signature.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length) return null;
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );

    if (name === wanted) {
      if (localOffset + 30 > bytes.length) return null;
      const localName = view.getUint16(localOffset + 26, true);
      const localExtra = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localName + localExtra;
      // Copied rather than a view: a subarray is typed over ArrayBufferLike,
      // which a Blob will not take, and the copy also keeps the caller's bytes
      // whole if the stream ever detaches them.
      const data = new Uint8Array(bytes.subarray(start, start + compressed));
      if (method === 0) return data; // stored rather than deflated
      if (method !== 8) return null; // anything else is not worth supporting
      const inflated = await new Response(
        new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
      ).arrayBuffer();
      return new Uint8Array(inflated);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * Turn word/document.xml into readable text.
 *
 * Paragraphs are the only structure worth trusting. Heading styles are not:
 * measured against eight real documents, one used Word's own names, one used
 * custom ones, and the rest carried no style at all on text that plainly reads
 * as a heading. So nothing here claims to know where the sections are, because
 * that would be a guess wearing the clothes of structure.
 */
function docxToText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  const lines = paragraphs.map((paragraph) =>
    // <w:t> exactly, not "any tag starting with w:t". The loose form also
    // matches <w:tbl>, <w:tblPr>, <w:tc> and <w:tr>, so a document containing a
    // table returned its own markup as prose — invisible until a file with a
    // table was tried, since ordinary paragraphs have none of those.
    [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((m) => m[1])
      .join("")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // &amp; last, so "&amp;lt;" does not become "<".
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+/g, " ")
      .trim()
  );

  return lines
    .filter((line, i) => line !== "" || lines[i - 1] !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Read a Word document, in parts only when it is too long for one answer.
 *
 * A .docx has no pages — pagination is what Word does when rendering, not
 * something the file records — so nothing here invents them. Measured against
 * eight real documents, seven fitted in a single answer, so parts are the
 * exception rather than the shape of the feature. The response says its unit is
 * a part, because reusing from_page silently would be its own small lie.
 */
async function extractDocxContent(bytes: Uint8Array, fromPart = 1) {
  const xml = await unzipEntry(bytes, "word/document.xml");
  if (!xml) return null;

  const text = docxToText(new TextDecoder().decode(xml));
  const parts = Math.max(1, Math.ceil(text.length / MAX_TEXT_CHARS));
  const part = Math.min(Math.max(1, Math.trunc(fromPart)), parts);

  return {
    text: text.slice((part - 1) * MAX_TEXT_CHARS, part * MAX_TEXT_CHARS),
    chars_total: text.length,
    parts_total: parts,
    part,
    next_from_page: part < parts ? part + 1 : null,
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
      case "map_attachment":
        result = await mapAttachment(token, body.email_id, body.attachment_id);
        break;
      case "read_attachment":
        result = await readAttachment(
          token,
          body.email_id,
          body.attachment_id,
          body.from_page,
          body.page_count,
        );
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
  connectionFailure,
  decodeBytes,
  describeGaps,
  docxToText,
  extractDocxContent,
  imageResult,
  imageSize,
  unsupportedNote,
  extractAttachments,
  extractPdfContent,
  extractPdfMap,
  extractText,
  htmlToText,
  eventTime,
  shapeEvent,
  thinRecurring,
};
