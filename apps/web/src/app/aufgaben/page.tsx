import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { supabaseServer } from '@/lib/supabase/server';
import { buildTaskView, isViewId } from '@/lib/task-view-model';
import { readTaskView } from '@/lib/task-view';
import { markAllSeen } from './actions';
import { NotebookPicker } from './NotebookPicker';
import { RefreshControl } from './RefreshControl';
import { TaskScreen } from './TaskScreen';

/**
 * Ruben's tasks across projects, from the stored snapshot of the CL Aufgaben
 * pages (0020). A page load reads the snapshot and never OneNote: OneNote
 * allows 400 requests an hour, shared with the digest and the local install.
 * OneNote stays the record; nothing here can change it.
 */

// The refresh actions run on this page and read OneNote; a notebook can take
// most of a minute on hosted.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Aufgaben — artist-mcp',
};

type AufgabenProps = {
  searchParams: Promise<{ ansicht?: string }>;
};

const Aufgaben = async ({ searchParams }: AufgabenProps) => {
  const { ansicht } = await searchParams;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // Scoped by RLS to the signed-in user, as on the dashboard.
  const { data: connections } = await supabase.from('connections').select('provider');
  const microsoft = (connections ?? []).some((c) => c.provider === 'microsoft');

  if (!microsoft) {
    return (
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-4">
        <Typography as="h1" variant="pageTitle" color="yellow">
          Aufgaben
        </Typography>
        <Typography variant="small">
          Dafür muss Microsoft verbunden sein. Das geht auf der Kontoseite.
        </Typography>
      </main>
    );
  }

  const snapshot = await readTaskView(user.id);
  const chosen = snapshot.notebooks.map((n) => n.notebook);
  const view = buildTaskView(snapshot);
  const current = isViewId(ansicht) ? ansicht : 'projekte';

  const firstVisit =
    snapshot.pages.length === 0 && snapshot.notebooks.every((n) => n.listed_at === null);
  const picker = <NotebookPicker chosen={chosen} />;
  const intro = firstVisit ? (
    <div className="grid gap-3 border border-signal-yellow p-3">
      <Typography variant="small">
        Für diese Ansicht wird eine Kopie der Aufgaben auf deinen CL Aufgaben-Seiten gespeichert,
        verschlüsselt, bis zur nächsten Aktualisierung oder bis du Microsoft trennst. Gelesen wird
        nur, wenn du „Aktualisieren“ drückst, und nur die CL Aufgaben-Seiten der gewählten
        Notizbücher.
      </Typography>
      {picker}
    </div>
  ) : null;

  const seenControl = (
    <form action={markAllSeen}>
      <Button type="submit" variant="outline" className="min-h-11">
        Gesehen
      </Button>
    </form>
  );

  return (
    <TaskScreen
      view={view}
      current={current}
      refreshControl={<RefreshControl disabled={chosen.length === 0} />}
      seenControl={seenControl}
      intro={intro}
      settings={firstVisit ? null : picker}
    />
  );
};

export default Aufgaben;
