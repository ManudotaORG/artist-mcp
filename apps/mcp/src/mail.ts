/**
 * Gmail: supporting evidence, never a working unit.
 *
 * A message corroborates or fills a gap in a OneNote page; it is never the
 * thing being worked on. Ported from the edge function with behaviour intact.
 */

import { GraphError } from './client.js';
import { FANOUT_LIMIT, gmailGet, mapWithConcurrency } from './api.js';
import { htmlToText } from './notes.js';

/** Gmail ids are opaque hex-ish strings; anything else never reaches a URL. */
export const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;

type GmailHeader = { name?: string; value?: string };

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};

export type AttachmentEntry = {
  /** Position in the MIME tree: stable, and what callers quote back. */
  id: string;
  /** Gmail's own handle. Valid only for the fetch that produced it. */
  gmail_id: string;
  filename: string;
  mime_type: string;
  size: number | null;
};

const header = (headers: GmailHeader[] | undefined, name: string): string | null => {
  const found = (headers ?? []).find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
};

/**
 * Gmail encodes bodies as base64url, which atob does not accept: it uses - and
 * _ in place of + and /, and drops the padding. Translating before decoding is
 * the whole difference between readable text and a throw.
 */
export const decodeBody = (data: string): string => {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  try {
    // atob yields one byte per char; UTF-8 has to be reassembled from those
    // bytes or every non-ASCII character arrives mojibaked.
    const bytes = Uint8Array.from(atob(full), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
};

/**
 * Walk the MIME tree for something readable, preferring text/plain.
 *
 * A real message is rarely one part: it is usually multipart/alternative with
 * plain and HTML siblings, often nested inside multipart/mixed alongside
 * attachments. Taking payload.body directly works only for the simplest mails.
 */
export const extractText = (part: GmailPart | undefined): string => {
  if (!part) return '';

  const plain: string[] = [];
  const html: string[] = [];

  const walk = (node: GmailPart) => {
    const mime = (node.mimeType ?? '').toLowerCase();
    const data = node.body?.data;
    if (data) {
      if (mime === 'text/plain') plain.push(decodeBody(data));
      else if (mime === 'text/html') html.push(decodeBody(data));
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(part);

  if (plain.length > 0) return plain.join('\n').trim();
  // htmlToText is written for OneNote but the job is identical here, and a
  // second stripper would drift from this one.
  if (html.length > 0) return htmlToText(html.join('\n'));
  return '';
};

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
export const extractAttachments = (part: GmailPart | undefined): AttachmentEntry[] => {
  const found: AttachmentEntry[] = [];
  if (!part) return found;

  const walk = (node: GmailPart, path: string) => {
    const gmailId = node.body?.attachmentId;
    if (typeof gmailId === 'string' && gmailId) {
      found.push({
        id: path,
        gmail_id: gmailId,
        filename: node.filename || '(unnamed)',
        mime_type: node.mimeType ?? 'application/octet-stream',
        size: typeof node.body?.size === 'number' ? node.body.size : null,
      });
    }
    (node.parts ?? []).forEach((child, i) =>
      walk(child, path === '0' ? `${i + 1}` : `${path}.${i + 1}`),
    );
  };
  walk(part, '0');

  return found;
};

/**
 * List recent messages, newest first.
 *
 * Gmail's list endpoint returns ids and nothing else, so each message needs a
 * second metadata call to become a usable line. That is an N+1 by the API's
 * design, which is why the page is small and the calls run together.
 */
/**
 * The longest search sent to Gmail.
 *
 * It used to be 500, applied by silently cutting the query, and that was worse
 * than any limit: the digest's search is an OR group of a project's
 * counterparts with `has:userlabels` and the date at the end, so a cut removed
 * exactly the terms that bound it and left Gmail an unbalanced brace. Every
 * message past the cut stopped matching, and the reply — "No messages match"
 * the full query — said nothing about it. Verified locally: one OR group found
 * 17 messages at 64 characters and 0 at 1,225 with its matching term past 500.
 * Now a query is sent whole or refused, and the refusal says how to split it.
 */
export const MAX_QUERY_CHARS = 2_000;

export const listEmails = async (token: string, rawQuery: unknown) => {
  // Gmail search syntax is the user's own; it is sent as a query parameter,
  // never interpolated into a path, and bounded so it cannot become a URL bomb.
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (query.length > MAX_QUERY_CHARS) {
    throw new GraphError(
      `That search is ${query.length} characters; at most ${MAX_QUERY_CHARS} are sent, and ` +
        'nothing was searched. A search is never cut, because a cut drops the terms at ' +
        'the end — often the date or a closing brace — and silently matches less. Split ' +
        'it into several searches, for example one per project, and use them together.',
      false,
    );
  }

  const params = new URLSearchParams({ maxResults: '25' });
  if (query) params.set('q', query);

  const listRes = await gmailGet(`/users/me/messages?${params}`, token);
  const ids = (((await listRes.json()) as { messages?: GmailMessage[] }).messages ?? [])
    .map((m) => m.id)
    .filter((id) => typeof id === 'string' && GMAIL_ID.test(id));

  const emails = await mapWithConcurrency(ids, FANOUT_LIMIT, async (id) => {
    const res = await gmailGet(
      `/users/me/messages/${encodeURIComponent(id)}` +
        '?format=metadata&metadataHeaders=Subject&metadataHeaders=From' +
        '&metadataHeaders=To&metadataHeaders=Date',
      token,
    );
    const msg = (await res.json()) as GmailMessage;
    return {
      id: msg.id,
      thread_id: msg.threadId ?? null,
      subject: header(msg.payload?.headers, 'Subject') ?? '(no subject)',
      from: header(msg.payload?.headers, 'From'),
      to: header(msg.payload?.headers, 'To'),
      date: header(msg.payload?.headers, 'Date'),
      snippet: msg.snippet ?? null,
    };
  });

  return { emails };
};

export const readEmail = async (token: string, emailId: unknown) => {
  if (typeof emailId !== 'string' || !GMAIL_ID.test(emailId)) {
    throw new GraphError('email_id is missing or malformed.', false);
  }
  const id = encodeURIComponent(emailId);

  const res = await gmailGet(`/users/me/messages/${id}?format=full`, token);
  const msg = (await res.json()) as GmailMessage;

  return {
    id: msg.id,
    thread_id: msg.threadId ?? null,
    subject: header(msg.payload?.headers, 'Subject') ?? '(no subject)',
    from: header(msg.payload?.headers, 'From'),
    to: header(msg.payload?.headers, 'To'),
    cc: header(msg.payload?.headers, 'Cc'),
    date: header(msg.payload?.headers, 'Date'),
    text: extractText(msg.payload) || (msg.snippet ?? ''),
    // gmail_id is dropped: it expires with this fetch, so publishing it would
    // hand the caller a handle that is already going stale.
    attachments: extractAttachments(msg.payload).map(({ gmail_id: _gmail_id, ...rest }) => rest),
  };
};

/**
 * Where a reply stops being new and starts quoting what came before.
 *
 * English and German, because the musician's mail is both. The attribution
 * line is matched only when it ends in a colon, so a sentence that merely
 * mentions writing is not mistaken for one. Gmail wraps long attributions —
 * seen live as "On Tue, 27 Oct 2026, 19:32 Fitzrovia Hotel Reservations, <"
 * with the address and "wrote:" on the next line — so up to three lines
 * joined are tried as well. German Gmail puts the name first: "Manuel
 * Telleria <…> schrieb am Di., 27. Okt. 2026, 22:19:", also wrapped.
 * Outlook writes no attribution: it writes a header block, `From:` then
 * `Sent:` (`Von:` then `Gesendet:`), often under a rule of underscores.
 */
// A digit is required: every client's attribution carries the date, and
// without one "Am Montag schrieb mir Agnes Folgendes:" would cut the message
// at the sentence that introduces what it is about. The name-first German
// form also needs an address, being the likelier of the two to read as prose.
const ATTRIBUTION =
  /^(?=.*\d)(On\s.+\swrote|Am\s.+\sschrieb\s.+|(?=.*@).+\sschrieb am\s.+|Le\s.+\sa écrit)\s*:\s*$/i;
const ORIGINAL_MARKER = /^-{2,}\s*(Original Message|Ursprüngliche Nachricht)\s*-{2,}\s*$/i;
const OUTLOOK_FROM = /^\*?(From|Von)\s*:\*?\s+\S/i;
const OUTLOOK_NEXT = /^\*?(Sent|Gesendet|Date|Datum)\s*:\*?\s+\S/i;
/**
 * A forward is not quoted history. What it carries is usually new to the
 * thread — the contract the agency forwarded is the evidence — so the
 * forwarded message itself is kept, header and body.
 *
 * What that message in turn quotes is not kept. Scanning used to stop at the
 * marker, and the first live thread showed the cost: a forwarded hotel
 * confirmation brought its whole reply chain along, 10 KB repeating messages
 * already in the thread above it.
 */
const FORWARD_MARKER = /(Forwarded message|Weitergeleitete Nachricht|Begin forwarded message|Anfang der weitergeleiteten)/i;
/** The header a forward opens with; it looks exactly like Outlook's reply block. */
const FORWARD_HEADER = /^\*?(From|Von|Date|Datum|Sent|Gesendet|Subject|Betreff|To|An|Cc|Reply-To)\s*:/i;
/** RFC 3676's signature delimiter: dash, dash, space, alone on its line. */
const SIGNATURE = /^-- ?$/;

export type StrippedBody = { text: string; removedLines: number };

/**
 * Cut a message down to what its sender wrote in it.
 *
 * Conservative by design: a line is removed only when it is unmistakably
 * quoted, and a cut is made only at an unmistakable boundary. Leaving a quote
 * in costs tokens; cutting new text out hides the revision the whole tool
 * exists to show, which is the worse failure.
 */
export const stripQuoted = (text: string): StrippedBody => {
  const lines = text.split(/\r?\n/);
  let cut = lines.length;

  const isAttribution = (i: number): boolean => {
    // Only a line that could open one: otherwise the join would let the
    // sentence above a name-first German attribution be cut along with it.
    if (!/^(On|Am|Le)\s|[<@]/i.test(lines[i].trim())) return false;
    let joined = '';
    for (let j = i; j < Math.min(i + 3, lines.length); j += 1) {
      if (lines[j].trim() === '') return false;
      joined = joined ? `${joined} ${lines[j].trim()}` : lines[j].trim();
      if (ATTRIBUTION.test(joined)) return true;
      // A colon ends an attribution; a line ending in one that did not match
      // is not the start of a wrapped one.
      if (joined.endsWith(':')) return false;
    }
    return false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (FORWARD_MARKER.test(line)) {
      // Keep the forward's header and move past it, so its From/Date block is
      // not taken for an Outlook reply boundary.
      while (i + 1 < lines.length && FORWARD_HEADER.test(lines[i + 1].trim())) i += 1;
      continue;
    }
    if (ORIGINAL_MARKER.test(line) || isAttribution(i)) {
      cut = i;
      break;
    }
    if (OUTLOOK_FROM.test(line) && i + 1 < lines.length && OUTLOOK_NEXT.test(lines[i + 1].trim())) {
      // Take the rule of underscores Outlook draws above the block with it.
      cut = i > 0 && /^_{8,}\s*$/.test(lines[i - 1].trim()) ? i - 1 : i;
      break;
    }
    if (SIGNATURE.test(lines[i])) {
      cut = i;
      break;
    }
  }

  const kept = lines.slice(0, cut).filter((l) => !/^\s*>/.test(l));
  return {
    text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    removedLines: lines.length - kept.length,
  };
};

/**
 * The quote containers mail clients wrap a reply's history in. Converting HTML
 * to text loses the `>` a plain part would carry, so for an HTML-only message
 * the boundary is marked before conversion and cut after it.
 */
const HTML_QUOTE_START =
  /<(div[^>]*class="[^"]*\bgmail_quote\b|div[^>]*id="(divRplyFwdMsg|appendonsend)"|blockquote)[^>]*>/i;
const CUT = '\u0000ARTIST_QUOTE_CUT\u0000';

const quoteFreeHtml = (html: string): string => {
  const at = html.search(HTML_QUOTE_START);
  if (at < 0) return htmlToText(html);
  const marked = htmlToText(`${html.slice(0, at)}${CUT}${html.slice(at)}`);
  const [before, after = ''] = marked.split(CUT);
  // A forward sits in the same container a reply quote does; keep it.
  return FORWARD_MARKER.test(after.slice(0, 300)) ? marked.replace(CUT, '') : before;
};

/** The readable body of one message, with its quoted history cut when asked. */
const ownText = (part: GmailPart | undefined, strip: boolean): StrippedBody => {
  if (!strip) return { text: extractText(part), removedLines: 0 };
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (node: GmailPart) => {
    const mime = (node.mimeType ?? '').toLowerCase();
    const data = node.body?.data;
    if (data && mime === 'text/plain') plain.push(decodeBody(data));
    else if (data && mime === 'text/html') html.push(decodeBody(data));
    for (const child of node.parts ?? []) walk(child);
  };
  if (part) walk(part);
  if (plain.length > 0) return stripQuoted(plain.join('\n'));
  if (html.length === 0) return { text: '', removedLines: 0 };
  const full = htmlToText(html.join('\n'));
  const stripped = stripQuoted(quoteFreeHtml(html.join('\n')));
  return {
    text: stripped.text,
    removedLines: Math.max(0, full.split('\n').length - stripped.text.split('\n').length),
  };
};

export type ThreadMessage = {
  id: string;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string | null;
  draft: boolean;
  trashed: boolean;
  text: string;
  /** Lines of quoted history and signature cut from this message's text. */
  quoted_lines_removed: number;
  attachments: Omit<AttachmentEntry, 'gmail_id'>[];
};

/**
 * What one read of a thread may return. About what a long `read_email` costs,
 * so a negotiation of ordinary length comes back whole and a mailing-list
 * thread of a hundred messages comes back in parts.
 */
export const THREAD_BUDGET_CHARS = 24_000;

/**
 * Read a whole conversation, oldest first, each message cut to what its sender
 * added. See docs/scope.md, known gap 6: a value agreed in the first message and
 * revised three replies later reads as settled when the messages are read one
 * at a time.
 *
 * The first message is never stripped. What it quotes, if anything, is history
 * from outside this thread, and nothing else here would show it.
 */
export const readThread = async (token: string, threadId: unknown, fromMessage: unknown) => {
  if (typeof threadId !== 'string' || !GMAIL_ID.test(threadId)) {
    throw new GraphError('thread_id is missing or malformed.', false);
  }
  const start =
    typeof fromMessage === 'number' && Number.isInteger(fromMessage) && fromMessage > 1
      ? fromMessage
      : 1;

  const res = await gmailGet(`/users/me/threads/${encodeURIComponent(threadId)}?format=full`, token);
  const thread = (await res.json()) as {
    id?: string;
    messages?: (GmailMessage & { labelIds?: string[] })[];
  };
  const all = (thread.messages ?? []).slice().sort(
    (a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0),
  );

  const messages: (ThreadMessage & { position: number })[] = [];
  let spent = 0;
  let next: number | null = null;
  for (let i = start - 1; i < all.length; i += 1) {
    const msg = all[i];
    const headers = msg.payload?.headers;
    const body = ownText(msg.payload, i > 0);
    const entry = {
      position: i + 1,
      id: msg.id,
      from: header(headers, 'From'),
      to: header(headers, 'To'),
      cc: header(headers, 'Cc'),
      date: header(headers, 'Date'),
      draft: (msg.labelIds ?? []).includes('DRAFT'),
      trashed: (msg.labelIds ?? []).includes('TRASH'),
      text: body.text || (i === 0 ? (msg.snippet ?? '') : ''),
      quoted_lines_removed: body.removedLines,
      attachments: extractAttachments(msg.payload).map(({ gmail_id: _g, ...rest }) => rest),
    };
    const cost = entry.text.length + 300;
    // Always return at least one message, however long, so paging advances.
    if (messages.length > 0 && spent + cost > THREAD_BUDGET_CHARS) {
      next = i + 1;
      break;
    }
    messages.push(entry);
    spent += cost;
  }

  const first = all[0]?.payload?.headers;
  return {
    id: thread.id ?? threadId,
    subject: header(first, 'Subject') ?? '(no subject)',
    total: all.length,
    messages,
    next_message: next,
  };
};
