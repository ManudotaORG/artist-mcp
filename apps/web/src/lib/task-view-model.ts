/**
 * What the hosted task view shows, built from the stored snapshot (0020).
 *
 * Pure: no database, no network, no `@/` imports, so the node tests in
 * `scripts/` can run it directly. Everything here is arrangement — grouping,
 * counting, comparing with what was last seen. Nothing is judged: no person or
 * kind of work is inferred. Dates are read only by `task-timeline.ts`, for the
 * Zeitplan (0021), and only from a cell. The tasks are what `pageTasks`
 * returned, in the page's own words.
 */
import { createHash } from 'node:crypto';
import type { DelegatedTask, PageTask, PageTasks } from '@manudota/artist-mcp/tasks';

export type SnapshotPage = {
  page_id: string;
  notebook: string;
  section: string;
  title: string;
  web_url: string | null;
  client_url: string | null;
  read_at: string;
  error: string | null;
  tasks: PageTasks | null;
};

export type SnapshotNotebook = {
  notebook: string;
  position: number;
  listed_at: string | null;
  full_at: string | null;
  sections_without: string[];
  sections_several: string[];
  /** CL Aufgaben pages the last listing found and no read has reached yet. */
  pending: {
    page_id: string;
    section: string;
    title: string;
    web_url: string | null;
    client_url: string | null;
  }[];
  error: string | null;
  error_at: string | null;
};

export type SnapshotUser = {
  refresh_started_at: string | null;
  refresh_full: boolean;
  full_started_at: string | null;
  seen_at: string | null;
  seen_keys: string[];
};

export type Snapshot = {
  user: SnapshotUser | null;
  notebooks: SnapshotNotebook[];
  pages: SnapshotPage[];
};

/** The views Ruben named, plus Zu klären, which an unsettled task needs. */
export const VIEWS = [
  { id: 'heute', label: 'Heute' },
  { id: 'neu', label: 'Neu' },
  { id: 'projekte', label: 'Projekte' },
  { id: 'menschen', label: 'Menschen' },
  { id: 'taetigkeiten', label: 'Tätigkeiten' },
  { id: 'warten', label: 'Warten / delegiert' },
  { id: 'fristen', label: 'Fristen' },
  { id: 'zeitplan', label: 'Zeitplan' },
  { id: 'klaeren', label: 'Zu klären' },
] as const;

export type ViewId = (typeof VIEWS)[number]['id'];

export const isViewId = (value: unknown): value is ViewId =>
  typeof value === 'string' && VIEWS.some((v) => v.id === value);

/**
 * Views that cannot be built honestly yet, and why. Said on the view rather
 * than hidden, so their absence is not read as nothing to do.
 */
export const WAITING: Partial<Record<ViewId, string>> = {
  taetigkeiten:
    'Auf den CL Aufgaben-Seiten steht nirgends, welche Art Arbeit eine Aufgabe ist. Das wartet auf ' +
    'die Entscheidung in „CL Aufgaben-Kategorien“, ob es eine Spalte oder ein Tag wird. Geraten wird ' +
    'hier nichts.',
};

/** One task as the view shows it, with where it came from. */
export type ShownTask = {
  key: string;
  text: string;
  details: string | null;
  /** The row's cells by header; null for a task on a line. */
  cells: Record<string, string> | null;
  unsettled: string | null;
  stale_status: string | null;
  page: SnapshotPage;
  /** Whether the view offers a tick box for it (0023): set by `allowTicks`, never from the snapshot. */
  tickable?: boolean;
};

export type ShownHandover = DelegatedTask & { key: string; page: SnapshotPage };

export type ProjectGroup = {
  page: SnapshotPage;
  open: ShownTask[];
  unsettled: ShownTask[];
  done: number;
  delegated: ShownHandover[];
  problems: string[];
  lead: string;
  notReached: boolean;
};

export type TaskView = {
  projects: ProjectGroup[];
  unread: SnapshotPage[];
  open: ShownTask[];
  unsettled: ShownTask[];
  delegated: ShownHandover[];
  fresh: { tasks: ShownTask[]; delegated: ShownHandover[] } | null;
  keys: string[];
  counts: Record<ViewId, number | null>;
  oldestRead: string | null;
  newestRead: string | null;
  sectionsWithout: { notebook: string; section: string }[];
  sectionsSeveral: { notebook: string; section: string }[];
  notebookErrors: { notebook: string; error: string; at: string | null }[];
  neverRead: string[];
  /** CL Aufgaben pages found but not read yet, with no older copy to show. */
  waiting: { notebook: string; section: string; title: string }[];
};

/**
 * A task's identity, for Neu: its page and its text, with case and whitespace
 * ignored. A task has no id of its own, so a reworded task is a new one and
 * the view says so. Hashed, because the key is compared and never shown, and a
 * second copy of the text kept for comparison would be a copy for nothing.
 */
export const taskKey = (pageId: string, text: string): string =>
  createHash('sha256')
    .update(`${pageId}\n${text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);

const byProject = (a: SnapshotPage, b: SnapshotPage) =>
  a.notebook.localeCompare(b.notebook, 'de') || a.section.localeCompare(b.section, 'de');

export const buildTaskView = (snapshot: Snapshot): TaskView => {
  const pages = [...snapshot.pages].sort(byProject);
  const pending = snapshot.notebooks.flatMap((n) =>
    n.pending.map((p) => ({ ...p, notebook: n.notebook })),
  );
  const notReached = new Set(pending.map((p) => p.page_id));
  const stored = new Set(snapshot.pages.map((p) => p.page_id));

  const projects: ProjectGroup[] = [];
  const unread: SnapshotPage[] = [];
  const keys: string[] = [];

  for (const page of pages) {
    if (page.tasks === null) {
      unread.push(page);
      continue;
    }
    const shown = (t: PageTask): ShownTask => ({
      key: taskKey(page.page_id, t.text),
      text: t.text,
      details: t.details,
      // Absent in a snapshot stored before the parser returned cells.
      cells: t.cells ?? null,
      unsettled: t.unsettled,
      stale_status: t.stale_status,
      page,
    });
    const tasks = page.tasks.tasks.map((t) => ({ raw: t, shown: shown(t) }));
    const delegated = page.tasks.delegated.map((d) => ({
      ...d,
      key: taskKey(page.page_id, d.text),
      page,
    }));
    // Every task counts for Neu, done ones included, so a task ticked and then
    // unticked is not new.
    keys.push(...tasks.map((t) => t.shown.key), ...delegated.map((d) => d.key));
    projects.push({
      page,
      open: tasks.filter((t) => !t.raw.done && t.raw.unsettled === null).map((t) => t.shown),
      unsettled: tasks.filter((t) => !t.raw.done && t.raw.unsettled !== null).map((t) => t.shown),
      done: tasks.filter((t) => t.raw.done).length,
      delegated,
      problems: page.tasks.problems,
      lead: page.tasks.lead,
      notReached: notReached.has(page.page_id),
    });
  }

  const open = projects.flatMap((p) => p.open);
  const unsettled = projects.flatMap((p) => p.unsettled);
  const delegated = projects.flatMap((p) => p.delegated);

  // Neu needs something to compare against: before the first "Gesehen" there
  // is nothing, and everything would otherwise be called new.
  const seen = snapshot.user?.seen_at ? new Set(snapshot.user.seen_keys) : null;
  const fresh =
    seen === null
      ? null
      : {
          tasks: [...open, ...unsettled].filter((t) => !seen.has(t.key)),
          delegated: delegated.filter((d) => !seen.has(d.key)),
        };

  const reads = snapshot.pages.map((p) => p.read_at).sort();

  return {
    projects,
    unread,
    open,
    unsettled,
    delegated,
    fresh,
    keys: [...new Set(keys)],
    counts: {
      heute: null,
      neu: fresh === null ? null : fresh.tasks.length + fresh.delegated.length,
      projekte: open.length,
      menschen: null,
      taetigkeiten: null,
      warten: delegated.length,
      fristen: null,
      zeitplan: null,
      klaeren: unsettled.length,
    },
    oldestRead: reads[0] ?? null,
    newestRead: reads.at(-1) ?? null,
    sectionsWithout: snapshot.notebooks.flatMap((n) =>
      n.sections_without.map((section) => ({ notebook: n.notebook, section })),
    ),
    sectionsSeveral: snapshot.notebooks.flatMap((n) =>
      n.sections_several.map((section) => ({ notebook: n.notebook, section })),
    ),
    notebookErrors: snapshot.notebooks
      .filter((n) => n.error !== null)
      .map((n) => ({ notebook: n.notebook, error: n.error as string, at: n.error_at })),
    neverRead: snapshot.notebooks.filter((n) => n.listed_at === null).map((n) => n.notebook),
    waiting: pending.filter((p) => !stored.has(p.page_id)),
  };
};

/** A time as Ruben reads it: Vienna, German. */
export const viennaTime = (iso: string): string =>
  new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

/** "Stand: …", one time when every page was read together, a span otherwise. */
export const standLine = (view: Pick<TaskView, 'oldestRead' | 'newestRead'>): string | null => {
  if (view.oldestRead === null || view.newestRead === null) return null;
  const oldest = viennaTime(view.oldestRead);
  const newest = viennaTime(view.newestRead);
  return oldest === newest ? `Stand: ${newest}` : `Stand: ${oldest} bis ${newest}`;
};

/** The link a task opens: the OneNote app where there is one, the web otherwise. */
export const pageLinks = (page: Pick<SnapshotPage, 'web_url' | 'client_url'>) => ({
  app: page.client_url,
  web: page.web_url,
});

/**
 * Offer a tick box on every open and unsettled task (0023), for a user who
 * holds `onenote-edit`. Ticking an unsettled task is how it is settled as
 * done. Handovers are already counted done, and a page that was not read has
 * no tasks to show. Marks the shared task objects in place, so every view
 * built from them — Neu, the date views, the Zeitplan — carries the box.
 */
export const allowTicks = (view: TaskView): void => {
  for (const group of view.projects) {
    for (const task of [...group.open, ...group.unsettled]) task.tickable = true;
  }
};
