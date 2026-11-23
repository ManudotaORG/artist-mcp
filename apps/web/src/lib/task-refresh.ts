/**
 * One notebook's CL Aufgaben pages, read through the dispatcher (0020).
 *
 * Takes the dispatcher's `call` rather than building one, so the hosted refresh
 * hands in a dispatcher bound to one user — their tokens, their pacing key,
 * their read budget — and the tests hand in a stub. Reads only: nothing here
 * names a write operation, and the dispatcher's operation table is what would
 * refuse one if it did.
 *
 * Which page is a section's CL Aufgaben page is decided by `pickTaskPages`, the
 * same rule `map_notes` uses in tasks mode, and what a task on it is by
 * `pageTasks`, inside the `map_notes` operation. Neither is restated here.
 *
 * No `@/` imports, so the node tests in `scripts/` run this directly.
 */
import type { PageTasks } from '@manudota/artist-mcp/tasks';
import { pickTaskPages } from '@manudota/artist-mcp/task-pages';

type Call = <T>(
  op: 'list_notebooks' | 'list_notes' | 'map_notes',
  params?: Record<string, unknown>,
) => Promise<T>;

type Section = { id: string; displayName?: string; parentNotebook?: { displayName?: string } };
type Listed = {
  notes: {
    id: string;
    title: string;
    section: string | null;
    notebook: string | null;
    web_url?: string;
    client_url?: string;
  }[];
  sections: { name: string; notebook: string | null }[];
};
type Read = {
  read: { page: { id: string }; tasks: PageTasks | null; error: string | null }[];
  not_reached: { id: string }[];
};

/** A CL Aufgaben page the listing chose, to be read. No task text. */
export type PendingPage = {
  page_id: string;
  section: string;
  title: string;
  web_url: string | null;
  client_url: string | null;
};

export type NotebookListing = {
  /** Every section the notebook has now. Pages of any other are dropped. */
  sections: string[];
  /** The sections this listing covered: their CL Aufgaben pages are re-read. */
  changed: string[];
  pending: PendingPage[];
  without: string[];
  several: string[];
};

/** How far before the previous listing `since` reaches back, against clock skew. */
export const SINCE_OVERLAP_MS = 10 * 60 * 1000;

const same = (a: string | null | undefined, b: string) =>
  (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Step one for a notebook: its sections, and the CL Aufgaben page in each that
 * changed (all of them without `since`). Reads no page.
 *
 * Separate from reading because one function cannot always do both: on
 * 2026-11-23 a throttled listing of 2026-27 took 22 s, and the pages read in the
 * same request were given 5.
 */
export const listNotebookTasks = async (
  call: Call,
  notebook: string,
  { since }: { since?: string } = {},
): Promise<NotebookListing> => {
  const listing = await call<{ notebooks: { name: string }[]; section_list: Section[] }>(
    'list_notebooks',
    { notebook },
  );
  if (!listing.notebooks.some((n) => same(n.name, notebook))) {
    throw new Error(`Das Notizbuch „${notebook}“ gibt es in OneNote nicht (mehr).`);
  }
  const own = listing.section_list.filter((s) => same(s.parentNotebook?.displayName, notebook));
  const sections = [...new Set(own.map((s) => s.displayName ?? '(unnamed section)'))];

  const listed = await call<Listed>('list_notes', {
    notebook,
    sections: listing.section_list,
    ...(since === undefined ? {} : { since }),
  });
  const { toRead, without, several } = pickTaskPages(listed.sections, listed.notes);

  return {
    sections,
    changed: listed.sections.map((s) => s.name),
    pending: toRead.map((page) => ({
      page_id: page.id,
      section: page.section ?? '(unnamed section)',
      title: page.title,
      web_url: page.web_url ?? null,
      client_url: page.client_url ?? null,
    })),
    without: without.map((s) => s.name),
    several: several.map(({ sec }) => sec.name),
  };
};

/**
 * Step two, as often as it takes: read pending pages, by `map_notes` in tasks
 * mode, within a deadline. Pages it does not reach stay pending for the next
 * request; nothing is dropped.
 */
export const readTaskPages = async (
  call: Call,
  notebook: string,
  pending: readonly PendingPage[],
  { deadlineMs }: { deadlineMs: number },
): Promise<{
  pages: { page_id: string; tasks: PageTasks | null; error: string | null }[];
  left: number;
}> => {
  if (pending.length === 0) return { pages: [], left: 0 };
  const read = await call<Read>('map_notes', {
    pages: pending.map((p) => ({
      id: p.page_id,
      title: p.title,
      section: p.section,
      notebook,
      last_modified: null,
    })),
    tasks: true,
    deadline_ms: deadlineMs,
  });
  return {
    pages: read.read.map(({ page, tasks, error }) => ({ page_id: page.id, tasks, error })),
    left: read.not_reached.length,
  };
};
