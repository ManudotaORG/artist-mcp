/**
 * Editing a page this tool created, and only such a page.
 *
 * Like `onenote-write.ts`, there is no ownership boundary in this file, and for
 * the same reason: `Notes.ReadWrite.CreatedByApp` refuses a page the musician
 * wrote before our code is consulted — verified as `401 40003` against a real
 * notebook. What *is* here is the machinery that makes a replace permissible at
 * all, which is a different question and ours to get right. See
 * docs/decisions/0004-onenote-page-maintenance.md.
 *
 * The rule that record rests on: **a replace may not proceed unless the content
 * it is about to destroy has been captured first.** OneNote keeps no version and
 * no recycle bin, so the pre-image is the only undo that exists. It is not a
 * feature attached to replacing; it is the reason replacing is allowed.
 *
 * Three facts about Graph's patch API are encoded below rather than remembered,
 * because two probe runs concluded the opposite of the truth from them:
 *
 *   1. A `data-id` target must carry a `#`. Without it the target does not
 *      resolve and Graph answers `20134`, which reads like "this element cannot
 *      be edited" and means "there is no such target".
 *   2. `20138` is the *other* thing — the element resolved and does not support
 *      that action. A paragraph returns it for `append` and always will, which
 *      is documented behaviour and not a sign anything is wrong.
 *   3. Replace requires the **generated** id, never a `data-id`, for everything
 *      except the title and images inside a div. Generated ids are returned only
 *      with `includeIDs=true`, and Microsoft warns they "might change after a
 *      page update" — so they are read immediately before the command that uses
 *      them, never carried across a write.
 */

import { onenotePageContent, onenotePatchPage } from './api.js';
import { type RecordWrite } from './audit.js';
import { GraphError } from './client.js';

const failure = (message: string): GraphError => new GraphError(message, false);

/**
 * A generated id as Graph emits it: `p:{guid}{40}`, and for a div nested in a
 * div, the doubled `div:{guid}{42}:{guid}{45}`.
 *
 * Shape-checked because it is concatenated into a JSON command that Graph acts
 * on, and because it is the one value here that decides what gets destroyed. A
 * caller that has invented an id, or kept one across a write, should be refused
 * rather than allowed to overwrite whatever that id now points at.
 */
const GENERATED_ID =
  /^(?:p|div|ol|ul|li|table|img|object|h[1-6]):\{[0-9a-fA-F-]{36}\}\{\d+\}(?::\{[0-9a-fA-F-]{36}\}\{\d+\})?$/;

export const isGeneratedId = (id: string): boolean => GENERATED_ID.test(id);

export type PageTargets = {
  /** Author-supplied, addressed with a leading `#`. Usable for append only. */
  dataIds: string[];
  /** Graph-generated, addressed bare. Required for replace. */
  generatedIds: string[];
};

/**
 * What the page currently offers as targets.
 *
 * Read from the output of `GET .../content?includeIDs=true`. Both attributes
 * are collected because they are not interchangeable: `data-id` is ours and
 * survives a round trip, `id` is Graph's and moves. A caller wanting to replace
 * needs the second even when it labelled the element with the first.
 */
export const readTargets = (html: string): PageTargets => ({
  dataIds: [...html.matchAll(/\sdata-id="([^"]+)"/g)].map((m) => m[1]),
  generatedIds: [...html.matchAll(/\sid="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id) => isGeneratedId(id)),
});

/**
 * Cut one element, with its children, out of the page HTML.
 *
 * Depth-counted rather than matched with a lazy regex. A non-greedy match to
 * the first closing tag returns a fragment whenever the target has children,
 * and a fragment restores as silent truncation — which is the precise failure
 * a pre-image exists to prevent. Returns undefined rather than guessing when
 * the markup does not balance.
 */
export const extractElement = (
  html: string,
  attr: 'id' | 'data-id',
  value: string,
): string | undefined => {
  const quoted = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\b${attr}="${quoted}"[^>]*>`, 'i').exec(html);
  if (open === null) return undefined;

  const tag = open[1];
  const step = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  step.lastIndex = open.index;

  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = step.exec(html)) !== null) {
    // A self-closing tag enters and leaves in one token.
    if (match[2] === '/') continue;
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(open.index, match.index + match[0].length);
  }

  return undefined;
};

/**
 * The content a replace is about to destroy, or a refusal.
 *
 * Throws rather than returning undefined, because every caller must treat a
 * failed capture as a reason not to write. Making that the return type would
 * let a caller carry on with `?? ''` and destroy a paragraph with nothing held
 * back, which is exactly the outcome 0004 forbids.
 */
export const preImage = (html: string, generatedId: string): string => {
  if (!isGeneratedId(generatedId)) {
    throw failure(
      `"${generatedId}" is not a generated element id. A replace has to name one, ` +
        'read from the page immediately beforehand.',
    );
  }

  const captured = extractElement(html, 'id', generatedId);
  if (captured === undefined) {
    throw failure(
      'The element to be replaced could not be read back from the page, so what ' +
        'the change would overwrite cannot be captured. Nothing was changed. ' +
        'OneNote keeps no version of a page, so a replace without that capture ' +
        'would be unrecoverable.',
    );
  }

  return captured;
};

export type PatchCommand = {
  target: string;
  action: 'append' | 'replace';
  content: string;
};

/**
 * Append to a container.
 *
 * `body` and `title` are keywords and take no prefix; everything else appended
 * to is addressed by `data-id`, which does. Getting this wrong is not a visible
 * error — it is a `20134` that reads as though the element were uneditable.
 */
export const appendCommand = (target: string, contentHtml: string): PatchCommand => {
  if (target === 'title') {
    throw failure('A title cannot be appended to; it can only be replaced.');
  }

  return {
    target: target === 'body' || isGeneratedId(target) ? target : `#${target.replace(/^#/, '')}`,
    action: 'append',
    content: contentHtml,
  };
};

/**
 * Replace one element, named by its generated id.
 *
 * `data-id` is refused rather than translated. Graph accepts a `data-id` for a
 * replace on images and objects only, and silently doing the wrong thing for
 * every other element would mean a command that looks right and either fails
 * confusingly or hits something other than what was meant.
 */
export const replaceCommand = (generatedId: string, contentHtml: string): PatchCommand => {
  if (!isGeneratedId(generatedId)) {
    throw failure(
      `A replace must name a generated element id, not "${generatedId}". Read the ` +
        'page with includeIDs=true and use the id it reports for the element.',
    );
  }

  return { target: generatedId, action: 'replace', content: contentHtml };
};

/**
 * XHTML entities, as in onenote-write.ts and for the same reason: a model
 * composing a correction from an email is passing through text it did not
 * author, and unescaped markup would let that text decide what the page says.
 */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Plain text as a single paragraph, which is what replaces a paragraph.
 *
 * A replace must yield an element of a kind the target supports, so this is
 * deliberately not general: one `<p>`, with line breaks preserved and nothing
 * else interpreted. Anything richer is a different operation and should be
 * decided rather than smuggled in through the content string.
 */
export const paragraph = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') throw failure('There is no text to write.');
  return `<p>${escapeXml(trimmed).replace(/\n/g, '<br/>')}</p>`;
};

/** As in onenote-write.ts: opaque, but concatenated into URLs. */
const ONENOTE_ID = /^[A-Za-z0-9!._~-]{1,300}$/;

const MAX_TEXT_CHARS = 4_000;

export type EditDraft = {
  page_id: string;
  action: 'append' | 'replace';
  /** The generated id of the element to replace. Absent for an append. */
  element_id: string | null;
  text: string;
  source_page: string | null;
};

export const editFrom = (params: Record<string, unknown>): EditDraft => {
  const pageId = params.page_id;
  if (typeof pageId !== 'string' || !ONENOTE_ID.test(pageId)) {
    throw failure('page_id is required, and must name the page to change.');
  }

  const action = params.action;
  if (action !== 'append' && action !== 'replace') {
    throw failure("action must be either 'append' or 'replace'. Nothing else can be done to a page.");
  }

  const text = params.text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw failure('text is required: there is nothing to write.');
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw failure(
      `That is ${text.length} characters. An edit records a decision, not a page — ` +
        `${MAX_TEXT_CHARS} is the most. A longer change is a new page.`,
    );
  }

  const elementId = params.element_id;
  if (action === 'replace') {
    if (typeof elementId !== 'string' || !isGeneratedId(elementId)) {
      throw failure(
        'A replace needs element_id: the generated id of the part to change, as ' +
          'preview_onenote_edit reports it. Read the page again if you do not have one.',
      );
    }
  } else if (elementId !== undefined && elementId !== null && elementId !== '') {
    throw failure(
      'An append goes at the end of the page and takes no element_id. To change ' +
        'something already written, use replace.',
    );
  }

  const source = params.source_page;
  if (source !== undefined && source !== null && source !== '') {
    if (typeof source !== 'string' || !ONENOTE_ID.test(source)) {
      throw failure('source_page is malformed.');
    }
  }

  return {
    page_id: pageId,
    action,
    element_id: action === 'replace' ? (elementId as string) : null,
    text,
    source_page: typeof source === 'string' && source !== '' ? source : null,
  };
};

const base32hex = (bytes: Uint8Array): string => {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
};

/**
 * The token a preview returns and an edit must carry back.
 *
 * Derived from the payload **and from what the change would destroy**, which is
 * the one difference from the create token and the reason this is not shared
 * with `onenote-write.ts`. A create can only be wrong about what it writes. A
 * replace can also be wrong about what it overwrites — and the id naming that
 * content moves after every page update, so an id that was correct at preview
 * may point at something else by the time the edit is applied.
 *
 * Hashing the pre-image makes that case fail closed: the edit is refused unless
 * the element still holds exactly what the musician was shown.
 */
export const editToken = async (draft: EditDraft, preImageHtml: string): Promise<string> => {
  const canonical = [draft.page_id, draft.action, draft.element_id ?? '', draft.text].join(' ');
  const data = new TextEncoder().encode(`confirm-edit ${canonical} ${preImageHtml}`);
  return base32hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
};

/**
 * Strip tags for display. The page is shown as the musician reads it, not as
 * HTML — and this text is what they approve a destructive change against, so
 * markup leaking into it is not cosmetic.
 *
 * Numeric entities are decoded as well as named ones. We write `&apos;`, but
 * OneNote stores an apostrophe as `&#39;` and hands it back that way, so a
 * decoder built only from what this file emits showed a preview reading
 * "the product&#39;s own tool path" — observed on a real page.
 *
 * Ampersand last, or the entities the earlier passes produce get decoded again.
 */
const asText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

/**
 * What the page currently says, element by element, so a caller can name the
 * part to change without guessing an id.
 *
 * Every id here is read in this call and is only good for the next one. They
 * are not stable identifiers and must never be stored, handed to a musician, or
 * quoted back in a later session — Microsoft says they "might change after a
 * page update", and that was observed rather than merely read.
 */
export const readEditableParts = async (
  token: string,
  pageId: string,
): Promise<{ html: string; etag: string | null; parts: { element_id: string; text: string }[] }> => {
  const { html, etag } = await onenotePageContent(pageId, token);
  const parts = readTargets(html)
    .generatedIds.filter((id) => /^(?:p|h[1-6]|li):/.test(id))
    .map((id) => {
      const element = extractElement(html, 'id', id);
      return { element_id: id, text: element === undefined ? '' : asText(element) };
    })
    .filter((part) => part.text !== '');

  return { html, etag, parts };
};

/**
 * Show the change that would be made, and hand back the token making it needs.
 *
 * A read despite the name, exactly as the calendar and create previews are.
 */
export async function previewEdit(token: string, params: Record<string, unknown>) {
  // Naming a part to replace requires knowing its id, and an id is only
  // knowable by reading the page. So a replace with no element_id is not a
  // malformed call — it is the first half of the only workflow available, and
  // the tool text says so. It used to be refused here, which meant a model
  // following that text got an error and had to guess its way out.
  //
  // No confirmation token comes back from this branch. Nothing has been chosen
  // yet, and a token would be one for a change nobody has described.
  const wantsPart =
    params.action === 'replace' &&
    (params.element_id === undefined || params.element_id === null || params.element_id === '');

  if (wantsPart) {
    const pageId = params.page_id;
    if (typeof pageId !== 'string' || !ONENOTE_ID.test(pageId)) {
      throw failure('page_id is required, and must name the page to change.');
    }

    const { parts } = await readEditableParts(token, pageId);
    return {
      preview: null,
      page_id: pageId,
      parts,
      confirmation_token: null,
      note:
        parts.length === 0
          ? 'This page has no separately editable parts, so nothing on it can be ' +
            'replaced. An append can still add to the end of it.'
          : 'Nothing has been previewed yet. These are the parts of the page as it ' +
            'stands. Name one as element_id and preview again to see the change ' +
            'itself. The ids were read just now and are good only for the next call.',
    };
  }

  const draft = editFrom(params);
  const { html, parts } = await readEditableParts(token, draft.page_id);

  if (draft.action === 'append') {
    return {
      preview: `Add to the end of the page:\n\n${draft.text.trim()}`,
      page_id: draft.page_id,
      parts,
      confirmation_token: await editToken(draft, ''),
      note:
        'Show this to the musician and wait for their yes. Nothing on the page is ' +
        'changed or removed by an append — it adds to the end.',
    };
  }

  const captured = preImage(html, draft.element_id as string);

  return {
    preview:
      `Replace this:\n\n${asText(captured)}\n\nWith this:\n\n${draft.text.trim()}`,
    page_id: draft.page_id,
    parts,
    confirmation_token: await editToken(draft, captured),
    note:
      'Show this to the musician and wait for their yes. This overwrites what is ' +
      'quoted above, and OneNote keeps no version of a page — what it replaces is ' +
      'kept in this install\'s own write log and nowhere else.',
  };
}

/**
 * Apply the change, having shown it.
 *
 * The page is read again here rather than trusted from the preview, and that is
 * not caution: generated ids move after any page update, so an id that was
 * right at preview may name something else by now. Re-reading also produces the
 * ETag that goes out as `If-Match`, which is what makes the musician typing in
 * OneNote between the two calls a refusal rather than a silent overwrite.
 *
 * The confirmation token is checked against the payload *and* the pre-image, so
 * an element whose content changed since the preview fails closed.
 */
export async function applyEdit(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite,
) {
  const draft = editFrom(params);
  const { html, etag } = await onenotePageContent(draft.page_id, token);

  const captured = draft.action === 'replace' ? preImage(html, draft.element_id as string) : '';

  const expected = await editToken(draft, captured);
  if (params.confirmation_token !== expected) {
    throw failure(
      draft.action === 'replace'
        ? 'That part of the page is not what was previewed — either the values ' +
          'changed, or the page did since it was shown. Nothing was written. Call ' +
          'preview_onenote_edit again and show the musician what it returns now.'
        : 'The confirmation token does not match these values. Call ' +
          'preview_onenote_edit again with exactly what should be written, show the ' +
          'musician what it returns, then apply it with those same values.',
    );
  }

  const command =
    draft.action === 'append'
      ? appendCommand('body', paragraph(draft.text))
      : replaceCommand(draft.element_id as string, paragraph(draft.text));

  await onenotePatchPage(draft.page_id, [command], token, etag);

  // After the write, and carrying what it destroyed. For a replace this line is
  // the only copy of the previous content that exists anywhere.
  await record({
    operation: draft.action === 'append' ? 'append_onenote_page' : 'replace_onenote_element',
    // The text itself, not merely that something happened. `summary` is
    // documented as what was written "as the user would read it back", and the
    // calendar rows honour that while these two originally named only the page
    // id — so the log recorded the replaced text in `pre_image` and left the
    // replacing text nowhere at all. Someone reading this line back is
    // reconstructing an edit they cannot see any other way.
    summary:
      draft.action === 'append'
        ? `Added to the end of the page: ${draft.text.trim()}`
        : `Replaced "${asText(captured)}" with "${draft.text.trim()}"`,
    target: draft.page_id,
    source_page: draft.source_page,
    pre_image: draft.action === 'replace' ? captured : null,
  });

  return {
    changed: true,
    page_id: draft.page_id,
    note:
      draft.action === 'append'
        ? 'The page now carries this at the end. Nothing was removed.'
        : 'The page now says this. What it said before is in this install\'s write ' +
          'log and nowhere else — OneNote keeps no version of a page, so tell the ' +
          'musician that rather than implying it can be undone in OneNote.',
  };
}
