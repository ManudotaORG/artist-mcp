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
  action: 'append' | 'replace' | 'insert';
  content: string;
  /** Only an insert has one. Graph ignores it elsewhere rather than refusing. */
  position?: 'before' | 'after';
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
 * Put a new element beside an existing one.
 *
 * Graph lists `insert` for a `table` with a `position` of `before` or `after`,
 * and this is the only way a new block reaches the middle of a page: `append`
 * can only reach the end of the body, so without a sibling insert a section
 * added to a template lands after everything, which for these pages is after
 * the signature block rather than where it belongs.
 *
 * The anchor is named by its generated id for the same reason a replace is —
 * `data-id` targets resolve for `append` and not for this, and the failure is
 * a `20134` that reads as though the element could not be edited.
 */
export const insertCommand = (
  generatedId: string,
  position: 'before' | 'after',
  contentHtml: string,
): PatchCommand => {
  if (!isGeneratedId(generatedId)) {
    throw failure(
      `An insert must name the generated id of the element to sit beside, not ` +
        `"${generatedId}". Read the page again and use the id it reports.`,
    );
  }

  return { target: generatedId, action: 'insert', position, content: contentHtml };
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

/**
 * The markup a caller may send, and nothing else.
 *
 * A table cannot be written as plain text — that is the whole reason this
 * exists — so the escaping that protects `paragraph()` is not available here,
 * and something else has to stand in its place. What stands in its place is
 * refusal: every tag, every attribute and every style is checked against these
 * sets, and anything outside them stops the write rather than being quietly
 * stripped.
 *
 * Refusal rather than sanitising, because the two fail in opposite directions.
 * A stripped attribute produces a page that was written and is subtly not what
 * was previewed; a refusal produces no page change at all. OneNote keeps no
 * version and no bin, so the second is recoverable and the first is not.
 */
const ALLOWED_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'sub',
  'sup',
  'span',
  'div',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
]);

/** `br` is the only empty element allowed; `img` and `object` are not content a caller composes. */
const VOID_TAGS = new Set(['br']);

const GLOBAL_ATTRS = new Set(['data-id', 'lang', 'style']);

const ATTRS_BY_TAG: Record<string, Set<string>> = {
  table: new Set(['border', 'width', 'cellpadding', 'cellspacing']),
  td: new Set(['colspan', 'rowspan', 'align', 'valign', 'width']),
  th: new Set(['colspan', 'rowspan', 'align', 'valign', 'width']),
  a: new Set(['href']),
};

/**
 * What may appear in a `style`, which OneNote's own tables lean on heavily for
 * borders and widths — so forbidding it outright would mean every replaced
 * table came back unstyled.
 *
 * Brackets and quotes are out, which removes `url(...)`, `expression(...)` and
 * anything that could carry a second value inside the first. Colours, widths
 * and border shorthands all survive that.
 */
const SAFE_STYLE = /^[-a-zA-Z0-9 _.,:;%#/]*$/;

/** Only what a musician's own note would contain. No `javascript:`, no `data:`. */
const SAFE_HREF = /^https?:\/\/[^\s"'<>]+$/;

/** Which parents a structural tag may sit under, so a malformed table is caught here. */
const REQUIRED_PARENT: Record<string, string[]> = {
  tr: ['table', 'thead', 'tbody'],
  td: ['tr'],
  th: ['tr'],
  thead: ['table'],
  tbody: ['table'],
  li: ['ul', 'ol'],
};

const ATTR = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const checkAttributes = (tag: string, raw: string): void => {
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    if (name.startsWith('on')) {
      throw failure(`<${tag}> carries "${name}", which is a script handler. Nothing was written.`);
    }

    const allowed = GLOBAL_ATTRS.has(name) || (ATTRS_BY_TAG[tag]?.has(name) ?? false);
    if (!allowed) {
      throw failure(
        `<${tag}> carries the attribute "${name}", which this tool will not send to ` +
          'OneNote. Nothing was written. Keep the markup to tables, rows, cells, ' +
          'paragraphs, lists and simple emphasis.',
      );
    }

    if (name === 'style' && !SAFE_STYLE.test(value)) {
      throw failure(
        `The style on <${tag}> contains something this tool will not send: ` +
          `"${value}". Nothing was written. Plain declarations such as ` +
          '"border:1pt solid #a3a3a3" are fine; brackets and quotes are not.',
      );
    }

    if (name === 'href' && !SAFE_HREF.test(value)) {
      throw failure(`The link "${value}" is not an http(s) address. Nothing was written.`);
    }
  }
};

/**
 * Well-formed, allowed, and balanced — or nothing is sent.
 *
 * Returns the markup unchanged on success. It is deliberately not a normaliser:
 * what goes to Graph is byte-for-byte what was hashed into the confirmation
 * token and shown in the preview, so there is no room for a rewrite between
 * the musician's yes and the write.
 */
export const validateFragment = (html: string): string => {
  const trimmed = html.trim();
  if (trimmed === '') throw failure('There is no content to write.');

  const stack: string[] = [];
  const step = /<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = step.exec(trimmed)) !== null) {
    const between = trimmed.slice(cursor, match.index);
    if (between.includes('<')) {
      throw failure(
        'That markup has a stray "<" in it, so it is not well-formed and OneNote ' +
          'would either refuse it or write something other than what was previewed. ' +
          'Nothing was written. Write a literal less-than as &lt;.',
      );
    }
    cursor = match.index + match[0].length;

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfClosing = match[4] === '/';

    if (!ALLOWED_TAGS.has(tag)) {
      throw failure(
        `<${tag}> is not a tag this tool will send to OneNote. Nothing was written. ` +
          'Tables, rows, cells, paragraphs, headings, lists and simple emphasis are ' +
          'what a page is made of here.',
      );
    }

    if (closing) {
      const open = stack.pop();
      if (open !== tag) {
        throw failure(
          `That markup closes </${tag}> where <${open ?? 'nothing'}> was open. Malformed ` +
            'HTML in a patch can corrupt the page, and OneNote keeps no version of ' +
            'one, so nothing was written.',
        );
      }
      continue;
    }

    checkAttributes(tag, match[3]);

    const parents = REQUIRED_PARENT[tag];
    if (parents !== undefined && !parents.includes(stack[stack.length - 1] ?? '')) {
      throw failure(
        `<${tag}> has to sit inside ${parents.map((t) => `<${t}>`).join(' or ')}, and here ` +
          `it sits inside <${stack[stack.length - 1] ?? 'nothing'}>. Nothing was written.`,
      );
    }

    if (VOID_TAGS.has(tag)) {
      // `<br>` and `<br/>` both, since a caller writing HTML by hand produces
      // either and neither is a reason to refuse a table.
      continue;
    }
    if (selfClosing) {
      throw failure(`<${tag}/> cannot be empty. Nothing was written.`);
    }

    stack.push(tag);
  }

  if (trimmed.slice(cursor).includes('<')) {
    throw failure(
      'That markup ends in an unfinished tag. Nothing was written.',
    );
  }

  if (stack.length > 0) {
    throw failure(
      `That markup leaves <${stack[stack.length - 1]}> unclosed. Malformed HTML in a ` +
        'patch can corrupt the page, and OneNote keeps no version of one, so nothing ' +
        'was written.',
    );
  }

  return trimmed;
};

/**
 * The tag of the single element a fragment consists of, or undefined if it is
 * not exactly one element.
 *
 * A replace must yield an element of the kind the target supports: a table
 * replaced by two tables, or by a table and a stray paragraph, is not the
 * change that was previewed as one table.
 */
export const rootTag = (html: string): string | undefined => {
  const trimmed = html.trim();
  const open = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(trimmed);
  if (open === null) return undefined;

  // extractElement finds its opening tag by attribute, which a root has no
  // need of, so the balance is counted here directly rather than borrowed.
  const tag = open[1].toLowerCase();
  const step = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = step.exec(trimmed)) !== null) {
    if (match[2] === '/') continue;
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      return match.index + match[0].length === trimmed.length ? tag : undefined;
    }
  }
  return undefined;
};

export type EditablePart = {
  element_id: string;
  /** A table is replaced whole and with HTML; everything else takes plain text. */
  kind: 'text' | 'table';
  /** As the musician reads it: a table as its rows, anything else as its text. */
  text: string;
  /** The table this sits in, if it does. Null for a top-level element. */
  inside_table: string | null;
};

export type EditDraft = {
  page_id: string;
  action: 'append' | 'replace' | 'insert';
  /** The generated id of the element to replace, or to sit beside. Absent for an append. */
  element_id: string | null;
  /** Plain text, escaped on the way out. Null when the change is markup. */
  text: string | null;
  /** Validated markup. Null when the change is plain text. */
  html: string | null;
  /** Which side of the anchor an insert lands on. Null otherwise. */
  position: 'before' | 'after' | null;
  source_page: string | null;
};

/** As in onenote-write.ts: opaque, but concatenated into URLs. */
const ONENOTE_ID = /^[A-Za-z0-9!._~-]{1,300}$/;

const MAX_TEXT_CHARS = 4_000;

/**
 * Markup gets a larger ceiling than text, and for a reason that is not
 * generosity: one of these pages carries a roster table of a dozen rows, and a
 * whole-table replace has to be able to carry the whole table or the capability
 * does not exist. It is still a ceiling — a change larger than this is a page,
 * and a page is created rather than patched.
 */
const MAX_HTML_CHARS = 20_000;

export const editFrom = (params: Record<string, unknown>): EditDraft => {
  const pageId = params.page_id;
  if (typeof pageId !== 'string' || !ONENOTE_ID.test(pageId)) {
    throw failure('page_id is required, and must name the page to change.');
  }

  const action = params.action;
  if (action !== 'append' && action !== 'replace' && action !== 'insert') {
    throw failure(
      "action must be 'append', 'replace' or 'insert'. Nothing else can be done to a page.",
    );
  }

  const rawText = params.text;
  const rawHtml = params.html;
  const hasText = typeof rawText === 'string' && rawText.trim() !== '';
  const hasHtml = typeof rawHtml === 'string' && rawHtml.trim() !== '';

  // Two ways to say what to write, and exactly one of them per change. Silently
  // preferring one would mean a caller that filled in both gets a page holding
  // the half it was not looking at.
  if (hasText && hasHtml) {
    throw failure(
      'Give either text or html, not both. text is written as one paragraph with ' +
        'nothing interpreted; html is markup and is what a table has to be written as.',
    );
  }
  if (!hasText && !hasHtml) {
    throw failure('text or html is required: there is nothing to write.');
  }

  if (hasText && (rawText as string).length > MAX_TEXT_CHARS) {
    throw failure(
      `That is ${(rawText as string).length} characters. An edit records a decision, ` +
        `not a page — ${MAX_TEXT_CHARS} is the most. A longer change is a new page.`,
    );
  }
  if (hasHtml && (rawHtml as string).length > MAX_HTML_CHARS) {
    throw failure(
      `That is ${(rawHtml as string).length} characters of markup. ${MAX_HTML_CHARS} is ` +
        'the most a single patch may carry. A change larger than that is a new page.',
    );
  }

  // Validated here rather than at the point of sending, so a malformed table is
  // refused by the preview — before anybody is asked to approve it, and long
  // before anything reaches the page.
  const html = hasHtml ? validateFragment(rawHtml as string) : null;
  const text = hasText ? (rawText as string) : null;

  const elementId = params.element_id;
  const named = typeof elementId === 'string' && elementId !== '';

  if (action === 'append') {
    if (named) {
      throw failure(
        'An append goes at the end of the page and takes no element_id. To change ' +
          'something already written use replace, and to put something beside an ' +
          'existing table use insert.',
      );
    }
  } else if (!named || !isGeneratedId(elementId as string)) {
    throw failure(
      `A ${action} needs element_id: the generated id of the part to ` +
        `${action === 'replace' ? 'change' : 'sit beside'}, as preview_onenote_edit ` +
        'reports it. Read the page again if you do not have one.',
    );
  }

  const targetsTable = named && isTableId(elementId as string);

  // The three rules Graph imposes, stated where a caller meets them rather than
  // left to be discovered as a 20138. `tr` and `td` support no update action at
  // all, so a table is changed by replacing the whole of it — and a whole table
  // cannot be expressed as plain text.
  if (action === 'replace' && targetsTable) {
    if (html === null) {
      throw failure(
        'A table is replaced with markup, not plain text: pass the whole new table ' +
          'as html, starting with <table> and ending with </table>. OneNote supports ' +
          'no update action on a row or a cell, so the whole table is the unit.',
      );
    }
    if (rootTag(html) !== 'table') {
      throw failure(
        'Replacing a table has to yield exactly one table. Send one <table> element ' +
          'and nothing beside it.',
      );
    }
  }

  if (action === 'replace' && !targetsTable && html !== null) {
    throw failure(
      'Only a table is replaced with markup. This element takes plain text, written ' +
        'as one paragraph. To restructure a section, replace the table it lives in.',
    );
  }

  if (action === 'insert' && !targetsTable) {
    throw failure(
      'insert puts a new block beside a table, and element_id does not name one. ' +
        'OneNote supports a sibling insert on a table; for anything else the ways to ' +
        'add content are append, at the end of the page, and replace.',
    );
  }

  const position = params.position;
  if (action === 'insert') {
    if (position !== 'before' && position !== 'after') {
      throw failure("An insert needs position: 'before' or 'after' the table named.");
    }
    if (html === null) {
      throw failure('An insert writes markup: pass the new block as html.');
    }
  } else if (position !== undefined && position !== null && position !== '') {
    throw failure('position belongs to an insert and to nothing else.');
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
    element_id: action === 'append' ? null : (elementId as string),
    text,
    html,
    position: action === 'insert' ? (position as 'before' | 'after') : null,
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
  const canonical = [
    draft.page_id,
    draft.action,
    draft.element_id ?? '',
    draft.position ?? '',
    draft.text ?? '',
    // The markup itself, not a rendering of it. The preview shows a table as
    // rows because that is what can be read, but two different tables can render
    // to the same rows — so what the token binds is what would actually be sent.
    draft.html ?? '',
  ].join(' ');
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
 * The elements of one kind directly inside a fragment, each whole.
 *
 * Depth-counted like `extractElement`, and for the same reason: a lazy match
 * returns half a row whenever a cell holds anything with a closing tag of its
 * own. Where the markup does not balance it stops rather than guessing, which
 * shows up as a short table in the preview and is meant to — a preview that
 * silently drops rows is worse than one that visibly ends early.
 */
const childElements = (html: string, tags: string): string[] => {
  const out: string[] = [];
  const open = new RegExp(`<(?:${tags})\\b[^>]*>`, 'gi');
  let start: RegExpExecArray | null;

  while ((start = open.exec(html)) !== null) {
    const step = new RegExp(`<(/?)(?:${tags})\\b[^>]*?(/?)>`, 'gi');
    step.lastIndex = start.index;
    let depth = 0;
    let closed = false;
    let match: RegExpExecArray | null;

    while ((match = step.exec(html)) !== null) {
      if (match[2] === '/') continue;
      depth += match[1] === '/' ? -1 : 1;
      if (depth === 0) {
        out.push(html.slice(start.index, match.index + match[0].length));
        open.lastIndex = match.index + match[0].length;
        closed = true;
        break;
      }
    }

    if (!closed) break;
  }

  return out;
};

/** A table as its cell text, row by row. */
export const tableRows = (tableHtml: string): string[][] =>
  childElements(tableHtml, 'tr').map((row) =>
    childElements(row, 'td|th').map((cell) => asText(cell).replace(/\s*\n\s*/g, ' / ')),
  );

const CELL_WIDTH = 40;

/**
 * A table as something a musician can read and say yes or no to.
 *
 * This is the difference between a whole-table replace being previewable and
 * not. The thing a replace destroys here is a block of markup hundreds of
 * characters wide; shown raw it is not a preview, it is a wall that gets
 * approved unread — and an approval nobody could read is exactly the failure
 * the confirmation step exists to prevent. So the table is shown as its rows.
 *
 * Columns are padded to line up, and a long cell is cut with an ellipsis: the
 * shape of the table is what tells the reader whether the right one is about to
 * be overwritten, and that shape is unreadable when one cell is a paragraph.
 */
export const renderTable = (tableHtml: string): string => {
  const rows = tableRows(tableHtml);
  if (rows.length === 0) return asText(tableHtml);

  const clipped = rows.map((row) =>
    row.map((cell) => (cell.length > CELL_WIDTH ? `${cell.slice(0, CELL_WIDTH - 1)}…` : cell)),
  );
  const columns = Math.max(...clipped.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(...clipped.map((row) => (row[i] ?? '').length)),
  );

  return clipped
    .map(
      (row) =>
        `  | ${Array.from({ length: columns }, (_, i) => (row[i] ?? '').padEnd(widths[i])).join(' | ')} |`,
    )
    .join('\n');
};

/** Whether a generated id names a table, which decides what may be done to it. */
export const isTableId = (id: string): boolean => id.startsWith('table:');

/**
 * How an element reads, whichever kind it is.
 *
 * A table goes through `renderTable` and everything else through `asText`, so
 * one call site does not have to know which it is holding.
 */
const readable = (elementHtml: string, id: string): string =>
  isTableId(id) ? renderTable(elementHtml) : asText(elementHtml);

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
): Promise<{ html: string; etag: string | null; parts: EditablePart[] }> => {
  const { html, etag } = await onenotePageContent(pageId, token);
  const ids = readTargets(html).generatedIds.filter((id) =>
    /^(?:p|h[1-6]|li|table):/.test(id),
  );

  // Which table, if any, each element sits inside. Read once here rather than
  // per part: the enclosing table has to be extracted anyway, and on a page of
  // twenty tables the alternative is quadratic in the page.
  const tables = ids
    .filter(isTableId)
    .map((id) => ({ id, html: extractElement(html, 'id', id) }))
    .filter((t): t is { id: string; html: string } => t.html !== undefined);

  const parts = ids
    .map((id): EditablePart => {
      const element = extractElement(html, 'id', id);
      return {
        element_id: id,
        kind: isTableId(id) ? 'table' : 'text',
        text: element === undefined ? '' : readable(element, id),
        // A paragraph in a cell is listed, because it is there and hiding it
        // would be a lie about the page. But Graph supports no update action on
        // `tr` or `td`, so what a replace aimed at it does is not something this
        // tool can promise — the documented way to change a cell is to replace
        // the whole table, and the caller is told which one that is.
        inside_table: isTableId(id)
          ? null
          : (tables.find((t) => t.html.includes(`id="${id}"`))?.id ?? null),
      };
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
  // An insert is the same shape: it names a table it can only have learnt about
  // by reading the page first.
  //
  // No confirmation token comes back from this branch. Nothing has been chosen
  // yet, and a token would be one for a change nobody has described.
  const wantsPart =
    (params.action === 'replace' || params.action === 'insert') &&
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

  // What the change says, rendered the way the thing it touches is rendered, so
  // the before and the after in a preview are comparable rather than one being
  // rows and the other markup.
  const proposed =
    draft.html === null
      ? (draft.text as string).trim()
      : rootTag(draft.html) === 'table'
        ? renderTable(draft.html)
        : asText(draft.html);

  if (draft.action === 'append') {
    return {
      preview: `Add to the end of the page:\n\n${proposed}`,
      page_id: draft.page_id,
      parts,
      confirmation_token: await editToken(draft, ''),
      note:
        'Show this to the musician and wait for their yes. Nothing on the page is ' +
        'changed or removed by an append — it adds to the end.',
    };
  }

  // Captured for both, and for different reasons. A replace needs it because it
  // is the only copy of what is about to be destroyed. An insert destroys
  // nothing, but it lands relative to this element — so binding the token to the
  // anchor's current content is what makes "the page changed since you looked"
  // a refusal rather than a block that quietly lands somewhere else.
  const captured = preImage(html, draft.element_id as string);
  const anchor = readable(captured, draft.element_id as string);

  if (draft.action === 'insert') {
    return {
      preview:
        `Put this ${draft.position} the table that currently reads:\n\n${anchor}\n\n` +
        `New block:\n\n${proposed}`,
      page_id: draft.page_id,
      parts,
      confirmation_token: await editToken(draft, captured),
      note:
        'Show this to the musician and wait for their yes. Nothing is overwritten ' +
        'or removed — this adds a block beside the table quoted above. If that ' +
        'table is not the one they mean, the block will land in the wrong place.',
    };
  }

  return {
    preview: `Replace this:\n\n${anchor}\n\nWith this:\n\n${proposed}`,
    page_id: draft.page_id,
    parts,
    confirmation_token: await editToken(draft, captured),
    note:
      'Show this to the musician and wait for their yes. This overwrites what is ' +
      'quoted above' +
      (isTableId(draft.element_id as string)
        ? ' — the whole table, every row of it, because OneNote supports no change ' +
          'to a single row or cell'
        : '') +
      ', and OneNote keeps no version of a page — what it replaces is ' +
      "kept in this install's own write log and nowhere else.",
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

  const captured = draft.action === 'append' ? '' : preImage(html, draft.element_id as string);

  const expected = await editToken(draft, captured);
  if (params.confirmation_token !== expected) {
    throw failure(
      draft.action === 'append'
        ? 'The confirmation token does not match these values. Call ' +
          'preview_onenote_edit again with exactly what should be written, show the ' +
          'musician what it returns, then apply it with those same values.'
        : 'That part of the page is not what was previewed — either the values ' +
          'changed, or the page did since it was shown. Nothing was written. Call ' +
          'preview_onenote_edit again and show the musician what it returns now.',
    );
  }

  // Plain text becomes exactly one escaped paragraph, as it always has. Markup
  // goes out as the caller wrote it — validated in `editFrom`, hashed into the
  // token, and unchanged since the musician saw it rendered.
  const content = draft.html ?? paragraph(draft.text as string);

  const command =
    draft.action === 'append'
      ? appendCommand('body', content)
      : draft.action === 'insert'
        ? insertCommand(
            draft.element_id as string,
            draft.position as 'before' | 'after',
            content,
          )
        : replaceCommand(draft.element_id as string, content);

  await onenotePatchPage(draft.page_id, [command], token, etag);

  const wrote = draft.html === null ? (draft.text as string).trim() : draft.html;
  const destroyed = draft.action === 'replace' ? readable(captured, draft.element_id as string) : '';

  // After the write, and carrying what it destroyed. For a replace this line is
  // the only copy of the previous content that exists anywhere.
  await record({
    operation:
      draft.action === 'append'
        ? 'append_onenote_page'
        : draft.action === 'insert'
          ? 'insert_onenote_element'
          : 'replace_onenote_element',
    // The text itself, not merely that something happened. `summary` is
    // documented as what was written "as the user would read it back", and the
    // calendar rows honour that while these two originally named only the page
    // id — so the log recorded the replaced text in `pre_image` and left the
    // replacing text nowhere at all. Someone reading this line back is
    // reconstructing an edit they cannot see any other way.
    summary:
      draft.action === 'append'
        ? `Added to the end of the page: ${wrote}`
        : draft.action === 'insert'
          ? `Inserted ${draft.position} an existing table: ${wrote}`
          : `Replaced "${destroyed}" with "${wrote}"`,
    target: draft.page_id,
    source_page: draft.source_page,
    // Only a replace has one. An insert captured the anchor to bind its token,
    // but nothing of it was destroyed, and recording it as a pre-image would
    // put content in the log that is still on the page — which is the one thing
    // a reader of this log must be able to trust it does not do.
    pre_image: draft.action === 'replace' ? captured : null,
  });

  return {
    changed: true,
    page_id: draft.page_id,
    note:
      draft.action === 'append'
        ? 'The page now carries this at the end. Nothing was removed.'
        : draft.action === 'insert'
          ? 'The page now carries this block beside that table. Nothing was removed.'
          : 'The page now says this. What it said before is in this install\'s write ' +
            'log and nowhere else — OneNote keeps no version of a page, so tell the ' +
            'musician that rather than implying it can be undone in OneNote.',
  };
}
