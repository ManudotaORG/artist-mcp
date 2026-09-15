/**
 * Creating a OneNote page, and nothing else.
 *
 * The counterpart to `calendar.ts`, with one structural difference worth
 * stating at the top: there is no boundary in this file. `calendar.ts` decides
 * which events may be deleted, because Google grants create and delete with the
 * identical scope and nothing but our code separates them. Here the token holds
 * `Notes.Create`, which cannot express an edit or a delete at all — verified
 * against a real notebook: 403 on both, against a page the token had just
 * created itself.
 *
 * So the rules below are about not writing rubbish into someone's knowledge
 * base. They are not what stops this tool damaging a page the musician wrote;
 * Microsoft is. See docs/decisions/0003-onenote-writes.md.
 */

import { graphGet, onenoteCreatePage, onenoteCreateSection } from './api.js';
import { type RecordWrite } from './audit.js';
import { GraphError } from './client.js';

const failure = (message: string): GraphError => new GraphError(message, false);

/** As in notes.ts: opaque, but concatenated into URLs, so shape-checked like anything else. */
const ONENOTE_ID = /^[A-Za-z0-9!._~-]{1,300}$/;

/**
 * A page long enough to be worth creating and short enough to stay one working
 * unit. The cap is not a Graph limit — it is the "one page is one working unit"
 * rule, which a 40,000-character dump would break as surely as a bad edit.
 */
const MAX_BODY_CHARS = 20_000;
const MAX_TITLE_CHARS = 200;

export type PageDraft = {
  section_id: string;
  title: string;
  /** Plain text. A blank line starts a paragraph; nothing else is interpreted. */
  body: string;
  /** The page this was composed from, when the caller named one. */
  source_page: string | null;
};

export type SectionRef = { id: string; name: string; notebook: string | null };

/**
 * The same placeholder rule the calendar enforces, and for a stronger reason.
 *
 * A page is the knowledge base. An unsettled value written into it does not
 * merely sit in a calendar where someone notices it — it becomes a source a
 * later session reads back as though the notebook had settled the question.
 * `policy:divergence` exists precisely so that two pages disagreeing is never
 * resolved silently; writing `TBC` as though it were a fact resolves it in the
 * worst available direction.
 *
 * Case-sensitive, as the calendar's is: "Unknown Pleasures tribute night" is a
 * real gig, and matching case-insensitively refused it.
 */
const PLACEHOLDERS = ['UNKNOWN', 'TBC', 'TBD', 'T.B.C', 'T.B.D'];

const unsettled = (value: string): boolean => {
  const trimmed = value.trim();
  if (PLACEHOLDERS.some((word) => trimmed.toUpperCase() === word)) return true;
  if (/\?\?+/.test(trimmed)) return true;
  return PLACEHOLDERS.some((word) =>
    new RegExp(`(^|[^A-Za-z])${word.replace(/\./g, '\\.')}([^A-Za-z]|$)`).test(trimmed),
  );
};

/**
 * Refuse to write a title the notebook has not settled.
 *
 * The title only, not the body — the one real departure from the calendar, and
 * deliberate. A page is prose, and prose legitimately says "the fee is still
 * TBC": that sentence is the musician's own record of an open question, and
 * refusing it would leave this tool unable to write down the very thing the
 * notebook is for. A *title* reading `TBC` is a different object. It is the
 * page's identity, it is what every later session sees in `list_notes`, and
 * nothing is gained by letting it be a placeholder.
 */
export const refuseUnsettled = (draft: PageDraft): void => {
  if (unsettled(draft.title)) {
    throw failure(
      `The title is not settled — it still reads "${draft.title.trim()}". A page is ` +
        'the knowledge base, and its title is what every later session sees. Settle ' +
        'it first, then ask again.',
    );
  }
};

/** Shape-check what a caller gave us, before any of it is hashed or written. */
export const draftFrom = (params: Record<string, unknown>): PageDraft => {
  const text = (v: unknown, name: string, required: boolean): string | null => {
    if (v === undefined || v === null || v === '') {
      if (required) throw failure(`${name} is required to create a page.`);
      return null;
    }
    if (typeof v !== 'string') throw failure(`${name} must be text.`);
    return v;
  };

  const sectionId = text(params.section_id, 'section_id', true) as string;
  if (!ONENOTE_ID.test(sectionId)) throw failure('section_id is malformed.');

  const title = (text(params.title, 'title', true) as string).trim();
  if (title === '') throw failure('title is required to create a page.');
  if (title.length > MAX_TITLE_CHARS) {
    throw failure(`The title is ${title.length} characters; ${MAX_TITLE_CHARS} is the most.`);
  }

  const body = text(params.body, 'body', true) as string;
  if (body.trim() === '') throw failure('body is required to create a page.');
  if (body.length > MAX_BODY_CHARS) {
    throw failure(
      `The body is ${body.length} characters. One page is one working unit, and ` +
        `${MAX_BODY_CHARS} is the most that stays one. Split it across pages.`,
    );
  }

  const sourcePage = text(params.source_page, 'source_page', false);
  if (sourcePage !== null && !ONENOTE_ID.test(sourcePage)) {
    throw failure('source_page is malformed.');
  }

  return { section_id: sectionId, title, body, source_page: sourcePage };
};

/**
 * XHTML entities. Ampersand first, or the escapes introduced by the later
 * replacements get escaped in turn.
 */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * The page as OneNote takes it: an XHTML document, not JSON.
 *
 * Everything the caller supplied is escaped, and the only markup here is the
 * document's own. That is not tidiness. A model composing a page from an email
 * or an attachment is passing through text it did not author, and unescaped
 * HTML in a body would let that text decide what the page contains. The body is
 * plain text by design and blank lines are the only structure it carries, so
 * there is no markup to preserve and nothing is lost by escaping all of it.
 */
export const pageXhtml = (draft: PageDraft): string => {
  const paragraphs = draft.body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    // A single newline inside a block stays a line break rather than starting a
    // paragraph, so a pasted address or set list keeps its shape.
    .map((block) => `<p>${escapeXml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  return (
    '<!DOCTYPE html><html><head>' +
    `<title>${escapeXml(draft.title)}</title>` +
    '</head><body>' +
    paragraphs +
    '</body></html>'
  );
};

/** What the musician is shown before the page exists. */
const renderDraft = (draft: PageDraft, section: SectionRef): string =>
  [
    `Title:    ${draft.title}`,
    `Section:  ${section.name}${section.notebook === null ? '' : ` (in ${section.notebook})`}`,
    '',
    draft.body.trim(),
  ].join('\n');

/**
 * Where a page would go, resolved from the page it was composed from.
 *
 * A section id is not something a musician has or could check, and OneNote has
 * no `primary` the way a calendar does — nothing makes one section the obvious
 * default. What there is, always, is the working unit the request came from.
 * Putting the new page beside it is both the sane default and the one a
 * musician can verify, because the preview names the section in words rather
 * than as an id.
 */
export const sectionOfPage = async (token: string, pageId: string): Promise<SectionRef> => {
  const res = await graphGet(
    `/me/onenote/pages/${encodeURIComponent(pageId)}` +
      '?$expand=parentSection($select=id,displayName),parentNotebook($select=displayName)',
    token,
  );
  const page = (await res.json()) as {
    parentSection?: { id?: string; displayName?: string };
    parentNotebook?: { displayName?: string };
  };

  const id = page.parentSection?.id;
  if (id === undefined) {
    throw failure(
      'That page does not report which section it is in, so there is nowhere to ' +
        'put a new page beside it. Name a section instead.',
    );
  }

  return {
    id,
    name: page.parentSection?.displayName ?? '(unnamed section)',
    notebook: page.parentNotebook?.displayName ?? null,
  };
};

/** Read back a section's own name, for a caller that named the section directly. */
const sectionById = async (token: string, sectionId: string): Promise<SectionRef> => {
  if (!ONENOTE_ID.test(sectionId)) throw failure('section_id is malformed.');
  const res = await graphGet(
    `/me/onenote/sections/${encodeURIComponent(sectionId)}` +
      '?$select=id,displayName&$expand=parentNotebook($select=displayName)',
    token,
  );
  const section = (await res.json()) as {
    id?: string;
    displayName?: string;
    parentNotebook?: { displayName?: string };
  };
  return {
    id: section.id ?? sectionId,
    name: section.displayName ?? '(unnamed section)',
    notebook: section.parentNotebook?.displayName ?? null,
  };
};

const sectionFor = async (
  token: string,
  params: Record<string, unknown>,
): Promise<SectionRef> => {
  if (typeof params.section_id === 'string' && params.section_id !== '') {
    return sectionById(token, params.section_id);
  }
  const source = params.source_page;
  if (typeof source !== 'string' || !ONENOTE_ID.test(source)) {
    throw failure(
      'Name either a section_id or the source_page this was composed from, so the ' +
        'new page goes somewhere the musician can recognise.',
    );
  }
  return sectionOfPage(token, source);
};

/**
 * Create the page.
 *
 * No preview and no token since 0009: a new page overwrites nothing. The section
 * is resolved here, from source_page or section_id, and the result carries the
 * page as written and the section it landed in — what the preview used to show.
 */
export async function createPage(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite,
) {
  const section = await sectionFor(token, params);
  const draft = draftFrom({ ...params, section_id: section.id });
  refuseUnsettled(draft);

  const res = await onenoteCreatePage(draft.section_id, pageXhtml(draft), token);
  const created = (await res.json().catch(() => ({}))) as {
    id?: string;
    title?: string;
    createdByAppId?: string;
    links?: { oneNoteWebUrl?: { href?: string } };
  };

  await record({
    operation: 'create_onenote_page',
    summary: `Created the page "${draft.title}"`,
    target: created.id ?? '(no page id returned)',
    source_page: draft.source_page,
    created_by_app_id: created.createdByAppId ?? null,
  });

  return {
    created: true,
    page_id: created.id ?? null,
    title: created.title ?? draft.title,
    web_url: created.links?.oneNoteWebUrl?.href ?? null,
    section_name: section.name,
    written: renderDraft(draft, section),
    note:
      'The page exists. This tool cannot edit or delete it — that is the permission ' +
      'it holds, not a policy it follows.',
  };
}

/**
 * Characters OneNote refuses in a section name, and its length limit. Checked
 * here so a refusal names the problem instead of arriving as a bare 400.
 */
const SECTION_NAME_FORBIDDEN = /[?*\\/:<>|&#'%~"]/;
const MAX_SECTION_NAME_CHARS = 50;

/**
 * Create one section in a named notebook.
 *
 * The notebook is resolved by name here, after the tool has already checked the
 * name against the live list and its notebook_key. An existing section of the
 * same name is refused rather than duplicated: two sections with one name are
 * exactly what `list_notes` with `section` cannot tell apart.
 * See docs/decisions/0011-creating-sections.md.
 */
export async function createSection(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite,
) {
  const notebook = typeof params.notebook === 'string' ? params.notebook.trim() : '';
  const name = typeof params.name === 'string' ? params.name.replace(/\s+/g, ' ').trim() : '';
  if (notebook === '') throw failure('Name the notebook the section goes in.');
  if (name === '') throw failure('Name the section.');
  if (name.length > MAX_SECTION_NAME_CHARS) {
    throw failure(`A section name is at most ${MAX_SECTION_NAME_CHARS} characters.`);
  }
  if (SECTION_NAME_FORBIDDEN.test(name)) {
    throw failure('A section name cannot contain ? * / \\ : < > | & # \' % ~ or ".');
  }
  if (/^(unknown|tbc|tba)$/i.test(name)) {
    throw failure('A section name the notebook has not settled is refused.');
  }

  const res = await graphGet(
    '/me/onenote/notebooks?$select=id,displayName&$expand=sections($select=displayName)',
    token,
  );
  const books = ((await res.json()) as {
    value?: { id?: string; displayName?: string; sections?: { displayName?: string }[] }[];
  }).value ?? [];
  const key = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
  const matches = books.filter((b) => key(b.displayName ?? '') === key(notebook));
  if (matches.length !== 1 || typeof matches[0].id !== 'string' || !ONENOTE_ID.test(matches[0].id)) {
    throw failure(
      matches.length === 0
        ? `No notebook named "${notebook}".`
        : `${matches.length} notebooks are named "${notebook}".`,
    );
  }
  const [book] = matches;
  if ((book.sections ?? []).some((s) => key(s.displayName ?? '') === key(name))) {
    throw failure(`"${book.displayName}" already has a section named "${name}".`);
  }

  const created = (await (await onenoteCreateSection(book.id as string, name, token))
    .json()
    .catch(() => ({}))) as { id?: string; displayName?: string };

  await record({
    operation: 'create_onenote_section',
    summary: `Created the section "${name}" in "${book.displayName ?? notebook}"`,
    target: created.id ?? '(no section id returned)',
  });

  return {
    created: true,
    section_id: created.id ?? null,
    name: created.displayName ?? name,
    notebook: book.displayName ?? notebook,
  };
}
