import { readFile } from 'node:fs/promises';
import { notFound } from 'next/navigation';

import { Typography } from '@/components/ui/Typography';
import { buildTimeline, viennaToday } from '@/lib/task-timeline';
import { buildTaskView, isViewId, type Snapshot } from '@/lib/task-view-model';
import { TaskScreen } from '../TaskScreen';

/**
 * The task view rendered from a snapshot file, for checking the layout on a
 * developer's machine without a database. Development only, and only when
 * `TASK_VIEW_PREVIEW_FILE` names a file: everywhere else it is a 404. Nothing
 * here reads OneNote or any account.
 */

export const dynamic = 'force-dynamic';

type VorschauProps = {
  searchParams: Promise<{ ansicht?: string }>;
};

const Vorschau = async ({ searchParams }: VorschauProps) => {
  const file = process.env.TASK_VIEW_PREVIEW_FILE;
  if (process.env.NODE_ENV !== 'development' || !file) notFound();
  const { ansicht } = await searchParams;
  const snapshot = JSON.parse(await readFile(file, 'utf8')) as Snapshot;
  const view = buildTaskView(snapshot);
  const timeline = buildTimeline(view.open, viennaToday());
  const note = (
    <Typography variant="small" color="yellow">
      Vorschau aus einer Datei, ohne Konto. Aktualisieren ist hier aus.
    </Typography>
  );
  return (
    <TaskScreen
      timeline={timeline}
      view={view}
      current={isViewId(ansicht) ? ansicht : 'projekte'}
      refreshControl={note}
      seenControl={note}
    />
  );
};

export default Vorschau;
