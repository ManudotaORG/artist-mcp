/**
 * Ticking a task done from the hosted task view (0023), and undoing that tick.
 *
 * Everything this needs is handed in, bound to one signed-in user by
 * `task-view.ts`: whether they hold `onenote-edit`, their own snapshot, their
 * own write log, and a dispatcher holding their tokens. No `@/` imports, so the
 * node tests in `scripts/` drive it with stubs and assert what it asks for.
 */
import {
  isTick,
  tickTask,
  undoTick,
  type Call,
  type LoggedTick,
} from '@manudota/artist-mcp/task-tick';
import type { PageTasks } from '@manudota/artist-mcp/tasks';

/** What a tick or an undo tells the row that asked. */
export type TickState =
  | { status: 'idle' }
  | {
      status: 'ticked';
      write_id: string;
      page_id: string;
      status_before: string | null;
      verified: boolean;
    }
  | { status: 'undone'; write_id: string }
  | { status: 'refused'; message: string };

export type TickDeps = {
  /**
   * Whether this user holds `onenote-edit`. Asked by every tick and every
   * undo, because the view calls the dispatcher directly: `dispatchWith`
   * checks no grant, and the grant is otherwise enforced only by which tools
   * `createServer` registers. Asked first, before anything is read.
   */
  mayTick: () => Promise<boolean>;
  /** An open or unsettled task in this user's snapshot, by its key — or null. */
  findTask: (key: string) => Promise<{ page_id: string; text: string } | null>;
  /** Whether this page is in this user's snapshot. */
  hasPage: (pageId: string) => Promise<boolean>;
  /** This user's own log entries for one write id. */
  logEntries: (writeId: string) => Promise<(LoggedTick & { status?: string })[]>;
  /** A dispatcher bound to this user, able to write. Built only after the grant check. */
  writer: () => Call;
  /** One page's tasks, re-read after a write, into the snapshot. */
  store: (pageId: string, tasks: PageTasks | null) => Promise<void>;
};

export const NO_GRANT: TickState = {
  status: 'refused',
  message:
    'Abhaken ist ausgeschaltet. Dafür braucht es im Dashboard die Freigabe zum Ändern von Seiten.',
};

/** Graph's own refusal, said in the view's words where it is one of the known ones. */
export const said = (message: string): string => {
  if (/\b(401|403)\b|forbidden|unauthori[sz]ed|access ?denied/i.test(message)) {
    return (
      'OneNote hat die Änderung abgelehnt. Geht es bei keiner Seite, Microsoft auf der ' +
      'Kontoseite neu verbinden; sonst lässt sich diese Seite nur in OneNote ändern.'
    );
  }
  if (/\b412\b|no longer reads|has moved|changed since/i.test(message)) {
    return 'Die Seite hat sich gerade geändert. Nach dem Neuladen noch einmal abhaken.';
  }
  return `Abhaken hat nicht geklappt: ${message}`;
};

/**
 * Tick the task with this key. The key is looked up in this user's own
 * snapshot, so a browser can name only a task the view showed them; the write
 * is built from a fresh read of the page, never from the snapshot.
 */
export const tickByKey = async (deps: TickDeps, key: string): Promise<TickState> => {
  if (!(await deps.mayTick())) return NO_GRANT;
  const task = await deps.findTask(key);
  if (task === null) {
    return { status: 'refused', message: 'Diese Aufgabe ist in der Ansicht nicht (mehr) offen.' };
  }
  const outcome = await tickTask(deps.writer(), task.page_id, task.text);
  await deps.store(task.page_id, outcome.tasks);
  if (!outcome.ticked) {
    return {
      status: 'refused',
      message: outcome.reason === 'failed' ? said(outcome.message) : outcome.message,
    };
  }
  return {
    status: 'ticked',
    write_id: outcome.write_id,
    page_id: task.page_id,
    status_before: outcome.status_before,
    verified: outcome.verified,
  };
};

/**
 * Undo a tick by its write id: only a write in this user's own log, on a page
 * in their snapshot, that is a tick and nothing else. The button sends an id,
 * and this keeps it from undoing anything else the log holds.
 */
export const undoById = async (
  deps: TickDeps,
  pageId: string,
  writeId: string,
): Promise<TickState> => {
  if (!(await deps.mayTick())) return NO_GRANT;
  if (!(await deps.hasPage(pageId))) {
    return { status: 'refused', message: 'Diese Seite ist nicht in der Ansicht.' };
  }
  const entries = await deps.logEntries(writeId);
  const entry =
    entries.find((e) => e.write_id === writeId && e.status === 'done') ??
    entries.find((e) => e.write_id === writeId);
  if (entry === undefined || entry.target !== pageId || !isTick(entry)) {
    return {
      status: 'refused',
      message:
        'Das lässt sich hier nicht rückgängig machen. In OneNote den Haken wieder entfernen.',
    };
  }
  const outcome = await undoTick(deps.writer(), pageId, writeId);
  await deps.store(pageId, outcome.tasks);
  return outcome.undone
    ? { status: 'undone', write_id: writeId }
    : { status: 'refused', message: said(outcome.message) };
};
