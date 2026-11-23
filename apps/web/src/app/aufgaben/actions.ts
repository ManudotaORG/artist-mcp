'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { buildTaskView } from '@/lib/task-view-model';
import {
  chooseNotebooks,
  claimRefresh,
  listNotebookNames,
  markSeen,
  listNotebook,
  readPending,
  readTaskView,
  type Claim,
} from '@/lib/task-view';

/**
 * The task view's actions (0020). Each is reachable by a direct POST, so each
 * resolves the user from the signed-in session itself, and none takes a user
 * id. None writes to OneNote, Gmail or Calendar: they read OneNote and write
 * only this user's own snapshot.
 */
const signedIn = async (): Promise<string> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return user.id;
};

export const loadNotebooks = async (): Promise<{ names: string[] } | { error: string }> => {
  const userId = await signedIn();
  try {
    return { names: await listNotebookNames(userId) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

export const saveNotebooks = async (formData: FormData) => {
  const userId = await signedIn();
  const names = formData
    .getAll('notebook')
    .map((n) => String(n).trim())
    .filter((n) => n !== '');
  await chooseNotebooks(userId, [...new Set(names)].slice(0, 10));
  revalidatePath('/aufgaben');
  redirect('/aufgaben');
};

export const startRefresh = async (
  full: boolean,
): Promise<{ claim: Claim; notebooks: string[] }> => {
  const userId = await signedIn();
  const claim = await claimRefresh(userId, full);
  const notebooks = claim.ok ? (await readTaskView(userId)).notebooks.map((n) => n.notebook) : [];
  return { claim, notebooks };
};

/** Step one of a notebook: list it. Once per refresh. */
export const listOneNotebook = async (notebook: string, startedAt: string) => {
  const userId = await signedIn();
  return listNotebook(userId, String(notebook), String(startedAt));
};

/** Step two, while pages are left: read what the listing left pending. */
export const readOneNotebook = async (notebook: string, startedAt: string) => {
  const userId = await signedIn();
  return readPending(userId, String(notebook), String(startedAt));
};

export const finishRefresh = async () => {
  await signedIn();
  revalidatePath('/aufgaben');
};

/** "Gesehen": the keys are taken from the snapshot here, never from the form. */
export const markAllSeen = async () => {
  const userId = await signedIn();
  const view = buildTaskView(await readTaskView(userId));
  await markSeen(userId, view.keys);
  revalidatePath('/aufgaben');
};
