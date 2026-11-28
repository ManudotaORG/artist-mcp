/**
 * Ticking one task done from the hosted task view (0023).
 *
 * The view's snapshot names a task by its text and its page, and holds no
 * element ids. So a tick never acts on the snapshot: it reads the page as it
 * is now, finds the task there by the same text tasks mode gave it, and makes
 * the change through operations the dispatcher already has — `update_row` for
 * a table row, a replace with `expect` for a line — so the operation table
 * gains no row and no write leaves through any other path.
 *
 * Here, not in `apps/web`, for the reason `task-pages.ts` is shared: which
 * element a task is belongs with what a task is (`pageTasks`), so the view
 * and every other reader cannot come to disagree about it.
 */
import { asText, childElements, validateFragment } from './onenote-patch.js';
import { pageTasks, taggedLines, type PageTasks } from './tasks.js';

/** A header naming the task column, as `update_row` and tasks mode match it. */
const TASK_COLUMN = /^(aufgaben?|tasks?|to-?dos?)$/i;
const STATUS_COLUMN = /^status$/i;
const TAG = /data-tag="([^"]*)"/i;

/** The word `policy:tasks` names for done, used where a table has no ticked row to learn from. */
export const DEFAULT_DONE_WORD = 'ERLEDIGT';

export type TickPlan =
  | {
      kind: 'row';
      /** The table's generated id, for `update_row`'s `element_id`. */
      element_id: string;
      /** The task text `update_row` matches the row by. */
      row: string;
      /** The Status cell to set with the tick, by header name; empty where the table has none. */
      set: Record<string, string>;
      /** What the Status cell said before, or null. Shown with the result, since the tick overwrites it. */
      status_before: string | null;
    }
  | {
      kind: 'line';
      element_id: string;
      /** The paragraph as it will be written: as read, with its tag ticked and its ids gone. */
      html: string;
      /** The paragraph's text as read, for the replace's stale-state check. */
      expect: string;
    };

export type TickRefusalReason =
  | 'not_found'
  | 'several'
  | 'done'
  | 'status_words'
  | 'formatting'
  | 'not_task_table';

export type TickRefusal = { refused: TickRefusalReason; message: string };

/** What the view says for each refusal. German, because the view is Ruben's. */
const REFUSAL: Record<TickRefusalReason, string> = {
  not_found: 'Diese Aufgabe steht so nicht mehr auf der Seite.',
  several: 'Diese Aufgabe steht mehrmals auf der Seite.',
  done: 'Schon erledigt.',
  status_words: 'Die Spalte Status nennt Erledigtes unterschiedlich',
  formatting: 'Diese Zeile hat eine Formatierung, die hier nicht erhalten bliebe.',
  not_task_table: 'Diese Aufgabe steht in einer Tabelle ohne Aufgaben-Spalte.',
};

const refuse = (refused: TickRefusalReason, detail = ''): TickRefusal => ({
  refused,
  message: detail === '' ? REFUSAL[refused] : `${REFUSAL[refused]} (${detail}).`,
});

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const cellText = (cell: string): string => oneLine(asText(cell));
const isTagged = (html: string): boolean => /data-tag="[^"]*\bto-do\b/i.test(html);
const isDone = (html: string): boolean => /data-tag="[^"]*\bto-do:completed\b/i.test(html);

/** Where each outermost table sits in the body, so lines can be looked for outside them. */
const tableSpans = (body: string): { start: number; end: number; html: string }[] => {
  const spans: { start: number; end: number; html: string }[] = [];
  const pattern = /<(\/?)table\b[^>]*>/gi;
  let depth = 0;
  let start = -1;
  for (const match of body.matchAll(pattern)) {
    if (match[1] === '') {
      if (depth === 0) start = match.index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const end = match.index + match[0].length;
        spans.push({ start, end, html: body.slice(start, end) });
      }
    }
  }
  return spans;
};

type Candidate =
  | { kind: 'row'; done: boolean; plan: () => TickPlan | TickRefusal }
  | { kind: 'line'; done: boolean; plan: () => TickPlan | TickRefusal };

/** Every place on the page whose task text is `text`: table rows, then lines outside tables. */
const candidates = (html: string, text: string): Candidate[] => {
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '');
  const tables = tableSpans(body);
  const found: Candidate[] = [];

  for (const table of tables) {
    if (!isTagged(table.html)) continue;
    const tableId = table.html.match(/^<table\b[^>]*\bid="([^"]+)"/i)?.[1] ?? null;
    const rows = childElements(table.html, 'tr');
    const header = rows.length === 0 ? [] : childElements(rows[0], 'td|th').map(cellText);
    const taskAt = header.findIndex((cell) => TASK_COLUMN.test(cell));
    const statusAt = header.findIndex((cell) => STATUS_COLUMN.test(cell));

    rows.forEach((row, index) => {
      const cells = childElements(row, 'td|th');
      cells.forEach((cell, at) => {
        const lines = taggedLines(cell);
        const hit = lines.find((line) => line.text === text);
        if (hit === undefined) return;
        found.push({
          kind: 'row',
          done: hit.done,
          plan: () => {
            if (tableId === null || index === 0 || taskAt < 0 || at !== taskAt || header.length < 2) {
              return refuse('not_task_table');
            }
            // update_row ticks the one tag in the task cell; a cell holding two
            // tasks would have the wrong one ticked, or both.
            if (lines.length !== 1) return refuse('several', 'mehrere Aufgaben in einer Zelle');
            return planRow(rows, header, taskAt, statusAt, tableId, text, cells);
          },
        });
      });
    });
  }

  // Lines: tagged paragraphs outside every table. A tagged list item is found
  // too, so it counts as a match, but it cannot be replaced on its own — a
  // fragment holding a bare <li> is refused by the edit path — so it is one
  // to tick in OneNote.
  let outside = '';
  let at = 0;
  for (const table of tables) {
    outside += body.slice(at, table.start);
    at = table.end;
  }
  outside += body.slice(at);
  for (const element of outside.matchAll(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi)) {
    const markup = element[0];
    if (!isTagged(markup.match(/^<[^>]+>/)?.[0] ?? '')) continue;
    const lines = taggedLines(markup);
    const hit = lines.find((line) => line.text === text);
    if (hit === undefined) continue;
    found.push({
      kind: 'line',
      done: hit.done,
      plan: () => (element[1].toLowerCase() === 'p' ? planLine(markup) : refuse('formatting', 'Listenpunkt')),
    });
  }
  return found;
};

/** The word a Status cell opens with — "ERLEDIGT" in "ERLEDIGT — am 28.08. gesendet" — or null. */
export const statusWord = (cell: string): string | null =>
  cell.match(/^[\p{L}\p{N}][\p{L}\p{N}-]*/u)?.[0] ?? null;

const planRow = (
  rows: string[],
  header: string[],
  taskAt: number,
  statusAt: number,
  tableId: string,
  text: string,
  cells: string[],
): TickPlan | TickRefusal => {
  if (statusAt < 0) return { kind: 'row', element_id: tableId, row: text, set: {}, status_before: null };

  // The page's own word for done: the word a Status cell opens with on the
  // rows of this table that are already ticked. One word, used; none,
  // ERLEDIGT; more than one, refused — the view does not choose between
  // Ruben's words. The opening word, not the cell: on the live pages a done
  // cell reads "ERLEDIGT — beantwortet; die Vorprobe …", and the first build,
  // taking the whole cell, would have written that clause into every tick on
  // the table (0023, measured before any write).
  const words = new Set<string>();
  for (const row of rows.slice(1)) {
    const rowCells = childElements(row, 'td|th');
    const task = rowCells[taskAt] ?? '';
    if (!isDone(task)) continue;
    const word = statusWord(cellText(rowCells[statusAt] ?? ''));
    if (word !== null) words.add(word);
  }
  if (words.size > 1) return refuse('status_words', [...words].map((w) => `„${w}“`).join(', '));
  const word = words.size === 1 ? [...words][0] : DEFAULT_DONE_WORD;
  const before = cellText(cells[statusAt] ?? '');
  return {
    kind: 'row',
    element_id: tableId,
    row: text,
    set: { [header[statusAt]]: word },
    status_before: before === '' ? null : before,
  };
};

/**
 * The paragraph ticked: its opening tag's to-do value changed, every id and
 * data-id removed, nothing else touched. Refused rather than flattened when the
 * result is not something the edit path will send, because the alternative is
 * a tick that quietly strips Ruben's formatting.
 */
const planLine = (markup: string): TickPlan | TickRefusal => {
  const open = markup.match(/^<p\b[^>]*>/i)?.[0] ?? '';
  const elementId = open.match(/\bid="([^"]+)"/i)?.[1];
  if (elementId === undefined) return refuse('formatting', 'ohne Kennung');
  const tag = open.match(TAG)?.[1] ?? '';
  if (tag !== 'to-do') return refuse('formatting', `Markierung „${tag}“`);

  const ticked = markup
    .replace(/^<p\b[^>]*>/i, (o) => o.replace(TAG, 'data-tag="to-do:completed"'))
    .replace(/\s(?:id|data-id)="[^"]*"/gi, '');
  try {
    validateFragment(ticked);
  } catch {
    return refuse('formatting');
  }
  return { kind: 'line', element_id: elementId, html: ticked, expect: oneLine(asText(markup)) };
};

/**
 * How to tick the task named `text` on this page, from the page's HTML as read
 * with ids — or why it cannot be ticked from here. Pure: it reads nothing and
 * writes nothing.
 */
export const planTick = (html: string, text: string): TickPlan | TickRefusal => {
  const wanted = oneLine(text);
  const found = candidates(html, wanted);
  if (found.length === 0) return refuse('not_found');
  if (found.length > 1) return refuse('several');
  if (found[0].done) return refuse('done');
  return found[0].plan();
};

/** A dispatcher bound to one user, as `dispatchWith` returns it. */
export type Call = <T>(op: 'read_note' | 'edit_onenote_page' | 'undo_write', params: Record<string, unknown>) => Promise<T>;

export type TickOutcome =
  | {
      ticked: true;
      /**
       * The write's id, from its result. Null when the write's response was
       * lost but the page shows the task done: the write landed, and its id is
       * only in the write log's pending line, which the caller can look up.
       */
      write_id: string | null;
      /** The page's tasks read after the write, for the snapshot. Null if that read failed. */
      tasks: PageTasks | null;
      /** What the Status cell said before the tick, when it was overwritten. */
      status_before: string | null;
      /** True when the read after the write shows the task done. */
      verified: boolean;
      /** True when the write reported a failure and the page shows the task done anyway. */
      response_lost: boolean;
    }
  | {
      ticked: false;
      reason: TickRefusalReason | 'failed';
      message: string;
      /** The page's tasks as just read, for the snapshot, when the refusal came from a fresh read. */
      tasks: PageTasks | null;
    };

const readPage = async (call: Call, pageId: string): Promise<string> => {
  const read = await call<{ html?: string }>('read_note', { note_id: pageId, include_html: true });
  if (typeof read.html !== 'string') throw new Error('The page came back without its content.');
  return read.html;
};

const reread = async (call: Call, pageId: string): Promise<PageTasks | null> => {
  try {
    return pageTasks(await readPage(call, pageId));
  } catch {
    return null;
  }
};

/**
 * Tick one task: read the page fresh, find it, write, read the page again.
 * About five OneNote requests. Never retried: a failure is reported, and the
 * view offers OneNote.
 */
export const tickTask = async (call: Call, pageId: string, text: string): Promise<TickOutcome> => {
  let html: string;
  try {
    html = await readPage(call, pageId);
  } catch (err) {
    return { ticked: false, reason: 'failed', message: messageOf(err), tasks: null };
  }
  const plan = planTick(html, text);
  if ('refused' in plan) {
    return { ticked: false, reason: plan.refused, message: plan.message, tasks: pageTasks(html) };
  }

  let writeId: string | undefined;
  try {
    const result = await call<{ write_ids?: string[] }>(
      'edit_onenote_page',
      plan.kind === 'row'
        ? {
            page_id: pageId,
            action: 'update_row',
            element_id: plan.element_id,
            row: plan.row,
            done: true,
            ...(Object.keys(plan.set).length > 0 ? { set: plan.set } : {}),
          }
        : { page_id: pageId, action: 'replace', element_id: plan.element_id, html: plan.html, expect: plan.expect },
    );
    writeId = result.write_ids?.[0];
  } catch (err) {
    // A failed write may still have landed: a timeout or a dropped connection
    // after OneNote saved it looks exactly like a refusal from here. The page
    // is read again anyway, for the snapshot, so it decides. A task that now
    // reads done is reported as done — the view must not offer to tick again,
    // or say "nicht geklappt", about a task OneNote holds ticked.
    const after = await reread(call, pageId);
    if (readsDone(after, text)) {
      return {
        ticked: true,
        write_id: null,
        tasks: after,
        status_before: plan.kind === 'row' ? plan.status_before : null,
        verified: true,
        response_lost: true,
      };
    }
    return { ticked: false, reason: 'failed', message: messageOf(err), tasks: after };
  }
  if (writeId === undefined) {
    return { ticked: false, reason: 'failed', message: 'Die Änderung nannte keine Kennung.', tasks: await reread(call, pageId) };
  }

  const tasks = await reread(call, pageId);
  return {
    ticked: true,
    write_id: writeId,
    tasks,
    status_before: plan.kind === 'row' ? plan.status_before : null,
    verified: readsDone(tasks, text),
    response_lost: false,
  };
};

/** Whether a read of the page shows the task with this text done. */
const readsDone = (tasks: PageTasks | null, text: string): boolean => {
  const wanted = oneLine(text);
  return tasks !== null && tasks.tasks.some((task) => task.text === wanted && task.done);
};

/** A log entry, as `ReadWriteLog` returns it. Only the fields the check reads. */
export type LoggedTick = {
  operation: string;
  /** When it was recorded, as the log gives it. */
  at?: string;
  status?: string;
  target: string;
  pre_image?: string | null;
  wrote?: string | null;
  write_id?: string;
};

/**
 * Whether a logged write is a tick this view could have made: a table row
 * whose only change was ticking it and its Status cell, or a paragraph whose
 * only change was its to-do tag. The undo button sends a write id, and this
 * keeps it from undoing anything else in the log.
 */
export const isTick = (entry: LoggedTick): boolean => {
  if (entry.operation === 'update_table_row' && typeof entry.wrote === 'string') {
    try {
      const wrote = JSON.parse(entry.wrote) as {
        header?: string[];
        before?: { cells?: string[]; done?: boolean };
        after?: { cells?: string[]; done?: boolean };
      };
      const header = wrote.header ?? [];
      const before = wrote.before?.cells ?? [];
      const after = wrote.after?.cells ?? [];
      if (wrote.before?.done !== false || wrote.after?.done !== true || before.length !== after.length) return false;
      return before.every((cell, at) => cell === after[at] || STATUS_COLUMN.test(header[at] ?? ''));
    } catch {
      return false;
    }
  }
  if (entry.operation === 'replace_onenote_element' && typeof entry.pre_image === 'string' && typeof entry.wrote === 'string') {
    const was = entry.pre_image.match(/^<p\b[^>]*>/i)?.[0] ?? '';
    const now = entry.wrote.match(/^<p\b[^>]*>/i)?.[0] ?? '';
    return (
      was.match(TAG)?.[1] === 'to-do' &&
      now.match(TAG)?.[1] === 'to-do:completed' &&
      oneLine(asText(entry.pre_image)) === oneLine(asText(entry.wrote))
    );
  }
  return false;
};

export type UndoOutcome =
  | { undone: true; tasks: PageTasks | null }
  | { undone: false; message: string; tasks: PageTasks | null };

/** Undo a tick by its write id, then read the page again for the snapshot. */
export const undoTick = async (call: Call, pageId: string, writeId: string): Promise<UndoOutcome> => {
  try {
    await call('undo_write', { write_id: writeId });
  } catch (err) {
    return { undone: false, message: messageOf(err), tasks: await reread(call, pageId) };
  }
  return { undone: true, tasks: await reread(call, pageId) };
};

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Whether a logged write is a tick of the task with this text. Used to find
 * the write id of a tick whose response was lost: its pending line, recorded
 * before the write, carries the id, and nothing else does.
 */
export const isTickOf = (entry: LoggedTick, text: string): boolean => {
  if (!isTick(entry) || typeof entry.wrote !== 'string') return false;
  const wanted = oneLine(text);
  if (entry.operation === 'update_table_row') {
    try {
      const cells = (JSON.parse(entry.wrote) as { before?: { cells?: string[] } }).before?.cells ?? [];
      // The logged cells are whole cells; a task with a note on a second line
      // in its cell reads as the task text followed by that note.
      return cells.some((cell) => oneLine(cell) === wanted || oneLine(cell).startsWith(`${wanted} `));
    } catch {
      return false;
    }
  }
  return oneLine(asText(entry.wrote)) === wanted;
};
