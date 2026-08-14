/**
 * Gmail: supporting evidence, never a working unit.
 *
 * A message corroborates or fills a gap in a OneNote page; it is never the
 * thing being worked on. Ported from the edge function with behaviour intact.
 */
import { GraphError } from './client.js';
import { gmailGet } from './api.js';
import { htmlToText } from './notes.js';
/** Gmail ids are opaque hex-ish strings; anything else never reaches a URL. */
export const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const header = (headers, name) => {
    const found = (headers ?? []).find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase());
    return found?.value ?? null;
};
/**
 * Gmail encodes bodies as base64url, which atob does not accept: it uses - and
 * _ in place of + and /, and drops the padding. Translating before decoding is
 * the whole difference between readable text and a throw.
 */
export const decodeBody = (data) => {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/');
    const full = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    try {
        // atob yields one byte per char; UTF-8 has to be reassembled from those
        // bytes or every non-ASCII character arrives mojibaked.
        const bytes = Uint8Array.from(atob(full), (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }
    catch {
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
export const extractText = (part) => {
    if (!part)
        return '';
    const plain = [];
    const html = [];
    const walk = (node) => {
        const mime = (node.mimeType ?? '').toLowerCase();
        const data = node.body?.data;
        if (data) {
            if (mime === 'text/plain')
                plain.push(decodeBody(data));
            else if (mime === 'text/html')
                html.push(decodeBody(data));
        }
        for (const child of node.parts ?? [])
            walk(child);
    };
    walk(part);
    if (plain.length > 0)
        return plain.join('\n').trim();
    // htmlToText is written for OneNote but the job is identical here, and a
    // second stripper would drift from this one.
    if (html.length > 0)
        return htmlToText(html.join('\n'));
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
export const extractAttachments = (part) => {
    const found = [];
    if (!part)
        return found;
    const walk = (node, path) => {
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
        (node.parts ?? []).forEach((child, i) => walk(child, path === '0' ? `${i + 1}` : `${path}.${i + 1}`));
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
export const listEmails = async (token, rawQuery) => {
    // Gmail search syntax is the user's own; it is sent as a query parameter,
    // never interpolated into a path, and capped so it cannot become a URL bomb.
    const query = typeof rawQuery === 'string' ? rawQuery.slice(0, 500).trim() : '';
    const params = new URLSearchParams({ maxResults: '25' });
    if (query)
        params.set('q', query);
    const listRes = await gmailGet(`/users/me/messages?${params}`, token);
    const ids = ((await listRes.json()).messages ?? [])
        .map((m) => m.id)
        .filter((id) => typeof id === 'string' && GMAIL_ID.test(id));
    const emails = await Promise.all(ids.map(async (id) => {
        const res = await gmailGet(`/users/me/messages/${encodeURIComponent(id)}` +
            '?format=metadata&metadataHeaders=Subject&metadataHeaders=From' +
            '&metadataHeaders=To&metadataHeaders=Date', token);
        const msg = (await res.json());
        return {
            id: msg.id,
            thread_id: msg.threadId ?? null,
            subject: header(msg.payload?.headers, 'Subject') ?? '(no subject)',
            from: header(msg.payload?.headers, 'From'),
            to: header(msg.payload?.headers, 'To'),
            date: header(msg.payload?.headers, 'Date'),
            snippet: msg.snippet ?? null,
        };
    }));
    return { emails };
};
export const readEmail = async (token, emailId) => {
    if (typeof emailId !== 'string' || !GMAIL_ID.test(emailId)) {
        throw new GraphError('email_id is missing or malformed.', false);
    }
    const id = encodeURIComponent(emailId);
    const res = await gmailGet(`/users/me/messages/${id}?format=full`, token);
    const msg = (await res.json());
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
