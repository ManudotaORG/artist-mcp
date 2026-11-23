import 'server-only';

import { dispatchWith } from '@manudota/artist-mcp/dispatch';
import { hostedTokens } from '@/lib/hosted-tokens';
import { hostedAudit } from '@/lib/write-audit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SINCE_OVERLAP_MS, listNotebookTasks, readTaskPages } from '@/lib/task-refresh';
import type { Snapshot } from '@/lib/task-view-model';

/**
 * The hosted task view's store and refresh (0020).
 *
 * Every function takes the user id from its caller, which takes it from the
 * signed-in session — never from a form. The snapshot is read and written only
 * through service-role functions, the task text encrypted with the same key the
 * tokens are, so a dump of the database yields none of it.
 */

/** Under sixty, by enough to store what was read. As the MCP route's budget. */
const READ_BUDGET_MS = 50_000;
/** What one request's page reads may take; the rest are read by the next. */
const NOTEBOOK_DEADLINE_MS = 40_000;

const key = (): string => {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error('TOKEN_ENCRYPTION_KEY is not set on this deployment.');
  return value;
};

export const readTaskView = async (userId: string): Promise<Snapshot> => {
  const { data, error } = await supabaseAdmin().rpc('task_view_for', {
    p_user_id: userId,
    p_key: key(),
  });
  if (error) throw new Error(`Die Aufgabenansicht konnte nicht gelesen werden: ${error.message}`);
  return data as Snapshot;
};

export const chooseNotebooks = async (userId: string, notebooks: string[]): Promise<void> => {
  const { error } = await supabaseAdmin().rpc('set_task_view_notebooks', {
    p_user_id: userId,
    p_notebooks: notebooks,
  });
  if (error) throw new Error(error.message);
};

/** The notebook names on the account, for choosing. One listing, on a button press. */
export const listNotebookNames = async (userId: string): Promise<string[]> => {
  const call = dispatchWith(hostedTokens(userId), hostedAudit(userId), {
    paceKey: userId,
    budgetMs: READ_BUDGET_MS,
  });
  const { notebooks } = await call<{ notebooks: { name: string }[] }>('list_notebooks');
  return notebooks.map((n) => n.name);
};

export type Claim =
  | { ok: true; started_at: string; full: boolean }
  | { ok: false; reason: 'cooldown' | 'full_cooldown' | 'no_view'; next_at?: string };

export const claimRefresh = async (userId: string, full: boolean): Promise<Claim> => {
  const { data, error } = await supabaseAdmin().rpc('claim_task_refresh', {
    p_user_id: userId,
    p_full: full,
  });
  if (error) throw new Error(error.message);
  return data as Claim;
};

type Step = { ok: true; pages: number; left: number } | { ok: false; error: string };

/**
 * The claimed refresh and the notebook's row, or why there is none. The
 * database checks the claim again when storing; it is checked here first so a
 * stale or forged refresh spends no OneNote requests.
 */
const claimedNotebook = async (userId: string, notebook: string, startedAt: string) => {
  const snapshot = await readTaskView(userId);
  const claimed = snapshot.user;
  if (
    claimed === null ||
    claimed.refresh_started_at === null ||
    Date.parse(claimed.refresh_started_at) !== Date.parse(startedAt)
  ) {
    return {
      found: false,
      error: 'Diese Aktualisierung läuft nicht mehr. Bitte neu starten.',
    } as const;
  }
  const row = snapshot.notebooks.find((n) => n.notebook === notebook);
  if (row === undefined)
    return { found: false, error: `„${notebook}“ ist nicht in der Ansicht.` } as const;
  return {
    found: true,
    claimed: { ...claimed, refresh_started_at: claimed.refresh_started_at },
    row,
  } as const;
};

const dispatcherFor = (userId: string) =>
  dispatchWith(hostedTokens(userId), hostedAudit(userId), {
    paceKey: userId,
    budgetMs: READ_BUDGET_MS,
  });

const failed = async (
  userId: string,
  startedAt: string,
  notebook: string,
  err: unknown,
  t0: number,
) => {
  const message = err instanceof Error ? err.message : String(err);
  await supabaseAdmin().rpc('fail_task_notebook', {
    p_user_id: userId,
    p_started_at: startedAt,
    p_notebook: notebook,
    p_error: message,
  });
  console.warn(
    `[artist-mcp] task view notebook failed elapsed=${Date.now() - t0}ms failed=${message}`,
  );
  return { ok: false, error: message } as const;
};

/**
 * Step one of a notebook, once per refresh: list it and store which CL Aufgaben
 * pages are to be read. Narrowed with `since` unless the claim is a full one: a
 * section dated before the notebook's last listing holds no page that changed
 * since, so its stored pages stay as they are, each with its own read time.
 */
export const listNotebook = async (
  userId: string,
  notebook: string,
  startedAt: string,
): Promise<Step> => {
  const found = await claimedNotebook(userId, notebook, startedAt);
  if (!found.found) return { ok: false, error: found.error };
  const { claimed, row } = found;
  const since =
    claimed.refresh_full || row.listed_at === null
      ? undefined
      : new Date(Date.parse(row.listed_at) - SINCE_OVERLAP_MS).toISOString();
  const t0 = Date.now();
  const listedAt = new Date(t0).toISOString();
  try {
    const listing = await listNotebookTasks(dispatcherFor(userId), notebook, { since });
    const { error } = await supabaseAdmin().rpc('store_task_listing', {
      p_user_id: userId,
      p_started_at: claimed.refresh_started_at,
      p_notebook: notebook,
      p_listed_at: listedAt,
      p_sections: listing.sections,
      p_changed: listing.changed,
      p_pending: listing.pending,
      p_without: listing.without,
      p_several: listing.several,
    });
    if (error) throw new Error(error.message);
    console.warn(
      `[artist-mcp] task view listed mode=${since === undefined ? 'full' : 'since'} ` +
        `sections=${listing.sections.length} listed=${listing.changed.length} ` +
        `pending=${listing.pending.length} elapsed=${Date.now() - t0}ms`,
    );
    return { ok: true, pages: 0, left: listing.pending.length };
  } catch (err) {
    return failed(userId, claimed.refresh_started_at, notebook, err, t0);
  }
};

/**
 * Step two, repeated while pages are left: read what the listing left pending
 * and store it. Only the page ids the listing chose are accepted by the store,
 * with the listing's titles and links, so nothing the browser sends can put
 * another page into the snapshot.
 */
export const readPending = async (
  userId: string,
  notebook: string,
  startedAt: string,
): Promise<Step> => {
  const found = await claimedNotebook(userId, notebook, startedAt);
  if (!found.found) return { ok: false, error: found.error };
  const { claimed, row } = found;
  const t0 = Date.now();
  try {
    const { pages, left } = await readTaskPages(dispatcherFor(userId), notebook, row.pending, {
      deadlineMs: NOTEBOOK_DEADLINE_MS,
    });
    const { data, error } = await supabaseAdmin().rpc('store_task_pages', {
      p_user_id: userId,
      p_key: key(),
      p_started_at: claimed.refresh_started_at,
      p_notebook: notebook,
      p_pages: pages,
    });
    if (error) throw new Error(error.message);
    console.warn(
      `[artist-mcp] task view read pages=${pages.length} stored=${data} left=${left} elapsed=${Date.now() - t0}ms`,
    );
    return { ok: true, pages: pages.length, left };
  } catch (err) {
    return failed(userId, claimed.refresh_started_at, notebook, err, t0);
  }
};

export const markSeen = async (userId: string, keys: string[]): Promise<void> => {
  const { error } = await supabaseAdmin().rpc('mark_task_view_seen', {
    p_user_id: userId,
    p_keys: keys,
  });
  if (error) throw new Error(error.message);
};
