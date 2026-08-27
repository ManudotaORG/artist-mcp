/**
 * OneNote: the working unit. One page is one unit of work, and everything the
 * agent pack does rests on that.
 *
 * Ported from the edge function unchanged in behaviour, including the section
 * enumeration below, which exists for a reason that is not obvious from the
 * code alone.
 */

import { MAX_TEXT_CHARS } from './attachments.js';
import { GraphError } from './client.js';
import { graphGet } from './api.js';

/** Graph ids are opaque, but they are concatenated into URLs, so they are checked like any other value. */
const ONENOTE_ID = /^[A-Za-z0-9!._~-]{1,300}$/;

type OneNotePage = {
  id: string;
  title?: string;
  lastModifiedDateTime?: string;
};

type OneNoteSection = {
  id: string;
  displayName?: string;
  parentNotebook?: { displayName?: string };
};

export type NoteSummary = {
  id: string;
  title: string;
  section: string | null;
  notebook: string | null;
  last_modified: string | null;
};

/**
 * OneNote nests deeply and emits entities for accented characters, so the raw
 * content is unreadable as prose without this. Order matters in two places, and
 * both are marked.
 */
export const htmlToText = (html: string): string =>
  html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    // A to-do tag is an attribute on the paragraph, so it dies with the tag
    // strip below unless it is turned into text first. Above the <li> rule
    // too: that rule rewrites the opening tag, attribute and all.
    .replace(/<(p|li)[^>]*data-tag="[^"]*\bto-do:completed\b[^"]*"[^>]*>/gi, '$&[x] ')
    .replace(/<(p|li)[^>]*data-tag="[^"]*\bto-do\b(?!:)[^"]*"[^>]*>/gi, '$&[ ] ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    // Numeric entities first: OneNote emits these for accented characters, so
    // without this "Müller" arrives as "M&#252;ller".
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // &amp; last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&')
    // Flatten the indentation and stray blank lines the nesting leaves behind.
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * `/me/onenote/pages` looks like the obvious call and works right up until the
 * account has too many sections, at which point Graph fails the whole request
 * with error 20266 and tells you to page per section instead. Organised
 * notebooks hit this, so sections are enumerated first and their pages fetched
 * one section at a time. The notebook name comes along for free.
 *
 * Do not "simplify" this back to the single call.
 */
export const listNotes = async (token: string): Promise<{ notes: NoteSummary[] }> => {
  const sectionsRes = await graphGet(
    '/me/onenote/sections?$select=id,displayName' +
      '&$expand=parentNotebook($select=displayName)&$top=100',
    token,
  );
  const sections = ((await sectionsRes.json()) as { value?: OneNoteSection[] }).value ?? [];

  const perSection = await Promise.all(
    sections
      .filter((s) => typeof s.id === 'string' && ONENOTE_ID.test(s.id))
      .map(async (section) => {
        const res = await graphGet(
          `/me/onenote/sections/${section.id}/pages` +
            '?$select=id,title,lastModifiedDateTime&$top=100',
          token,
        );
        const pages = ((await res.json()) as { value?: OneNotePage[] }).value ?? [];
        return pages.map((p) => ({
          id: p.id,
          title: p.title ?? '(untitled)',
          section: section.displayName ?? null,
          notebook: section.parentNotebook?.displayName ?? null,
          last_modified: p.lastModifiedDateTime ?? null,
        }));
      }),
  );

  // Newest first, matching the order the single-call version happened to
  // return; pages with no timestamp sort last rather than jumping to the top.
  const notes = perSection
    .flat()
    .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''));

  return { notes };
};

/**
 * Narrowing happens here rather than at Graph, because the section walk above
 * has to fetch every page regardless — the saving is in what the model is asked
 * to read, not in the calls made. That is still the saving worth having: "what
 * moved this week" is the question every session opens with, and paying for the
 * whole notebook in context in order to ignore most of it is the cost.
 *
 * Kept separate from `listNotes` so it is testable without a Graph stub, and so
 * the fetch keeps doing exactly one thing.
 */
export type Narrowing = { since?: string; limit?: number };

export type NarrowedNotes<T> = {
  notes: T[];
  /** How many matched before `limit` cut the list, so a partial is never read as the whole. */
  matched: number;
  /** Pages dropped for having no timestamp at all, reported rather than silently excluded. */
  undated: number;
};

/**
 * A date the model may pass through from natural language ("since last
 * Tuesday"). A date with no time means the start of that day, so "since the
 * 10th" includes the 10th.
 *
 * An unparseable value is refused rather than ignored. A filter that silently
 * does nothing returns the whole notebook, and the model has no way to tell
 * that from a notebook where everything really did move this week.
 */
const parseSince = (since: string): number => {
  const trimmed = since.trim();
  const value = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed);
  if (Number.isNaN(value)) {
    throw new GraphError(
      `Could not read "${since}" as a date. Pass an ISO date such as 2026-08-10.`,
      false,
    );
  }
  return value;
};

/**
 * Generic over the summary shape: `server.ts` carries its own, because a
 * response from an older edge function may omit `notebook`. Only the timestamp
 * is narrowed on, so nothing here needs the rest of the page.
 */
export const narrowNotes = <T extends { last_modified: string | null }>(
  notes: T[],
  { since, limit }: Narrowing = {},
): NarrowedNotes<T> => {
  let undated = 0;
  let matched = notes;

  if (since !== undefined) {
    const cutoff = parseSince(since);
    matched = notes.filter((note) => {
      // No timestamp is not evidence of being recent. Excluded from the window
      // rather than guessed into it, the same refusal intake applies elsewhere.
      if (note.last_modified === null) {
        undated += 1;
        return false;
      }
      const at = Date.parse(note.last_modified);
      if (Number.isNaN(at)) {
        undated += 1;
        return false;
      }
      return at >= cutoff;
    });
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new GraphError(`limit must be a whole number of at least 1, not ${limit}.`, false);
  }

  return {
    notes: limit === undefined ? matched : matched.slice(0, limit),
    matched: matched.length,
    undated,
  };
};

/**
 * Graph caps `previewText` at roughly 300 characters and it is always a plain
 * prefix — measured across two real notebooks, seventeen pages, no exceptions.
 * On a page of 5,800 characters that is the first 5%.
 *
 * That is still worth having: a well-kept page puts its headline facts at the
 * top, so the prefix carries name, date, venue, lead and budget for the price
 * of 4 KB across a whole notebook instead of 349 KB. But it is the top of a
 * page, not a summary of one, and nothing here may pretend otherwise.
 */
const PREVIEW_FLOOR = 40;

/**
 * Graph truncates around 300 characters and never says that it did, so the only
 * evidence a page continues is a preview that arrived at full length. Below
 * this, the preview is almost certainly the whole of a short page — the messy
 * test notebook has one of 84 characters that is 97% of its page.
 *
 * Set below the observed cap rather than at it, because the cut lands on a word
 * boundary and the exact length varies.
 */
const PREVIEW_LIKELY_CAP = 250;

/** What a fallback read returns, so a derived sketch is worth more than the preview it replaced. */
const DERIVED_SKETCH_CHARS = 600;

export type NoteSketch = NoteSummary & {
  /** The opening of the page, or null when neither route could produce one. */
  sketch: string | null;
  /** Where it came from. Never inferred by the caller — a prefix and a read are not the same evidence. */
  source: 'preview' | 'page' | 'none';
  /** Why the page had to be read, when it did. */
  fell_back: string | null;
  /** True when the page continues past the sketch, which for a preview is usually. */
  more: boolean;
  chars_total: number | null;
  error: string | null;
};

const previewOf = async (token: string, id: string): Promise<string> => {
  const res = await graphGet(`/me/onenote/pages/${encodeURIComponent(id)}/preview`, token);
  const { previewText } = (await res.json()) as { previewText?: string | null };
  return (previewText ?? '').trim();
};

/**
 * Sketch every page in a chosen notebook, cheaply, so a notebook can be triaged
 * without reading all of it.
 *
 * The cheap route is `/preview`: one call per page, but 83x fewer bytes than
 * fetching content and about half the wall-clock once parallelised.
 *
 * A preview that cannot do the job is not passed off as though it had. Where
 * Graph returns nothing, or returns too little to triage on, that page — and
 * only that page — is read properly and its sketch derived here. The answer
 * says which pages went that way and why, because a sketch built from the whole
 * page is better evidence than a 300-character prefix, and a caller that cannot
 * tell them apart will trust the weaker one as much as the stronger.
 *
 * Scoped to one notebook, as intake requires. Nothing maps across scopes.
 */
export const mapNotes = async (
  token: string,
  pages: NoteSummary[],
): Promise<{ sketches: NoteSketch[]; read_in_full: number }> => {
  const sketches = await Promise.all(
    pages.map(async (page): Promise<NoteSketch> => {
      const base = { ...page, chars_total: null as number | null, error: null as string | null };

      let preview = '';
      let reason: string | null = null;
      try {
        preview = await previewOf(token, page.id);
        // A preview this thin cannot separate a working unit from a stray
        // note, which is the one thing the map exists to do.
        if (preview === '') reason = 'the page has no preview text';
        else if (preview.length < PREVIEW_FLOOR) reason = `the preview was only ${preview.length} characters`;
      } catch (err) {
        reason = `the preview call failed (${err instanceof Error ? err.message : String(err)})`;
      }

      if (reason === null) {
        return {
          ...base,
          sketch: preview,
          source: 'preview',
          fell_back: null,
          // Graph gives no page length and does not say it truncated, so a
          // preview at full length is the only sign there is more. Inferred,
          // and reported as an inference rather than as a fact.
          more: preview.length >= PREVIEW_LIKELY_CAP,
        };
      }

      // Case by case, and only for the pages that need it.
      try {
        const { text, chars_total } = await readNote(token, page.id);
        return {
          ...base,
          sketch: text.slice(0, DERIVED_SKETCH_CHARS),
          source: 'page',
          fell_back: reason,
          more: chars_total > DERIVED_SKETCH_CHARS,
          chars_total,
        };
      } catch (err) {
        // Both routes failed. Reported as a gap, never dropped from the map:
        // a page missing from a survey reads as a page that is not there.
        return {
          ...base,
          sketch: null,
          source: 'none',
          fell_back: reason,
          more: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return { sketches, read_in_full: sketches.filter((s) => s.source === 'page').length };
};

export type NoteContent = {
  title: string;
  text: string;
  chars_total: number;
  parts_total: number;
  part: number;
  /** The part to ask for next, or null when the page is finished. */
  next_from_part: number | null;
};

/**
 * Read one page, in parts only when it is too long for a single answer.
 *
 * The cap is the attachment cap, not a second number: a whole page used to
 * arrive however long it was, and the audience this is for is exactly where one
 * enormous page lives — a year of gig notes under a single heading. Reading it
 * swallowed the context the analysis needed, and the failure was silent. The
 * page arrived, the analysis came back thinner than it should have been, and
 * nothing said why.
 *
 * Parts, not page ranges. A OneNote page has no pages, the same way a .docx
 * does not, so nothing here invents them — and the response says its unit is a
 * part rather than reusing the PDF vocabulary for something that is not a page.
 *
 * Splitting on each call rather than handing back a character offset is
 * deliberate: `htmlToText` collapses whitespace, so an offset would be into the
 * converted text and would silently mean something different if the page were
 * edited between calls. Parts move under an edit too, but they move visibly —
 * the part count changes with them.
 */
export const readNote = async (
  token: string,
  noteId: unknown,
  fromPart: unknown = 1,
): Promise<NoteContent> => {
  if (typeof noteId !== 'string' || !ONENOTE_ID.test(noteId)) {
    throw new GraphError('note_id is missing or malformed.', false);
  }
  // Encoded, and shape-checked above, so it can only ever be one path segment.
  const id = encodeURIComponent(noteId);

  const meta = await graphGet(`/me/onenote/pages/${id}?$select=title`, token);
  const { title } = (await meta.json()) as { title?: string };

  const content = await graphGet(`/me/onenote/pages/${id}/content`, token);
  const text = htmlToText(await content.text());

  const requested = typeof fromPart === 'number' ? fromPart : Number(fromPart ?? 1);
  const parts = Math.max(1, Math.ceil(text.length / MAX_TEXT_CHARS));
  const part = Math.min(
    Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 1),
    parts,
  );

  return {
    title: title ?? '(untitled)',
    text: text.slice((part - 1) * MAX_TEXT_CHARS, part * MAX_TEXT_CHARS),
    chars_total: text.length,
    parts_total: parts,
    part,
    next_from_part: part < parts ? part + 1 : null,
  };
};
