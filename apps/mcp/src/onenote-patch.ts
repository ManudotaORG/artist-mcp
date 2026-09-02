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

/** One change. A draft carries a list of these, even when the list has one entry. */
export type EditChange = {
  action: 'append' | 'replace' | 'insert';
  /** The generated id of the element to replace, or to sit beside. Absent for an append. */
  element_id: string | null;
  /** Plain text, escaped on the way out. Null when the change is markup. */
  text: string | null;
  /** Validated markup. Null when the change is plain text. */
  html: string | null;
  /** Which side of the anchor an insert lands on. Null otherwise. */
  position: 'before' | 'after' | null;
};

export type EditDraft = {
  page_id: string;
  changes: EditChange[];
  source_page: string | null;
};

/**
 * The first element of a fragment, taken whole.
 *
 * Depth-counted, like everything else here that looks at markup: the first
 * closing tag is not the end of the element whenever it has children.
 */
const firstElement = (
  html: string,
): { tag: string; attrs: string; inner: string; whole: string } | undefined => {
  const open = /<([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/.exec(html);
  if (open === null || open.index !== html.search(/</)) return undefined;

  const tag = open[1].toLowerCase();
  const step = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  step.lastIndex = open.index;

  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = step.exec(html)) !== null) {
    if (match[2] === '/') continue;
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      const end = match.index + match[0].length;
      return {
        tag,
        attrs: open[2],
        inner: html.slice(open.index + open[0].length, match.index),
        whole: html.slice(open.index, end),
      };
    }
  }

  return undefined;
};

const attributeOf = (attrs: string, name: string): string | undefined => {
  const found = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs);
  return found === null ? undefined : found[1];
};

/**
 * What a replacement inherits from what it replaces, when it says nothing
 * itself.
 *
 * Verified against a real page rather than reasoned about, because both halves
 * of this were observed to fail silently:
 *
 *   - A bordered table replaced by a bare `<table>` comes back as
 *     `style="border:0px"`. The borders are not carried; they are removed.
 *   - A heading replaced by a bare `<p>` comes back with no `<span>` at all.
 *     On these pages a heading *is* a `<p>` holding one styled span — OneNote
 *     keeps no `h1`-`h6` — so the whole of what made it a heading is the thing
 *     that gets dropped.
 *
 * Neither shows up in a preview built from text, and neither is recoverable
 * without the pre-image. So the formatting of the element being replaced is
 * carried onto the replacement wherever the caller has not specified any, and
 * the preview says that it happened. Silent inheritance would be a change
 * nobody was shown, which is the same fault as a truncated preview.
 *
 * A caller that supplies its own styling has decided, and nothing is inherited.
 *
 * The values copied come out of the musician's own page rather than out of a
 * model, which is why they are not run back through `validateFragment` — the
 * same reasoning `scripts/copy-onenote-page.mjs` records for sending a page's
 * markup back verbatim. Only presentational attributes are copied: an `id` is
 * Graph's and a `data-id` is the author's, and duplicating either would make
 * the page address two elements the same way.
 */
const INHERITED_ATTRS = ['style', 'lang', 'align', 'width', 'border', 'cellpadding', 'cellspacing'];

export const inherit = (
  targetHtml: string,
  contentHtml: string,
): { html: string; notes: string[] } => {
  const target = firstElement(targetHtml);
  const content = firstElement(contentHtml);
  if (target === undefined || content === undefined) return { html: contentHtml, notes: [] };

  const notes: string[] = [];
  let attrs = content.attrs;

  if (target.tag === content.tag) {
    for (const name of INHERITED_ATTRS) {
      const value = attributeOf(target.attrs, name);
      if (value === undefined || attributeOf(attrs, name) !== undefined) continue;
      attrs += ` ${name}="${value}"`;
      notes.push(`${name} of the ${target.tag} it replaces`);
    }
  }

  let inner = content.inner;

  // A table's borders, which take more than copying its style attribute across.
  //
  // Observed twice, the second time by re-deriving it: a replacement carrying
  // the original's exact `style="border:1px solid;border-collapse:collapse"`
  // still came back as `border:0px` on the table and on every cell. OneNote
  // honours the **`border` attribute** on a `<table>`; the CSS border in the
  // style is not enough on a patch.
  //
  // `scripts/copy-onenote-page.mjs` already knew this — `preserveTableBorders`
  // adds `border="1"` wherever the style says bordered, and its commit message
  // says the copies came back unbordered without it. The same rule is applied
  // here rather than referenced, because that file is maintenance tooling this
  // package cannot import.
  if (target.tag === 'table' && content.tag === 'table') {
    const bordered =
      /\bborder\s*=\s*"?[1-9]/.test(target.attrs) ||
      /border\s*:\s*(?!0)(\d*\.?\d+)\s*(px|pt|em)?\s+solid/i.test(target.attrs);

    let carried = false;
    if (bordered && !/\bborder\s*=/.test(attrs)) {
      attrs += ' border="1"';
      carried = true;
    }

    // And the cells, which carry their own border in what OneNote hands back.
    // Only when the replacement specifies none anywhere: a caller that styled
    // one cell has decided about all of them.
    const cellStyle = /<t[dh]\b[^>]*\bstyle="([^"]*)"/i.exec(target.inner)?.[1];
    if (cellStyle !== undefined && !/<t[dh]\b[^>]*\bstyle="/i.test(inner)) {
      inner = inner.replace(/<(t[dh])(\b[^>]*?)?>/gi, `<$1$2 style="${cellStyle}">`);
      carried = true;
    }

    if (carried) notes.push('the borders of the table it replaces');
  }

  // Character formatting, which on these pages is where a heading lives. Only
  // when the target is exactly one styled span and the replacement carries no
  // styling of its own anywhere inside it.
  const wrapper = /^\s*<span\s+style="([^"]*)"\s*>([\s\S]*)<\/span>\s*$/i.exec(target.inner);
  if (
    wrapper !== null &&
    target.tag === content.tag &&
    !/<span\b/i.test(inner) &&
    !/\bstyle="/i.test(inner)
  ) {
    inner = `<span style="${wrapper[1]}">${inner}</span>`;
    notes.push(`the character styling inside the ${target.tag} it replaces`);
  }

  if (notes.length === 0) return { html: contentHtml, notes };

  const rebuilt = `<${content.tag}${attrs}>${inner}</${content.tag}>`;
  return {
    html: contentHtml.replace(content.whole, rebuilt),
    notes,
  };
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

/**
 * What a sibling insert may sit beside.
 *
 * `table` and `p` are verified against a real page. `h1`-`h6` are allowed
 * without being verified, because OneNote emits none of them — a heading on
 * these pages is a `p` holding a styled span — so there was nothing to aim a
 * probe at. If one ever appears and Graph refuses it, the error says so.
 *
 * Everything else stays out: a `li` or a `div` was never probed, and guessing
 * is what the ids-move rule exists to punish.
 */
const ANCHORABLE = /^(?:p|h[1-6]|table):/;

/**
 * The most changes one confirmation may cover.
 *
 * Not a technical limit. A batch is approved as one thing, and a list nobody
 * reads to the end is approved unread — the same failure a truncated preview
 * was. Restructuring one of these pages takes a handful of changes, not twenty.
 */
const MAX_CHANGES = 12;

const changeFrom = (params: Record<string, unknown>, where: string): EditChange => {
  const action = params.action;
  if (action !== 'append' && action !== 'replace' && action !== 'insert') {
    throw failure(
      `${where}: action must be 'append', 'replace' or 'insert'. Nothing else can be done to a page.`,
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
      `${where}: give either text or html, not both. text is written as one paragraph ` +
        'with nothing interpreted; html is markup and is what a table has to be written as.',
    );
  }
  if (!hasText && !hasHtml) {
    throw failure(`${where}: text or html is required — there is nothing to write.`);
  }

  if (hasText && (rawText as string).length > MAX_TEXT_CHARS) {
    throw failure(
      `${where}: that is ${(rawText as string).length} characters. An edit records a ` +
        `decision, not a page — ${MAX_TEXT_CHARS} is the most. A longer change is a new page.`,
    );
  }
  if (hasHtml && (rawHtml as string).length > MAX_HTML_CHARS) {
    throw failure(
      `${where}: that is ${(rawHtml as string).length} characters of markup. ` +
        `${MAX_HTML_CHARS} is the most a single change may carry.`,
    );
  }

  // Validated here rather than at the point of sending, so malformed markup is
  // refused by the preview — before anybody is asked to approve it, and long
  // before anything reaches the page.
  const html = hasHtml ? validateFragment(rawHtml as string) : null;
  const text = hasText ? (rawText as string) : null;

  const elementId = params.element_id;
  const named = typeof elementId === 'string' && elementId !== '';

  if (action === 'append') {
    if (named) {
      throw failure(
        `${where}: an append goes at the end of the page and takes no element_id. To ` +
          'change something already written use replace, and to put something beside an ' +
          'existing element use insert.',
      );
    }
  } else if (!named || !isGeneratedId(elementId as string)) {
    throw failure(
      `${where}: a ${action} needs element_id — the generated id of the part to ` +
        `${action === 'replace' ? 'change' : 'sit beside'}, as preview_onenote_edit ` +
        'reports it. Read the page again if you do not have one.',
    );
  }

  const targetsTable = named && isTableId(elementId as string);

  // The rules Graph imposes, stated where a caller meets them rather than left
  // to be discovered as a 20138. `tr` and `td` support no update action at all,
  // so a table is changed by replacing the whole of it — and a whole table
  // cannot be expressed as plain text.
  if (action === 'replace' && targetsTable) {
    if (html === null) {
      throw failure(
        `${where}: a table is replaced with markup, not plain text — pass the whole new ` +
          'table as html, starting with <table> and ending with </table>. OneNote supports ' +
          'no update action on a row or a cell, so the whole table is the unit.',
      );
    }
    if (rootTag(html) !== 'table') {
      throw failure(
        `${where}: replacing a table has to yield exactly one table. Send one <table> ` +
          'element and nothing beside it.',
      );
    }
  }

  if (action === 'insert' && !ANCHORABLE.test(elementId as string)) {
    throw failure(
      `${where}: insert puts a new block beside a paragraph, a heading or a table, and ` +
        'element_id names none of those. Append reaches the end of the page, and a ' +
        'replace changes something already there.',
    );
  }

  const position = params.position;
  if (action === 'insert') {
    if (position !== 'before' && position !== 'after') {
      throw failure(`${where}: an insert needs position — 'before' or 'after' the element named.`);
    }
    if (html === null) {
      throw failure(`${where}: an insert writes markup — pass the new block as html.`);
    }
  } else if (position !== undefined && position !== null && position !== '') {
    throw failure(`${where}: position belongs to an insert and to nothing else.`);
  }

  return {
    action,
    element_id: action === 'append' ? null : (elementId as string),
    text,
    html,
    position: action === 'insert' ? (position as 'before' | 'after') : null,
  };
};

/**
 * A page and the changes to make to it, whether that is one or several.
 *
 * Several ride in one `PATCH`, which is what Graph's array of change objects is
 * for and which this used to send one command at a time. The reason to batch is
 * not only the round trips: generated ids move after *every* write, so eight
 * changes applied one by one means eight reads, and every one of them is a
 * chance for the page to have moved under the sequence. One command array
 * resolves every target against a single read.
 *
 * That was verified rather than assumed, and so was the thing that makes it
 * safe to approve as one step: a batch containing one unresolvable target
 * applies **nothing** — `400`, and the page untouched. See
 * scripts/spike-onenote-batch.mjs. A batch that half-applied would be a page in
 * a state nobody previewed and nobody agreed to, and this capability would not
 * be worth having.
 */
export const editFrom = (params: Record<string, unknown>): EditDraft => {
  const pageId = params.page_id;
  if (typeof pageId !== 'string' || !ONENOTE_ID.test(pageId)) {
    throw failure('page_id is required, and must name the page to change.');
  }

  const source = params.source_page;
  if (source !== undefined && source !== null && source !== '') {
    if (typeof source !== 'string' || !ONENOTE_ID.test(source)) {
      throw failure('source_page is malformed.');
    }
  }

  const batch = params.changes;
  if (batch !== undefined && batch !== null) {
    if (!Array.isArray(batch) || batch.length === 0) {
      throw failure('changes must be a list of the changes to make, in the order they apply.');
    }
    if (batch.length > MAX_CHANGES) {
      throw failure(
        `That is ${batch.length} changes in one confirmation. ${MAX_CHANGES} is the most: ` +
          'they are approved as one thing, and a list nobody reads to the end is approved ' +
          'unread. Split it and show each batch.',
      );
    }
    if (params.action !== undefined || params.text !== undefined || params.html !== undefined) {
      throw failure(
        'Give either changes, or a single action with its text or html — not both. A ' +
          'change listed in one place and a change listed in the other would be two ' +
          'different edits with one confirmation between them.',
      );
    }

    const changes = batch.map((change, index) =>
      changeFrom(
        (change ?? {}) as Record<string, unknown>,
        `change ${index + 1} of ${batch.length}`,
      ),
    );

    // Two changes aimed at one element both resolve — every target is resolved
    // against the page as read — and what the page ends up holding is whichever
    // ran last, with the other silently gone. Refused rather than ordered.
    const targets = changes.map((change) => change.element_id).filter((id) => id !== null);
    const twice = targets.find((id, index) => targets.indexOf(id) !== index);
    if (twice !== undefined) {
      throw failure(
        `Two changes name ${twice}. In one batch both resolve, and only the last one ` +
          'survives — so the other would be lost without any refusal. Combine them into ' +
          'the single change you mean.',
      );
    }

    return { page_id: pageId, changes, source_page: source === '' ? null : (source as string) ?? null };
  }

  if (params.action === undefined) {
    throw failure(
      'Say what to change: either `action` with its text or html for one change, or ' +
        '`changes` for several applied together in one write.',
    );
  }

  return {
    page_id: pageId,
    changes: [changeFrom(params, 'this change')],
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
export const editToken = async (draft: EditDraft, preImages: string[]): Promise<string> => {
  // Every change and every pre-image, in order. A batch is approved as one
  // thing, so it fails closed as one thing: if any element it would overwrite
  // has moved or changed since the preview, the whole batch stops. Hashing them
  // separately would let a batch apply the changes whose targets still match,
  // which is the partial application the atomicity of the PATCH exists to
  // prevent — the guarantee has to hold in our code too, not only in Graph's.
  const canonical = draft.changes
    .map((change, index) =>
      [
        change.action,
        change.element_id ?? '',
        change.position ?? '',
        change.text ?? '',
        // The markup itself, not a rendering of it. The preview shows a table as
        // rows because that is what can be read, but two different tables can
        // render to the same rows — so what the token binds is what is sent.
        change.html ?? '',
        preImages[index] ?? '',
      ].join(' '),
    )
    .join(' | ');

  const data = new TextEncoder().encode(`confirm-edit ${draft.page_id} ${canonical}`);
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
    // Block boundaries, or a change made of several paragraphs previews as one
    // run-on line — "…Stand Mai 2026.Ausfüllkonventionen…" — which reads as a
    // different change from the one being made. `<br/>` was handled from the
    // start and this was not, because a paragraph replace could only ever
    // produce one paragraph until it could produce markup.
    .replace(/<\/(?:p|div|h[1-6]|li|tr|table|ul|ol)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
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

/** How wide a rendered row may get before its columns start wrapping. */
const MAX_ROW_WIDTH = 96;

/** No column is squeezed below this, however many there are. */
const MIN_COLUMN_WIDTH = 14;

/** Greedy word wrap, hard-breaking a token that cannot fit on a line of its own. */
const wrap = (text: string, width: number): string[] => {
  const out: string[] = [];
  let line = '';

  for (const word of text.split(' ')) {
    let rest = word;
    while (rest.length > width) {
      if (line !== '') {
        out.push(line);
        line = '';
      }
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (rest === '') continue;
    if (line === '') line = rest;
    else if (line.length + 1 + rest.length <= width) line += ` ${rest}`;
    else {
      out.push(line);
      line = rest;
    }
  }

  if (line !== '' || out.length === 0) out.push(line);
  return out;
};

/**
 * How wide each column may be, sharing one row's worth of space between them.
 *
 * A table narrow enough to fit is left at its natural widths. A wider one has
 * its columns shrunk from the widest inwards, so a free-text column gives way
 * before a column of labels does.
 */
const columnWidths = (rows: string[][], columns: number): number[] => {
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(1, ...rows.map((row) => (row[i] ?? '').length)),
  );

  const frame = 4 + 3 * (columns - 1) + 2;
  let budget = MAX_ROW_WIDTH - frame;
  if (budget < columns * MIN_COLUMN_WIDTH) budget = columns * MIN_COLUMN_WIDTH;

  while (widths.reduce((a, b) => a + b, 0) > budget) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= MIN_COLUMN_WIDTH) break;
    widths[widest] -= 1;
  }

  return widths;
};

/**
 * A table as something a musician can read and say yes or no to.
 *
 * This is the difference between a whole-table replace being previewable and
 * not. The thing a replace destroys is a block of markup hundreds of characters
 * wide; shown raw it is not a preview, it is a wall that gets approved unread —
 * and an approval nobody could read is exactly the failure the confirmation
 * step exists to prevent. So the table is shown as its rows.
 *
 * **Nothing is ever cut.** This originally clipped a cell at forty characters
 * with an ellipsis, on the reasoning that the shape of the table is what a
 * reader checks. That was wrong in the case these pages are mostly made of: a
 * single-cell table holding a paragraph of free text, where the whole change
 * lives past the fortieth character. Both halves of the preview then rendered
 * to the same truncated line, and the preview asserted in effect that a
 * destructive change was a no-op. Found in use, not by any test here — the test
 * asserted the ellipsis was present, which is how a defect gets a green tick.
 *
 * So a long cell wraps within its column instead. A wrapped preview is longer
 * to read; a truncated one cannot be read at all.
 *
 * `marks` optionally prefixes each row, from `markRows`. The mark sits outside
 * the table so the columns still line up under it.
 */
export const renderTable = (tableHtml: string, marks: string[] = []): string =>
  renderRows(tableRows(tableHtml), marks) || asText(tableHtml);

export const renderRows = (rows: string[][], marks: string[] = []): string => {
  if (rows.length === 0) return '';

  const columns = Math.max(...rows.map((row) => row.length));
  const widths = columnWidths(rows, columns);

  return rows
    .map((row, index) => {
      const cells = Array.from({ length: columns }, (_, i) => wrap(row[i] ?? '', widths[i]));
      const height = Math.max(...cells.map((lines) => lines.length));
      const mark = marks[index] ?? ' ';

      return Array.from({ length: height }, (_, line) =>
        // The mark goes on the first line of a row only: a wrapped cell is one
        // row, and marking every line of it would read as several.
        `${line === 0 ? mark : ' '} | ${cells
          .map((lines, i) => (lines[line] ?? '').padEnd(widths[i]))
          .join(' | ')} |`,
      ).join('\n');
    })
    .join('\n');
};

/**
 * Which rows a replace actually changes, matched up rather than compared by
 * position.
 *
 * A row inserted near the top shifts every row under it, and comparing by index
 * would then mark the whole table as changed — which tells a reader as little
 * as marking none of it. So the two row lists are matched by their longest
 * common subsequence, and only what is genuinely new, gone or altered is
 * marked.
 */
export const markRows = (
  before: string[][],
  after: string[][],
): { before: string[]; after: string[] } => {
  const a = before.map((row) => row.join(' '));
  const b = after.map((row) => row.join(' '));

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const marksBefore: string[] = new Array(a.length).fill('-');
  const marksAfter: string[] = new Array(b.length).fill('+');
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      marksBefore[i] = ' ';
      marksAfter[j] = ' ';
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i += 1;
    else j += 1;
  }

  return { before: marksBefore, after: marksAfter };
};

/**
 * A fragment of several elements, each rendered as what it is.
 *
 * A replacement may now be a paragraph, a heading and a table at once, and
 * running the whole thing through `asText` turned the table back into a column
 * of loose lines — the same flattening `copy-onenote-page.mjs` refuses for the
 * same reason. The reader has to be able to see that a table is arriving.
 */
export const renderFragment = (html: string): string => {
  const blocks: string[] = [];
  let rest = html.trim();

  while (rest !== '') {
    const element = firstElement(rest);
    if (element === undefined) {
      const trailing = asText(rest);
      if (trailing !== '') blocks.push(trailing);
      break;
    }

    blocks.push(element.tag === 'table' ? renderTable(element.whole) : asText(element.whole));
    rest = rest.slice(rest.indexOf(element.whole) + element.whole.length).trim();
  }

  return blocks.filter((block) => block !== '').join('\n');
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
  { full = true }: { full?: boolean } = {},
): Promise<{ html: string; etag: string | null; parts: EditablePart[] }> => {
  const { html, etag } = await onenotePageContent(pageId, token);
  return { html, etag, parts: editablePartsFrom(html, { full }) };
};

/**
 * The same index, derived from page HTML somebody else already fetched.
 *
 * Split out so `read_note` can return the ids without a second call to Graph.
 * Both paths ask `/content` for the same page; the only difference is
 * `includeIDs=true`, so making the reader ask for ids too turns what used to be
 * a whole extra round trip — preview once for the index, preview again for the
 * change — into a query parameter. The ids are as fresh as the read they came
 * with, and a stale one still fails closed: `editToken` binds the pre-image, so
 * an element that has moved produces a different one and the write is refused
 * before it happens.
 */
export const editablePartsFrom = (
  html: string,
  { full = true }: { full?: boolean } = {},
): EditablePart[] => {
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
      const text = element === undefined ? '' : readable(element, id);

      return {
        element_id: id,
        kind: isTableId(id) ? 'table' : 'text',
        // Abbreviated only when this is an index rather than the thing being
        // decided. Nothing a change would overwrite is ever shortened — that is
        // the diff, and it is rendered in full further down. This is the list a
        // caller looks an id up in, and returning twenty tables in full on the
        // twentieth edit of one page is most of what a session spends.
        text: full ? text : label(element === undefined ? '' : element, id),
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

  return parts;
};

/** How much of an element the index shows: enough to recognise, never enough to approve. */
const LABEL_CHARS = 60;

const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS - 1)}…` : line;
};

/**
 * One line that says which element this is.
 *
 * A table gets its shape rather than its cells run together: flattening two
 * rows to `| Honorar | 1200 | | Anreise | UNKNOWN |` reads as one row of four
 * cells, which is a worse description of the page than saying nothing. The
 * shape plus the first row is what a caller actually recognises a table by.
 */
const label = (elementHtml: string, id: string): string => {
  if (!isTableId(id)) return oneLine(asText(elementHtml));

  const rows = tableRows(elementHtml);
  if (rows.length === 0) return oneLine(asText(elementHtml));

  const columns = Math.max(...rows.map((row) => row.length));
  return (
    `${rows.length} row${rows.length === 1 ? '' : 's'} × ${columns} column` +
    `${columns === 1 ? '' : 's'}, starting "${oneLine(rows[0].join(' | '))}"`
  );
};

/** One change rendered as its before and after, which is what gets approved. */
const showChange = (
  change: EditChange,
  captured: string,
  carriedHtml: string,
): { preview: string; inherited: string[] } => {
  const rendered = (html: string): string =>
    rootTag(html) === 'table' ? renderTable(html) : renderFragment(html);

  if (change.action === 'append') {
    return {
      preview: `Add to the end of the page:\n\n${
        change.html === null ? (change.text as string).trim() : rendered(change.html)
      }`,
      inherited: [],
    };
  }

  const anchor = readable(captured, change.element_id as string);

  if (change.action === 'insert') {
    return {
      preview:
        `Put this ${change.position} the ${
          isTableId(change.element_id as string) ? 'table' : 'paragraph'
        } that currently reads:\n\n${anchor}\n\nNew block:\n\n${rendered(change.html as string)}`,
      inherited: [],
    };
  }

  const carried = change.html === null ? { html: '', notes: [] } : inherit(captured, change.html);
  const asTable = isTableId(change.element_id as string) && change.html !== null;

  if (asTable) {
    const marks = markRows(tableRows(captured), tableRows(carriedHtml));
    const touched = marks.after.filter((m) => m !== ' ').length;
    const dropped = marks.before.filter((m) => m !== ' ').length;

    return {
      preview:
        `Replace this:\n\n${renderTable(captured, marks.before)}\n\n` +
        `With this:\n\n${renderTable(carriedHtml, marks.after)}\n\n` +
        (touched === 0 && dropped === 0
          ? 'Every row reads exactly as it does now. What differs is the markup — ' +
            'borders, widths, or the way a cell is written. Say that plainly rather ' +
            'than describing a change to the words, because there is none.'
          : `Marked rows are the ones that differ: ${dropped} going, ${touched} arriving. ` +
            'Every unmarked row is being rewritten too — a table is replaced whole — ' +
            'and is only safe because it is carried across unchanged.'),
      inherited: carried.notes,
    };
  }

  return {
    preview: `Replace this:\n\n${anchor}\n\nWith this:\n\n${
      change.html === null ? (change.text as string).trim() : rendered(carriedHtml)
    }`,
    inherited: carried.notes,
  };
};

/**
 * What each change would destroy, and what would actually be sent for it.
 *
 * Shared by the preview and the apply so that the two cannot drift: the apply
 * hashes what this returns and sends what this returns, and the preview shows
 * it. A capture that fails throws, here as before — a replace whose pre-image
 * could not be read is refused rather than performed blind.
 */
const resolveChanges = (
  html: string,
  draft: EditDraft,
): { captured: string[]; content: string[] } => {
  const captured = draft.changes.map((change) =>
    change.action === 'append' ? '' : preImage(html, change.element_id as string),
  );

  const content = draft.changes.map((change, index) =>
    change.html === null
      ? paragraph(change.text as string)
      : change.action === 'replace'
        ? inherit(captured[index], change.html).html
        : change.html,
  );

  return { captured, content };
};

/**
 * Show the change that would be made, and hand back the token making it needs.
 *
 * A read despite the name, exactly as the calendar and create previews are.
 */
export async function previewEdit(token: string, params: Record<string, unknown>) {
  // Naming a part to change requires knowing its id, and an id is only knowable
  // by reading the page. So a replace with no element_id is not a malformed
  // call — it is the first half of the only workflow available, and the tool
  // text says so. It used to be refused here, which meant a model following that
  // text got an error and had to guess its way out.
  //
  // No confirmation token comes back from this branch. Nothing has been chosen
  // yet, and a token would be one for a change nobody has described.
  const wantsPart =
    params.changes === undefined &&
    (params.action === 'replace' || params.action === 'insert') &&
    (params.element_id === undefined || params.element_id === null || params.element_id === '');

  if (wantsPart) {
    const pageId = params.page_id;
    if (typeof pageId !== 'string' || !ONENOTE_ID.test(pageId)) {
      throw failure('page_id is required, and must name the page to change.');
    }

    // In full: this is the call whose whole purpose is showing what the page
    // holds, and the one place the cost is the point.
    const { parts } = await readEditableParts(token, pageId);
    return {
      preview: null,
      page_id: pageId,
      parts,
      abbreviated: false,
      confirmation_token: null,
      note:
        parts.length === 0
          ? 'This page has no separately editable parts, so nothing on it can be ' +
            'replaced. An append can still add to the end of it.'
          : 'Nothing has been previewed yet. These are the parts of the page as it ' +
            'stands. Name one as element_id and preview again to see the change ' +
            'itself — or list several changes at once as `changes`, which are ' +
            'applied together in one write. The ids were read just now and are ' +
            'good only for the next call.',
    };
  }

  const draft = editFrom(params);

  // An index rather than the page: the caller has named what it is changing, so
  // what it needs back is the diff for that, plus enough to look up an id it
  // did not have. Returning every table in full on every call is the dominant
  // cost of patching one page in several steps.
  const { html, parts } = await readEditableParts(token, draft.page_id, { full: false });
  const { captured, content } = resolveChanges(html, draft);

  const shown = draft.changes.map((change, index) =>
    showChange(change, captured[index], content[index]),
  );

  const inherited = [...new Set(shown.flatMap((one) => one.inherited))];
  const inheritedNote =
    inherited.length === 0
      ? ''
      : `\n\nKeeping ${inherited.join(', ')}, which this change does not specify. ` +
        'Without that it would land as ordinary body text.';

  const body =
    draft.changes.length === 1
      ? shown[0].preview
      : `${draft.changes.length} changes, applied together in one write — all of them ` +
        'or none:\n\n' +
        shown.map((one, index) => `${index + 1}. ${one.preview}`).join('\n\n');

  const destroys = draft.changes.some((change) => change.action === 'replace');

  // Kept per-kind rather than folded into the general wording: this is the
  // sentence that tells a musician a table replace takes every row with it, and
  // it stopped being said when the note started describing a batch instead of a
  // change. A note that covers several changes still has to say the strongest
  // thing true of any of them.
  const wholeTable = draft.changes.some(
    (change) => change.action === 'replace' && isTableId(change.element_id ?? ''),
  );

  return {
    preview: `${body}${inheritedNote}`,
    page_id: draft.page_id,
    parts,
    // Said plainly, because a shortened list that does not announce itself is a
    // list a reader will treat as the whole page.
    abbreviated: true,
    confirmation_token: await editToken(draft, captured),
    note:
      'Show this to the musician and wait for their yes. ' +
      (destroys
        ? 'This overwrites what is quoted above' +
          (wholeTable
            ? ' — a table is replaced whole, every row of it, because OneNote supports ' +
              'no change to a single row or cell'
            : '') +
          ', and OneNote keeps no version of a ' +
          "page — what it replaces is kept in this install's own write log and " +
          'nowhere else.'
        : 'Nothing on the page is overwritten or removed by this.') +
      (draft.changes.length === 1
        ? ''
        : ' They are one confirmation: applied in a single write, and if any one of ' +
          'them cannot be applied then none of them is.'),
  };
}

/**
 * Apply the change, or the batch of them, having shown it.
 *
 * The page is read again here rather than trusted from the preview, and that is
 * not caution: generated ids move after any page update, so an id that was right
 * at preview may name something else by now. Re-reading also produces the ETag
 * that goes out as `If-Match`, which is what makes the musician typing in
 * OneNote between the two calls a refusal rather than a silent overwrite.
 *
 * The confirmation token is checked against every change *and* every pre-image,
 * so a batch fails closed if any element it would overwrite has changed since
 * the preview — not merely the one that moved.
 *
 * All the commands go out in one `PATCH`, which is what Graph's array is for.
 * A batch containing an unresolvable target applies nothing at all, verified
 * against a real page, so there is no state in which half a confirmed batch is
 * on the page.
 */
export async function applyEdit(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite,
) {
  const draft = editFrom(params);
  const { html, etag } = await onenotePageContent(draft.page_id, token);
  const { captured, content } = resolveChanges(html, draft);

  const expected = await editToken(draft, captured);
  if (params.confirmation_token !== expected) {
    throw failure(
      draft.changes.some((change) => change.action !== 'append')
        ? 'That part of the page is not what was previewed — either the values ' +
          'changed, or the page did since it was shown. Nothing was written. Call ' +
          'preview_onenote_edit again and show the musician what it returns now.'
        : 'The confirmation token does not match these values. Call ' +
          'preview_onenote_edit again with exactly what should be written, show the ' +
          'musician what it returns, then apply it with those same values.',
    );
  }

  const commands = draft.changes.map((change, index) =>
    change.action === 'append'
      ? appendCommand('body', content[index])
      : change.action === 'insert'
        ? insertCommand(
            change.element_id as string,
            change.position as 'before' | 'after',
            content[index],
          )
        : replaceCommand(change.element_id as string, content[index]),
  );

  await onenotePatchPage(draft.page_id, commands, token, etag);

  // After the write, and carrying what each change destroyed. For a replace
  // this line is the only copy of the previous content that exists anywhere, so
  // a batch is logged as one line per change rather than one line for the
  // batch — a restore is per element, and a summary of five changes is not
  // something anybody can put back.
  for (const [index, change] of draft.changes.entries()) {
    const wrote = change.html === null ? (change.text as string).trim() : change.html;
    const destroyed =
      change.action === 'replace' ? readable(captured[index], change.element_id as string) : '';

    await record({
      operation:
        change.action === 'append'
          ? 'append_onenote_page'
          : change.action === 'insert'
            ? 'insert_onenote_element'
            : 'replace_onenote_element',
      // The text itself, not merely that something happened. `summary` is
      // documented as what was written "as the user would read it back", and the
      // calendar rows honour that while these two originally named only the page
      // id — so the log recorded the replaced text in `pre_image` and left the
      // replacing text nowhere at all. Someone reading this line back is
      // reconstructing an edit they cannot see any other way.
      summary:
        (draft.changes.length === 1 ? '' : `[${index + 1}/${draft.changes.length}] `) +
        (change.action === 'append'
          ? `Added to the end of the page: ${wrote}`
          : change.action === 'insert'
            ? `Inserted ${change.position} an existing element: ${wrote}`
            : `Replaced "${destroyed}" with "${wrote}"`),
      target: draft.page_id,
      source_page: draft.source_page,
      // Only a replace has one. An insert captured the anchor to bind its token,
      // but nothing of it was destroyed, and recording it as a pre-image would
      // put content in the log that is still on the page — which is the one thing
      // a reader of this log must be able to trust it does not do.
      pre_image: change.action === 'replace' ? captured[index] : null,
    });
  }

  const replaced = draft.changes.filter((change) => change.action === 'replace').length;

  return {
    changed: true,
    page_id: draft.page_id,
    note:
      (draft.changes.length === 1
        ? ''
        : `${draft.changes.length} changes were applied in one write. `) +
      (replaced === 0
        ? 'The page now carries this. Nothing was removed.'
        : "What the page said before is in this install's write log and nowhere else " +
          '— OneNote keeps no version of a page, so tell the musician that rather ' +
          'than implying it can be undone in OneNote.'),
  };
}
