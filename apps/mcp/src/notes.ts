/**
 * OneNote: the working unit. One page is one unit of work, and everything the
 * agent pack does rests on that.
 *
 * Ported from the edge function unchanged in behaviour, including the section
 * enumeration below, which exists for a reason that is not obvious from the
 * code alone.
 */

import { createHash } from 'node:crypto';
import { MAX_TEXT_CHARS } from './attachments.js';
import { GraphError } from './client.js';
import { FANOUT_LIMIT, graphGet, mapWithConcurrency } from './api.js';
import { pageResources, type PageResource } from './page-attachments.js';
import { editablePartsFrom, type EditablePart } from './onenote-patch.js';

/**
 * A short value proving a caller has actually seen this account's notebook list.
 *
 * The gate it serves used to be a module-level boolean — "has anything listed
 * the notebooks yet" — which is a fair approximation of one CLI session and
 * nonsense on hosted, where every request may land on a different instance and
 * the flag is shared by every user on the one it lands on. It refused real
 * selections on a cold instance and admitted unseen ones on a warm one.
 *
 * Derived from the notebook names rather than stored, so it needs no session
 * and no shared storage: the same account yields the same key on any instance,
 * a client that never saw the list cannot produce it, and a key from an account
 * with different notebooks does not match. It is not a secret and does not need
 * to be — it proves the list was seen, nothing more.
 *
 * Order and case are normalised so the key does not change when Graph returns
 * the same notebooks in a different order.
 */
export const notebookKeyFor = (names: readonly string[]): string =>
  createHash('sha256')
    .update([...names].map((n) => n.trim().toLowerCase()).sort().join('\n'))
    .digest('hex')
    .slice(0, 8);

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
  lastModifiedDateTime?: string;
  parentNotebook?: { displayName?: string };
};

export type NoteSummary = {
  id: string;
  title: string;
  section: string | null;
  notebook: string | null;
  last_modified: string | null;
  /**
   * Whether `last_modified` is known to be the creation date rather than a
   * modification date. See `pageDatesAreCreationDates`.
   */
  date_is_creation?: boolean;
};

export type SectionSummary = {
  id: string;
  name: string;
  notebook: string | null;
  /** When anything in the section last changed. This field does work. */
  last_modified: string | null;
  pages: number;
};

/**
 * Whether this account reports page modification times at all.
 *
 * Microsoft returns each page's creation date in `lastModifiedDateTime` on some
 * storage clusters — measured at 164 pages out of 164 on one account, and
 * confirmed by three independent public reports. It is not universal, it is not
 * documented, and it has been fixed once before and come back, so it cannot be
 * assumed in either direction at build time. See #122.
 *
 * The test is a contradiction the data exhibits, not a heuristic: if a section
 * changed more recently than every page it contains, then something in it
 * changed and no page reported it. One such section is proof. A healthy account
 * cannot produce that, because a section's timestamp moves only when something
 * inside it does.
 *
 * Deliberately not "are all pages frozen". A page whose modified date equals its
 * creation date is ambiguous — on a healthy account that honestly means "created
 * and never edited" — and one public report describes an account where title
 * edits propagate while body edits do not. A frozen-ratio test would call that
 * account healthy and then silently miss every body edit, which is this bug
 * wearing a detector. The contradiction test catches a partially broken field as
 * readily as a completely dead one.
 *
 * Recomputed per call, from data already fetched, so it heals itself if the
 * regression is fixed and re-arms if it returns.
 */
export const pageDatesAreCreationDates = (
  sections: readonly { last_modified: string | null }[],
  pagesBySection: readonly (readonly { last_modified: string | null }[])[],
): boolean =>
  sections.some((section, i) => {
    const pages = pagesBySection[i] ?? [];
    if (section.last_modified === null || pages.length === 0) return false;
    const newest = pages.reduce((a, p) => ((p.last_modified ?? '') > a ? (p.last_modified ?? '') : a), '');
    if (newest === '') return false;
    return section.last_modified > newest;
  });

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
    // A to-do tag is an attribute on the element, so it dies with the tag strip
    // below unless it is turned into text first. Above the <li> rule too: that
    // rule rewrites the opening tag, attribute and all.
    //
    // `span` is here because OneNote moves the tag there. A cell written as
    // `<td><p data-tag="to-do">…</p></td>` comes back as
    // `<td><span data-tag="to-do">…</span></td>` — the paragraph is gone and
    // the tag is on the span. Matching only p and li meant every task inside a
    // table read as untagged, so a page whose tasks live in an Aufgaben table
    // reported none of them done however many were ticked. Found by writing
    // twelve tags, reading the page back, and concluding from clean text that
    // the write had failed; the tags were there and the reader could not see
    // them.
    .replace(/<(p|li|span)[^>]*data-tag="[^"]*\bto-do:completed\b[^"]*"[^>]*>/gi, '$&[x] ')
    .replace(/<(p|li|span)[^>]*data-tag="[^"]*\bto-do\b(?!:)[^"]*"[^>]*>/gi, '$&[ ] ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    // Numeric entities first: OneNote emits these for accented characters, so
    // without this "Müller" arrives as "M&#252;ller".
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    // U+FFFC marks where OneNote anchored an embedded object. A space, not a
    // name: the character says only that something sat here, and the page it
    // was found on has the anchor in one paragraph and the image itself well
    // below, so naming it would invite a link to an entry in `attachments`
    // that cannot be verified. Not deleted either -- it falls between two
    // words, and dropping it runs them together. See issue #70.
    .replace(/\uFFFC/g, ' ')
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
 * Which notebooks this account has, and nothing else.
 *
 * One Graph request. `listNotes` answers the same question as a side effect of
 * fetching every page of every section — a hundred requests on an organised
 * account — and the notebook question is asked far more often than the page
 * one: every call that has to ask "which notebook?" paid for the pages of all
 * of them to print a list of names.
 *
 * That is what was throttling the account. Graph refused with 20166, "the app
 * has issued too many requests on behalf of this user", against a listing whose
 * answer was already contained in the single request that starts it, since
 * `parentNotebook` expands inline on the sections call.
 *
 * Counted in sections rather than pages, because a page count is exactly the
 * thing that cannot be known without the hundred requests. A number that costs
 * a hundred requests to be slightly more familiar is not worth it, and the
 * count is only there to help the user recognise which notebook is which.
 */
export const listNotebooks = async (
  token: string,
): Promise<{ notebooks: { name: string; sections: number }[] }> => {
  const res = await graphGet(
    '/me/onenote/sections?$select=id,displayName' +
      '&$expand=parentNotebook($select=displayName)&$top=100',
    token,
  );
  const sections = ((await res.json()) as { value?: OneNoteSection[] }).value ?? [];

  const counts = new Map<string, number>();
  for (const section of sections) {
    if (typeof section.id !== 'string' || !ONENOTE_ID.test(section.id)) continue;
    const name = section.parentNotebook?.displayName ?? '(unnamed notebook)';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return {
    notebooks: [...counts].map(([name, sectionCount]) => ({ name, sections: sectionCount })),
  };
};

/**
 * `/me/onenote/pages` looks like the obvious call and works right up until the
 * account has too many sections, at which point Graph fails the whole request
 * with error 20266 and tells you to page per section instead. Organised
 * notebooks hit this, so sections are enumerated first and their pages fetched
 * one section at a time. The notebook name comes along for free.
 *
 * Do not "simplify" this back to the single call.
 */
export const listNotes = async (
  token: string,
): Promise<{
  notes: NoteSummary[];
  sections: SectionSummary[];
  /** Whether `last_modified` on every page is really its creation date. */
  page_dates_are_creation_dates: boolean;
}> => {
  const startedAt = Date.now();
  let sectionCount = 0;
  let failure: string | null = null;

  try {
  const sectionsRes = await graphGet(
    // lastModifiedDateTime is what the detector reads, and it is the field
    // that actually tracks change — unlike the one on a page. Selected here
    // rather than fetched separately: the request is made either way.
    '/me/onenote/sections?$select=id,displayName,lastModifiedDateTime' +
      '&$expand=parentNotebook($select=displayName)&$top=100',
    token,
  );
  const sections = ((await sectionsRes.json()) as { value?: OneNoteSection[] }).value ?? [];

  const usable = sections.filter((s) => typeof s.id === 'string' && ONENOTE_ID.test(s.id));
  sectionCount = usable.length;

  const perSection = await mapWithConcurrency(usable, FANOUT_LIMIT, async (section) => {
    const res = await graphGet(
      `/me/onenote/sections/${section.id}/pages` +
        // createdDateTime is selected only so the two can be compared. It
        // costs nothing — the request is made either way.
        '?$select=id,title,createdDateTime,lastModifiedDateTime&$top=100',
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
  });

  const sectionSummaries: SectionSummary[] = usable.map((section, i) => ({
    id: section.id,
    name: section.displayName ?? '(unnamed section)',
    notebook: section.parentNotebook?.displayName ?? null,
    last_modified: section.lastModifiedDateTime ?? null,
    pages: (perSection[i] ?? []).length,
  }));

  const creationDates = pageDatesAreCreationDates(sectionSummaries, perSection);

  // Newest first, matching the order the single-call version happened to
  // return; pages with no timestamp sort last rather than jumping to the top.
  const notes = perSection
    .flat()
    .map((n) => ({ ...n, date_is_creation: creationDates }))
    .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''));

  // Sections newest first for the same reason, and because when page dates are
  // useless this is the ordering the caller actually reads.
  const sectionList = sectionSummaries.sort((a, b) =>
    (b.last_modified ?? '').localeCompare(a.last_modified ?? ''),
  );

  return { notes, sections: sectionList, page_dates_are_creation_dates: creationDates };
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // Logged in a `finally`, and that is the whole point of it.
    //
    // The survey's own line sat after its await, so a run that threw logged
    // nothing — and a throttled listing throws HERE, before the survey is ever
    // reached, which is why a failed map produced nineteen 429s and no
    // evidence. A measurement that exists only when nothing went wrong
    // measures the wrong runs.
    console.warn(
      `[artist-mcp] list_notes sections=${sectionCount} ` +
        `elapsed=${Date.now() - startedAt}ms` +
        (failure === null ? '' : ` failed=${failure}`),
    );
  }
};

/**
 * The sections that changed within a window.
 *
 * The counterpart to `narrowNotes` for the case where page dates carry no
 * modification information. A section's timestamp does move when any single
 * page inside it is edited — tested with a control: one line added to one page
 * of a section untouched for eleven days moved that section and left its
 * siblings alone.
 *
 * So nothing goes undetected at this resolution. What is surrendered is which
 * page, and — because a section holds one timestamp — an older change masked by
 * a newer one in the same section.
 */
export const narrowSections = <T extends { last_modified: string | null }>(
  sections: readonly T[],
  since: string | undefined,
): { sections: T[]; undated: number } => {
  if (since === undefined) return { sections: [...sections], undated: 0 };
  const cutoff = parseSince(since);
  let undated = 0;
  const matched = sections.filter((s) => {
    if (s.last_modified === null) {
      undated += 1;
      return false;
    }
    const at = Date.parse(s.last_modified);
    if (Number.isNaN(at)) {
      undated += 1;
      return false;
    }
    return at >= cutoff;
  });
  return { sections: matched, undated };
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
 * How long a survey may spend before it returns what it has.
 *
 * The hosted route dies at sixty seconds (`maxDuration` in the MCP route), and
 * dying there is the worst available outcome: the caller waits the full minute
 * and receives nothing, not even the pages that were already sketched. Three
 * of those in a row is what a chat client's retries look like from the logs.
 *
 * Forty-five leaves room for the answer to be assembled and sent after the
 * last sketch lands. The number is a floor on usefulness rather than a tuning
 * knob: whatever the notebook looks like, the survey now returns.
 */
export const MAP_DEADLINE_MS = 45_000;

/**
 * A page the deadline was reached before. Not an error and not an empty page —
 * distinguishing it from both is the whole point, because a page that was never
 * looked at must never read as a page with nothing on it.
 */
const NOT_REACHED = Symbol('not reached');

type MapNotesOptions = {
  deadlineMs?: number;
  /** Injectable so a test can reach the deadline without spending the time. */
  now?: () => number;
};

export type MapNotesResult = {
  sketches: NoteSketch[];
  read_in_full: number;
  /** Pages the deadline cut off. Unsurveyed, and reported as such. */
  not_reached: number;
  elapsed_ms: number;
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
  { deadlineMs = MAP_DEADLINE_MS, now = Date.now }: MapNotesOptions = {},
): Promise<MapNotesResult> => {
  const mapStartedAt = now();
  const stopAt = mapStartedAt + deadlineMs;

  // Held outside the try so the `finally` can report them whatever happens.
  let sketched = 0;
  let readInFull = 0;
  let notReached = 0;
  let mapFailure: string | null = null;

  try {
  const outcomes = await mapWithConcurrency(pages, FANOUT_LIMIT, async (page): Promise<NoteSketch | typeof NOT_REACHED> => {
    // Checked before the work, not during it: a page that has started is
    // allowed to finish, because abandoning a request mid-flight costs the
    // same quota as completing it and returns nothing for the spend.
    if (now() >= stopAt) {
      notReached += 1;
      return NOT_REACHED;
    }

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
  });

  const sketches = outcomes.filter((o): o is NoteSketch => o !== NOT_REACHED);
  sketched = sketches.length;
  readInFull = sketches.filter((s) => s.source === 'page').length;

  return {
    sketches,
    read_in_full: readInFull,
    not_reached: notReached,
    elapsed_ms: now() - mapStartedAt,
  };
  } catch (err) {
    mapFailure = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // The line that says where the time went — on every run, the failed ones
    // included, because those are the runs actually worth measuring.
    //
    // Fallbacks are the suspect: a preview costs one request, a fallback costs
    // two plus the page's whole HTML, and arithmetic says forty previews at
    // four concurrent should take about five seconds rather than sixty. This
    // settles it with evidence instead.
    console.warn(
      `[artist-mcp] map_notes pages=${pages.length} sketched=${sketched} ` +
        `read_in_full=${readInFull} not_reached=${notReached} ` +
        `elapsed=${now() - mapStartedAt}ms` +
        (mapFailure === null ? '' : ` failed=${mapFailure}`),
    );
  }
};

/** A page attachment as `read_note` reports it: named, never read. */
export type PageAttachment = Omit<PageResource, 'position'>;

export type NoteContent = {
  title: string;
  text: string;
  /**
   * What is attached to the page. Listed, never read: the text alone used to
   * come back with no sign that a stage plan or a rider was sitting on the
   * page, and a reader who cannot see it reports the page as missing something
   * it actually records. See issue #70.
   */
  attachments: PageAttachment[];
  chars_total: number;
  /**
   * The page's editable parts, one line each, when this install holds
   * `onenote-edit`. Null otherwise — an id is only worth returning to a caller
   * with a tool that takes one.
   */
  editable: EditablePart[] | null;
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
  { withEditIds = false }: { withEditIds?: boolean } = {},
): Promise<NoteContent> => {
  if (typeof noteId !== 'string' || !ONENOTE_ID.test(noteId)) {
    throw new GraphError('note_id is missing or malformed.', false);
  }
  // Encoded, and shape-checked above, so it can only ever be one path segment.
  const id = encodeURIComponent(noteId);

  const meta = await graphGet(`/me/onenote/pages/${id}?$select=title`, token);
  const { title } = (await meta.json()) as { title?: string };

  // `includeIDs=true` is what makes an element addressable. It costs nothing —
  // the same fetch either way — and it is the difference between this read
  // being enough to patch from and the caller having to ask for the page again
  // through preview_onenote_edit. The ids are dropped from the text by the tag
  // strip in htmlToText, so a reader who cannot edit sees no change at all.
  const content = await graphGet(`/me/onenote/pages/${id}/content?includeIDs=true`, token);
  const html = await content.text();
  const text = htmlToText(html);
  const attachments = pageResources(html).map(({ position: _position, ...rest }) => rest);

  // Only for an install that can act on them. Deriving the index costs a pass
  // over the HTML, and listing ids at a reader who has no tool to use them on
  // is noise in every answer about a page.
  const editable = withEditIds ? editablePartsFrom(html, { full: false }) : null;

  const requested = typeof fromPart === 'number' ? fromPart : Number(fromPart ?? 1);
  const parts = Math.max(1, Math.ceil(text.length / MAX_TEXT_CHARS));
  const part = Math.min(
    Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 1),
    parts,
  );

  return {
    title: title ?? '(untitled)',
    // On every part, not only the first. A caller reading part 3 of a long page
    // is as entitled to know what is attached as one reading part 1.
    attachments,
    text: text.slice((part - 1) * MAX_TEXT_CHARS, part * MAX_TEXT_CHARS),
    chars_total: text.length,
    parts_total: parts,
    part,
    next_from_part: part < parts ? part + 1 : null,
    editable,
  };
};
