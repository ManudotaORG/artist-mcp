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
  /**
   * For a task in a table: the other cells of its row by header, each as its
   * text — the same cells `details` joins, kept apart so a reader can take one
   * without splitting a line whose cells may themselves hold "·" or ":". An
   * empty cell is "". A header used twice gets its column number. Null for a
   * task on a line.
   */
  cells: Record<string, string> | null;
  /**
   * For an open task whose own row or line says it is done, handed on, or
   * unsettled: that clause, in the page's words. `policy:tasks` calls such a
   * task unsettled — neither open nor done — and it stays that way until the
   * musician settles it. Null otherwise.
   */
  unsettled: string | null;
  /** For an open task whose status cell says it is done: that word. The tag stands; the cell is out of date. */
  stale_status: string | null;
};

/**
 * A task handed on to someone, which the musician counts as done.
 *
 * Two places record it. A delegation table — one with an "Übergeben an" column,
 * which the Festivalleitung template carries — records it as a row. Anywhere
 * else it is a ticked task whose line names who it went to, the convention
 * `policy:tasks` sets: "→ übergeben an <Name>, <Datum>".
 */
export type DelegatedTask = {
  text: string;
  /** Who it went to, as the page words it. */
  to: string;
  /** When, as the page words it, or null where nothing is recorded. */
  on: string | null;
  /** What came back, as the page words it, or null where nothing is recorded. */
  reply: string | null;
  from: 'table' | 'tick';
};

export type PageTasks = {
  /** The page's opening text up to its first task. */
  lead: string;
  /** Whether `lead` was cut at LEAD_CHARS. */
  lead_cut: boolean;
  /** Open and done tasks. A done task that records a handover is in `delegated` instead. */
  tasks: PageTask[];
  delegated: DelegatedTask[];
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

/**
 * The tagged lines in a fragment, as `htmlToText` marks them.
 *
 * Exported because this is what a task's text *is*: the snapshot, `map_notes`
 * and the digest all name a task by it, so anything that finds a task again
 * to change it — `update_row`'s row match, the task view's tick (0023) — has
 * to compare against this, not against a text function of its own.
 */
export const taggedLines = (html: string): { text: string; done: boolean }[] =>
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

type RawTask = Omit<PageTask, 'unsettled' | 'stale_status'>;
type TableRead = { tasks: RawTask[]; delegated: DelegatedTask[]; problems: string[] };

/**
 * A cell that records nothing. The templates fill an unknown field with
 * `UNKNOWN`, so a delegation table copied from one and never filled in is rows
 * of it — found live on `CL Aufgaben — Montepulciano`, whose two rows are
 * placeholders and not two handovers.
 */
const blank = (text: string): boolean => /^(|unknown|ungeklärt|tbc|—|–|-)$/i.test(text.trim());

/** The column whose header matches, or -1. */
const column = (header: string[], pattern: RegExp): number => header.findIndex((cell) => pattern.test(cell));

/**
 * A delegation table: each filled row is a handover, counted as done.
 *
 * A row needs both a task and a recipient to be one. A task with no recipient
 * was meant to be handed on and is not recorded as having been, so it is said
 * rather than counted either way.
 */
const readDelegations = (rows: string[][], header: string[], where: string): TableRead => {
  const taskAt = Math.max(0, column(header, TASK_HEADER));
  const toAt = column(header, /^übergeben an$/i);
  const onAt = column(header, /^übergeben am$/i);
  const replyAt = column(header, /^rückmeldung/i);
  const cell = (row: string[], at: number): string | null => {
    if (at < 0 || row[at] === undefined) return null;
    const text = cellText(row[at]);
    return blank(text) ? null : text;
  };

  const delegated: DelegatedTask[] = [];
  const problems: string[] = [];
  for (const row of rows.slice(1)) {
    const text = cell(row, taskAt);
    if (text === null) continue;
    const to = cell(row, toAt);
    if (to === null) {
      problems.push(`"${text}" is listed for handover in ${where} with no recipient recorded.`);
      continue;
    }
    delegated.push({ text, to, on: cell(row, onAt), reply: cell(row, replyAt), from: 'table' });
  }
  return { tasks: [], delegated, problems };
};

/**
 * A ticked task whose line records a handover, by the wording `policy:tasks`
 * sets: "übergeben an <Name>", optionally followed by a date. Only a ticked one:
 * an open task that mentions a handover is open, because the tag is the record
 * of whether the work is done.
 */
const HANDED_ON = /übergeben an\s+([^,;()]+?)\s*(?:[,;(]|$)/i;
const DATE = /\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?/;

const handover = (task: RawTask): DelegatedTask | null => {
  if (!task.done) return null;
  const named = task.text.match(HANDED_ON);
  if (!named) return null;
  const after = task.text.slice((named.index ?? 0) + named[0].length - 1);
  return {
    text: task.text,
    to: named[1].trim(),
    on: after.match(DATE)?.[0] ?? null,
    reply: null,
    from: 'tick',
  };
};

const readTable = (table: string, ordinal: number): TableRead => {
  const rows = outermost(inner(table), 'tr').map((row) =>
    outermost(inner(row.html), 't[dh]').map((cell) => cell.html),
  );
  if (rows.length === 0) return { tasks: [], delegated: [], problems: [] };

  const header = rows[0].map(cellText);
  const where = `Table ${ordinal}`;

  // Before the tag check: the delegation tables seen live carry no tags at all,
  // and a handed-on task is done whether or not anyone ticked it there.
  if (column(header, /^übergeben an$/i) >= 0) return readDelegations(rows, header, where);

  if (!TAG.test(table)) {
    // Not every table is a task table, and an untagged table of facts is fine.
    // One whose header says it holds tasks is not: its rows are work the page
    // tracks, and reading none of them as tasks would report that work absent.
    return header.length > 1 && header.some((cell) => TASK_HEADER.test(cell))
      ? {
          tasks: [],
          delegated: [],
          problems: [
            `${where} (headed "${header.join(' · ')}") has no to-do tags, so none of ` +
              `its ${rows.length - 1} row${rows.length === 2 ? ' is' : 's are'} read as tasks. Read the page with read_note ` +
              'to see them.',
          ],
        }
      : { tasks: [], delegated: [], problems: [] };
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

  const tasks: RawTask[] = [];
  for (const row of headed ? rows.slice(1) : rows) {
    const tagged = row
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => TAG.test(cell));
    if (tagged.length === 0) continue;

    const others = row
      .map((cell, index) => ({ index, text: cellText(cell) }))
      .filter(({ index }) => !tagged.some((t) => t.index === index));
    const details =
      others.map(({ index, text }) => `${label(index)}: ${text === '' ? '(empty)' : text}`).join(' · ') ||
      null;
    const cells: Record<string, string> = {};
    for (const { index, text } of others) {
      const key = label(index) in cells ? `${label(index)} (${index + 1})` : label(index);
      cells[key] = text;
    }

    for (const { cell } of tagged) {
      for (const line of taggedLines(cell)) tasks.push({ ...line, details, cells });
    }
  }
  return { tasks, delegated: [], problems };
};

/**
 * Wording on an open task's own row that contradicts its tag.
 *
 * Moved here from `policy:tasks`, which says it and was loaded in full when the
 * first watched digest reported "OFFEN — am 18.10.2026 von Ruben an Agnes
 * weitergeleitet" as delegated and listed a dozen "OFFEN — vermutlich
 * erledigt" rows as overdue. A rule applied in the output holds whether or not
 * the model remembers it, and this one fires only on the rows it is about.
 *
 * A handover needs a person: "an Agnes weitergeleitet" is one, "nur an die
 * eigene Gmail weitergeleitet" — also on a live page — is not.
 */
const SAYS_DONE = /(?<!nicht |kein )\b(erledigt|abgeschlossen)\b/i;
const SAYS_HANDED_ON =
  /\ban\s+[A-ZÄÖÜ][\wäöüß-]*(?:\s+[A-ZÄÖÜ][\wäöüß-]*)?\s+(weitergeleitet|übergeben|delegiert)\b|\b(weitergeleitet|übergeben|delegiert)\s+an\s+[A-ZÄÖÜ]/;

const clause = (text: string): string => {
  const cut = text.replace(/^[^—]*—\s*/, '').trim() || text.trim();
  return cut.length > 160 ? `${cut.slice(0, 160).trimEnd()}…` : cut;
};

/** Read an open task's row against its tag. A done task is left as it is. */
const contradictions = (task: Omit<PageTask, 'unsettled' | 'stale_status'>): PageTask => {
  const settled = { ...task, unsettled: null, stale_status: null };
  if (task.done) return settled;

  const cells = (task.details ?? '').split(' · ').filter((cell) => cell !== '');
  const status = cells.find((cell) => /^status:/i.test(cell))?.replace(/^status:\s*/i, '') ?? null;
  const statusWord = status?.match(/^[^\s—–-]+/)?.[0] ?? '';

  // The page itself says so: nothing to infer.
  if (/^ungeklärt$/i.test(statusWord)) return { ...settled, unsettled: clause(status as string) };

  // A status cell that says done beside an open tag is a stale cell, not a
  // dispute: `policy:tasks` says the tag stands. Its prose, if any, still counts.
  const stale = /^(erledigt|done|abgeschlossen)$/i.test(statusWord) ? statusWord : null;
  const prose = [
    task.text,
    ...cells.filter((cell) => !/^status:/i.test(cell)).map((cell) => cell.replace(/^[^:]+:\s*/, '')),
    ...(status === null ? [] : [status.slice(statusWord.length)]),
  ];
  const hit = prose.find((part) => SAYS_DONE.test(part) || SAYS_HANDED_ON.test(part));
  return { ...settled, unsettled: hit === undefined ? null : clause(hit), stale_status: stale };
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

  const tasks: RawTask[] = [];
  const delegated: DelegatedTask[] = [];
  const problems: string[] = [];
  const leadParts: string[] = [];
  let leadOpen = true;

  for (const piece of pieces) {
    if (piece.kind === 'table') {
      const read = readTable(piece.html, piece.ordinal);
      problems.push(...read.problems);
      delegated.push(...read.delegated);
      if (read.tasks.length > 0 || read.delegated.length > 0) {
        tasks.push(...read.tasks);
        leadOpen = false;
      }
      continue;
    }

    for (const line of htmlToText(piece.html).split('\n')) {
      const mark = line.match(CHECKBOX);
      if (mark) {
        const text = oneLine(line.replace(CHECKBOX, ''));
        if (text !== '') tasks.push({ text, done: mark[1] === 'x', details: null, cells: null });
        leadOpen = false;
      } else if (leadOpen && line.trim() !== '') {
        leadParts.push(line.trim());
      }
    }
  }

  // A ticked task that records a handover is delegated, not merely done: the
  // musician counts it done, and the digest needs the name it went to.
  const ordinary = tasks
    .filter((task) => {
      const handed = handover(task);
      if (handed !== null) delegated.push(handed);
      return handed === null;
    })
    .map(contradictions);

  if (!TAG.test(body) && delegated.length === 0) {
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
    tasks: ordinary,
    delegated,
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
