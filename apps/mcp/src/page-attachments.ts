/**
 * What is attached to a OneNote page, read out of the page's own HTML.
 *
 * This is the identity half of reading a page attachment; the bytes are fetched
 * separately. The split is not arbitrary — Graph tells you almost nothing about
 * a resource at fetch time, so the HTML is the only honest source for three
 * things:
 *
 *   - the **type**. `/me/onenote/resources/{id}/$value` returns
 *     `application/octet-stream` for everything, PNGs included. The real type is
 *     the `data-src-type` or `type` attribute here.
 *   - the **name**. Only `<object>` carries one, in `data-attachment`. An inline
 *     image has no filename anywhere, so one is composed below.
 *   - the **id**. Probed against a real page: resource ids are stable across
 *     re-fetches and across edits to the page, unlike Gmail attachment ids,
 *     which is why one can be handed back to a caller at all.
 *
 * Size is deliberately absent: the HTML carries none, `HEAD` on a resource is
 * 405, and the `GET` sends no `Content-Length`. Nothing here may invent one.
 *
 * See issue #70.
 */

import { graphGet } from './api.js';
import { GraphError } from './client.js';
import { MAX_ATTACHMENT_BYTES, type AttachmentLoader } from './attachments.js';

/** A resource on a page, before anything has been fetched. */
export type PageResource = {
  /** The Graph resource id, stable enough to hand back to a caller. */
  id: string;
  filename: string;
  mime_type: string;
  /** Unknown until the bytes arrive. Never guessed. */
  size: null;
  /** 1-based position on the page, in document order. */
  position: number;
  kind: 'image' | 'file';
};

/** Same shape as page and section ids; the resource ids probed as this too. */
const RESOURCE_ID = /^[A-Za-z0-9!._~-]{1,300}$/;

/**
 * Pull the bare id out of a resource URL.
 *
 * The URLs in page HTML are absolute and embed the account's email address
 * (`users('someone@example.com')/onenote/resources/…`). Only the id travels on;
 * the caller rebuilds a `/me/` URL from it, so an address never rides along
 * into a tool result or a log line.
 */
const resourceId = (url: string): string | null => {
  const match = /\/onenote\/resources\/([^/]+)\/\$value/i.exec(url);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    // decodeURIComponent throws URIError on a malformed percent sequence. This
    // runs over every page read, not only attachment reads, so letting it
    // escape would make one odd URL turn a readable page into an error. An
    // unparseable id is a resource that cannot be addressed: skipped here, and
    // it was never in the list to begin with.
    return null;
  }
  return RESOURCE_ID.test(id) ? id : null;
};

/**
 * Read one attribute off a single tag's source text.
 *
 * The name is anchored to the whitespace before it rather than to a word
 * boundary. `\bsrc="` also matches inside `data-fullres-src="`, because the
 * hyphen is not a word character -- so the pattern would return whichever of
 * the two came first in the tag, which is the provider's choice and not ours.
 */
const attr = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag);
  return match ? match[1] : null;
};

/**
 * Every resource on the page, in document order.
 *
 * `<img>` is matched on `src` alone. OneNote repeats the same id in
 * `data-fullres-src`, and matching both would report one image twice.
 */
export const pageResources = (html: string): PageResource[] => {
  const found: PageResource[] = [];
  let images = 0;

  for (const [tag] of html.matchAll(/<(?:img|object)\b[^>]*>/gi)) {
    const isImage = /^<img/i.test(tag);
    const id = resourceId(attr(tag, isImage ? 'src' : 'data') ?? '');
    // An <img> pointing somewhere other than a page resource is not a page
    // attachment. Skipping it is not a gap: there is nothing to read.
    if (id === null) continue;

    if (isImage) {
      images += 1;
      const type = attr(tag, 'data-src-type') ?? 'image/png';
      found.push({
        id,
        // Composed, not read: an inline image has no name anywhere in the page.
        // Numbered by position among the images so a caller can say which one.
        filename: `image ${images} on the page`,
        mime_type: type,
        size: null,
        position: found.length + 1,
        kind: 'image',
      });
      continue;
    }

    found.push({
      id,
      filename: attr(tag, 'data-attachment') ?? 'an unnamed attachment',
      // Falls back to octet-stream, which reads downstream as "could be neither
      // read nor shown" — named as a gap rather than dropped.
      mime_type: attr(tag, 'type') ?? 'application/octet-stream',
      size: null,
      position: found.length + 1,
      kind: 'file',
    });
  }

  return found;
};

/**
 * Fetch one resource off a page, ready for the shared reading path.
 *
 * The size cap cannot be applied the way the Gmail loader applies it. Gmail
 * knows a size up front and refuses before spending the fetch; OneNote offers
 * none anywhere, so the only way to hold the same limit is to read the stream
 * and stop at it. An oversized file is therefore refused without ever being
 * held whole in memory, which is the property the cap exists for.
 *
 * The page is fetched first regardless, because it is the only place the type
 * and the name live. That is one extra request per read and it is not
 * avoidable.
 */
export const oneNoteLoader = (
  token: string,
  noteId: unknown,
  resourceIdParam: unknown,
): AttachmentLoader => {
  if (typeof noteId !== 'string' || !RESOURCE_ID.test(noteId)) {
    throw new GraphError('note_id is missing or malformed.', false);
  }
  if (typeof resourceIdParam !== 'string' || !RESOURCE_ID.test(resourceIdParam)) {
    throw new GraphError('attachment_id is missing or malformed.', false);
  }
  const wanted = resourceIdParam;

  return async () => {
    const page = await graphGet(
      `/me/onenote/pages/${encodeURIComponent(noteId)}/content`,
      token,
    );
    const resources = pageResources(await page.text());
    const found = resources.find((r) => r.id === wanted);
    if (!found) {
      // Name what is on the page. A bare "not found" invites a retry with the
      // same id, and the caller can act on the list.
      const available = resources.length
        ? resources.map((r) => `${r.id} (${r.filename})`).join(', ')
        : 'none';
      throw new GraphError(
        `That page has no attachment ${wanted}. Available: ${available}.`,
        false,
      );
    }

    const meta = {
      id: found.id,
      filename: found.filename,
      mime_type: found.mime_type,
      size: found.size,
    };

    const res = await graphGet(
      `/me/onenote/resources/${encodeURIComponent(wanted)}/$value`,
      token,
    );
    if (!res.body) throw new GraphError('That attachment came back empty.', false);

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        // size stays null: the read stopped early, so the real size is not
        // known and must not be implied by the number reached.
        return { oversized: true as const, meta };
      }
    }

    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    // Now it is known, so it is reported.
    return { oversized: false as const, meta: { ...meta, size: total }, bytes };
  };
};
