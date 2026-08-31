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
