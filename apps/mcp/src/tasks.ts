/**
 * The tasks on a CL Aufgaben page, in the page's own words.
 *
 * `map_notes` with `tasks: true` reads one page per section, the project's CL
 * Aufgaben page, and returns what this extracts from it. See
 * docs/decisions/0014-tasks-on-map-notes.md.
 *
 * Facts only. No date is parsed, no urgency ranked, no task called overdue or
 * stale: that is `policy:tasks`, applied by the model. What this does decide is
 * shape — which text is a task, which cells belong to it, and when the page is
 * not in a shape that can be read reliably. That last one is said, never
 * absorbed: `policy:tasks` is explicit that untracked work is not absent work,
 * so a task this cannot place must not simply vanish from the answer.
 *
 * A task is a to-do tag (0008). In a table OneNote moves the tag from the
 * paragraph onto a `span` in the cell; `htmlToText` follows it there, and so
 * does this, by going through `htmlToText` for every piece of text.
 */
import { FANOUT_LIMIT, graphGet, mapWithConcurrency } from './api.js';
import {
  MAP_DEADLINE_MS,
  NOT_REACHED,
  beforeDeadline,
  htmlToText,
  type NoteSummary,
} from './notes.js';

/** The opening prose kept per page. 400 held the one page-wide deadline seen live. */
export const LEAD_CHARS = 400;

export type PageTask = {
  /** The tagged text itself. */
  text: string;
  done: boolean;
  /** For a task in a table: the rest of its row, labelled by the header row. */
  details: string | null;
};

export type PageTasks = {
  /** The page's opening text up to its first task. */
  lead: string;
  /** Whether `lead` was cut at LEAD_CHARS. */
  lead_cut: boolean;
  tasks: PageTask[];
  /** Ways the page is not in a shape that reads reliably, each said in a sentence. */
  problems: string[];
};

const TAG = /data-tag="[^"]*\bto-do\b/i;
const CHECKBOX = /^(?:- )?\[( |x)\] /;

/**
 * The outermost elements named `tag` in `html`, each as its full markup, in
 * order, with where each one starts and ends.
 *
 * Depth-counted rather than matched lazily, because a table nested in a cell
 * would otherwise end the outer table at the inner one's close.
 */
const outermost = (html: string, tag: string): { start: number; end: number; html: string }[] => {
  const found: { start: number; end: number; html: string }[] = [];
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  let depth = 0;
  let start = -1;
  for (const match of html.matchAll(pattern)) {
    if (match[1] === '') {
      if (depth === 0) start = match.index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const end = match.index + match[0].length;
        found.push({ start, end, html: html.slice(start, end) });
      }
    }
  }
  return found;
};

/** The inside of an element, without its own opening and closing tags. */
const inner = (element: string): string =>
  element.replace(/^<[^>]+>/, '').replace(/<\/[a-z0-9]+>\s*$/i, '');

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A cell as its text on one line, checkbox markers removed. */
const cellText = (cell: string): string =>
  oneLine(
    htmlToText(cell)
      .split('\n')
      .map((line) => line.replace(CHECKBOX, ''))
      .join(' '),
  );

/** The tagged lines in a fragment, as `htmlToText` marks them. */
const taggedLines = (html: string): { text: string; done: boolean }[] =>
  htmlToText(html)
    .split('\n')
    .map((line) => line.match(CHECKBOX) && { line, done: line.match(CHECKBOX)?.[1] === 'x' })
    .filter((hit): hit is { line: string; done: boolean } => Boolean(hit))
    .map(({ line, done }) => ({ text: oneLine(line.replace(CHECKBOX, '')), done }))
    .filter(({ text }) => text !== '');

/**
 * A header cell that names a task column, for spotting a task table nobody
 * tagged. The whole cell, not a word in it: the live pages use one-cell tables
 * as boxes of prose, and key-value tables whose cells mention "Aufgaben" in
 * passing, and matching a word in those flagged a dozen tables per notebook
 * that hold no tasks. Found on the first live run.
 */
const TASK_HEADER = /^(aufgaben?|tasks?|to-?dos?)$/i;

type TableRead = { tasks: PageTask[]; problems: string[] };

const readTable = (table: string, ordinal: number): TableRead => {
  const rows = outermost(inner(table), 'tr').map((row) =>
    outermost(inner(row.html), 't[dh]').map((cell) => cell.html),
  );
  if (rows.length === 0) return { tasks: [], problems: [] };

  const header = rows[0].map(cellText);
  const where = `Table ${ordinal}`;

  if (!TAG.test(table)) {
    // Not every table is a task table, and an untagged table of facts is fine.
    // One whose header says it holds tasks is not: its rows are work the page
    // tracks, and reading none of them as tasks would report that work absent.
    return header.length > 1 && header.some((cell) => TASK_HEADER.test(cell))
      ? {
          tasks: [],
          problems: [
            `${where} (headed "${header.join(' · ')}") has no to-do tags, so none of ` +
              `its ${rows.length - 1} row${rows.length === 2 ? ' is' : 's are'} read as tasks. Read the page with read_note ` +
              'to see them.',
          ],
        }
      : { tasks: [], problems: [] };
  }

  // The header row is the first row on every task table seen live. A tagged
  // first row means there is no header, and the labels would be invented.
  const headed = !rows[0].some((cell) => TAG.test(cell));
  const problems = headed
    ? []
    : [
        `${where} has a task in its first row, so it has no header row; its other ` +
          'cells are labelled by column number instead.',
      ];
  const label = (index: number): string =>
    headed && header[index] ? header[index] : `Column ${index + 1}`;

  const tasks: PageTask[] = [];
  for (const row of headed ? rows.slice(1) : rows) {
    const tagged = row
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => TAG.test(cell));
    if (tagged.length === 0) continue;

    const details =
      row
        .map((cell, index) => ({ index, text: cellText(cell) }))
        .filter(({ index }) => !tagged.some((t) => t.index === index))
        .map(({ index, text }) => `${label(index)}: ${text === '' ? '(empty)' : text}`)
        .join(' · ') || null;

    for (const { cell } of tagged) {
      for (const line of taggedLines(cell)) tasks.push({ ...line, details });
    }
  }
  return { tasks, problems };
};

/**
 * The tasks on one page, from its HTML as Graph returns it.
 *
 * Tasks come in document order: a table's tasks where the table sits, lines
 * where they sit — so the lines the digest appends below a table come after it.
 */
export const pageTasks = (html: string): PageTasks => {
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '');
  const tables = outermost(body, 'table');

  type Piece = { kind: 'text'; html: string } | { kind: 'table'; html: string; ordinal: number };
  const pieces: Piece[] = [];
  let at = 0;
  tables.forEach((table, i) => {
    pieces.push({ kind: 'text', html: body.slice(at, table.start) });
    pieces.push({ kind: 'table', html: table.html, ordinal: i + 1 });
    at = table.end;
  });
  pieces.push({ kind: 'text', html: body.slice(at) });

  const tasks: PageTask[] = [];
  const problems: string[] = [];
  const leadParts: string[] = [];
  let leadOpen = true;

  for (const piece of pieces) {
    if (piece.kind === 'table') {
      const read = readTable(piece.html, piece.ordinal);
      problems.push(...read.problems);
      if (read.tasks.length > 0) {
        tasks.push(...read.tasks);
        leadOpen = false;
      }
      continue;
    }

    for (const line of htmlToText(piece.html).split('\n')) {
      const mark = line.match(CHECKBOX);
      if (mark) {
        const text = oneLine(line.replace(CHECKBOX, ''));
        if (text !== '') tasks.push({ text, done: mark[1] === 'x', details: null });
        leadOpen = false;
      } else if (leadOpen && line.trim() !== '') {
        leadParts.push(line.trim());
      }
    }
  }

  if (!TAG.test(body)) {
    problems.push(
      'This page has no to-do tags, so no task on it can be read. That does not ' +
        'mean it holds no work: read it with read_note.',
    );
  }

  const leadFull = leadParts.join(' ');
  const lead_cut = leadFull.length > LEAD_CHARS;
  return {
    lead: lead_cut ? `${leadFull.slice(0, LEAD_CHARS).trimEnd()}…` : leadFull,
    lead_cut,
    tasks,
    problems,
  };
};

export type TaskPageRead = {
  page: NoteSummary;
  /** Null when the page could not be read; `error` says why. */
  tasks: PageTasks | null;
  error: string | null;
};

export type MapTasksResult = {
  read: TaskPageRead[];
  /** Pages the deadline was reached before, unread and reported as such. */
  not_reached: NoteSummary[];
  elapsed_ms: number;
};

/**
 * Read each CL Aufgaben page and extract its tasks: one request per page.
 *
 * The caller has already chosen the pages — one per section, by the title rule
 * — so nothing here decides which pages are task pages. The deadline and the
 * pacer behave exactly as in `mapNotes`: a started read is raced against the
 * clock, and a page it cut off is named as not reached rather than dropped,
 * because a project missing from a digest reads as a project with nothing open.
 */
export const mapTasks = async (
  token: string,
  pages: NoteSummary[],
  { deadlineMs = MAP_DEADLINE_MS, now = Date.now }: { deadlineMs?: number; now?: () => number } = {},
): Promise<MapTasksResult> => {
  const startedAt = now();
  const stopAt = startedAt + deadlineMs;
  console.warn(`[artist-mcp] map_notes tasks start pages=${pages.length} deadline=${deadlineMs}ms`);

  const read: TaskPageRead[] = [];
  const notReached: NoteSummary[] = [];
  let failure: string | null = null;

  try {
    const outcomes = await mapWithConcurrency(pages, FANOUT_LIMIT, async (page) => {
      if (now() >= stopAt) return NOT_REACHED;
      try {
        // No includeIDs: the ids are for editing, and this is a read that
        // should cost as few bytes as it can.
        const got = await beforeDeadline(
          graphGet(`/me/onenote/pages/${encodeURIComponent(page.id)}/content`, token).then((res) =>
            res.text(),
          ),
          stopAt,
          now,
        );
        if (got === NOT_REACHED) return NOT_REACHED;
        return { page, tasks: pageTasks(got), error: null };
      } catch (err) {
        return { page, tasks: null, error: err instanceof Error ? err.message : String(err) };
      }
    });

    outcomes.forEach((outcome, index) => {
      if (outcome === NOT_REACHED) notReached.push(pages[index]);
      else read.push(outcome);
    });

    return { read, not_reached: notReached, elapsed_ms: now() - startedAt };
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    console.warn(
      `[artist-mcp] map_notes tasks pages=${pages.length} read=${read.length} ` +
        `not_reached=${notReached.length} elapsed=${now() - startedAt}ms` +
        (failure === null ? '' : ` failed=${failure}`),
    );
  }
};
