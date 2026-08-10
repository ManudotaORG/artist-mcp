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
 * Request:  { op: "list_notes" | "read_note" | "verify", note_id?: string }
 *           Authorization: Bearer <connection key>
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const MS_CLIENT_ID = Deno.env.get("MS_CLIENT_ID")!;
const MS_CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET")!;
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

/** Only these three. Anything else is a 400 before any work happens. */
const OPERATIONS = new Set(["list_notes", "read_note", "verify"]);

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
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

/**
 * Microsoft rotates refresh tokens: every exchange returns a new one and
 * invalidates the old. The write-back below is not optional — miss it and the
 * connection dies silently after the first call.
 */
async function accessTokenFor(userId: string): Promise<string> {
  const { data: refreshToken, error } = await db.rpc(
    "connection_refresh_token",
    { p_user_id: userId, p_key: TOKEN_ENCRYPTION_KEY },
  );
  if (error || !refreshToken) {
    throw new HttpError(403, "No Microsoft connection. Reconnect needed.", true);
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(
      403,
      `Microsoft rejected the refresh token: ${body.error_description ?? res.status}. Reconnect needed.`,
      true,
    );
  }

  if (body.refresh_token) {
    const { error: writeBackError } = await db.rpc("set_connection", {
      p_user_id: userId,
      p_refresh_token: body.refresh_token,
      p_key: TOKEN_ENCRYPTION_KEY,
    });
    // Failing to persist the rotated token means the next call will present a
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
async function graphGet(path: string, token: string): Promise<Response> {
  // Path is built here from a fixed set of literals below. Nothing from the
  // caller is ever concatenated into a URL.
  const url = `${GRAPH}${path}`;
  const delays = [400, 1200];

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) return res;

    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || attempt >= delays.length) {
      throw new HttpError(502, `Microsoft Graph returned ${res.status}.`);
    }
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}

// ---------------------------------------------------------------- operations

type OneNotePage = {
  id: string;
  title: string;
  lastModifiedDateTime: string;
  parentSection?: { displayName?: string };
};

async function listNotes(token: string) {
  const res = await graphGet(
    "/me/onenote/pages?$select=id,title,lastModifiedDateTime" +
      "&$expand=parentSection($select=displayName)&$top=100",
    token,
  );
  const body = await res.json();
  const notes = (body.value as OneNotePage[]).map((p) => ({
    id: p.id,
    title: p.title ?? "(untitled)",
    section: p.parentSection?.displayName ?? null,
    last_modified: p.lastModifiedDateTime ?? null,
  }));
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

// -------------------------------------------------------------------- router

Deno.serve(async (req) => {
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

    const token = await accessTokenFor(keyRow.user_id);
    const result = op === "list_notes"
      ? await listNotes(token)
      : await readNote(token, body.note_id);

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
});
