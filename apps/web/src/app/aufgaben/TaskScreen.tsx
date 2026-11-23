import Link from 'next/link';
import { type ReactNode } from 'react';

import { Typography } from '@/components/ui/Typography';
import { cn } from '@/lib/utils';
import { CurrentTabIntoView } from './CurrentTabIntoView';
import { Empty, HandoverRow, List, Marker, OneNoteLink, SUMMARY, TaskRow } from './TaskRows';
import { Fristen, Heute, Menschen } from './DateViews';
import { Zeitplan } from './Zeitplan';
import { dueByToday, type Timeline } from '@/lib/task-timeline';
import {
  VIEWS,
  WAITING,
  standLine,
  viennaTime,
  type ProjectGroup,
  type TaskView,
  type ViewId,
} from '@/lib/task-view-model';

/**
 * The task view itself, from a built snapshot (0020). A server component with
 * no state of its own: the refresh, "Gesehen" and notebook controls are passed
 * in, so the same screen renders signed in and in the local preview.
 *
 * Phone first and compact: one line per task that opens on a tap to show the
 * rest of its row, projects that open the same way, the views as a row of
 * tabs that scrolls sideways. Everything that explains rather than lists sits
 * at the bottom, except a warning that something was not read, which stays at
 * the top because it changes what the list means. Marks are said in words,
 * never by colour alone. Open and closed is the browser's own `<details>`, so
 * none of it needs script.
 */

type ProjectSectionProps = {
  group: ProjectGroup;
};

const ProjectSection = ({ group }: ProjectSectionProps) => {
  const tasks = [...group.unsettled, ...group.open];
  return (
    <details className="group/project border-b border-foreground/15">
      <summary className={SUMMARY}>
        <Marker className="group-open/project:rotate-90" />
        <span className="flex flex-1 items-baseline justify-between gap-3">
          <Typography as="span" variant="label" color="yellow" className="text-base leading-snug">
            {group.page.section}
          </Typography>
          <Typography as="span" variant="small" className="shrink-0 whitespace-nowrap">
            {group.open.length} offen
            {group.unsettled.length > 0 ? ` · ${group.unsettled.length} zu klären` : ''}
          </Typography>
        </span>
      </summary>
      <div className="grid gap-1 pb-4 pl-6">
        <Typography variant="small" color="muted">
          {group.page.notebook} · {group.done} erledigt
          {group.delegated.length > 0 ? ` · ${group.delegated.length} übergeben` : ''} · gelesen{' '}
          {viennaTime(group.page.read_at)}
        </Typography>
        {group.notReached ? (
          <Typography variant="small" color="yellow">
            Bei der letzten Aktualisierung nicht erreicht. Das ist der Stand vom{' '}
            {viennaTime(group.page.read_at)}.
          </Typography>
        ) : null}
        {group.problems.map((problem) => (
          <Typography key={problem} variant="small" color="yellow">
            Hinweis zur Seite: {problem}
          </Typography>
        ))}
        <OneNoteLink page={group.page} />
        {tasks.length === 0 ? (
          <Empty>Keine offenen Aufgaben auf dieser Seite.</Empty>
        ) : (
          <List>
            {tasks.map((task) => (
              <TaskRow key={task.key} task={task} standalone={false} />
            ))}
          </List>
        )}
      </div>
    </details>
  );
};

type WarningsProps = {
  view: TaskView;
};

/** Only what changes what the list means: something was not read. */
const Warnings = ({ view }: WarningsProps) => (
  <>
    {view.notebookErrors.map((e) => (
      <Typography key={e.notebook} variant="small" color="red">
        {e.notebook}: zuletzt nicht gelesen{e.at ? ` (${viennaTime(e.at)})` : ''}, {e.error}.
        Angezeigt wird der ältere Stand.
      </Typography>
    ))}
    {view.neverRead.length > 0 ? (
      <Typography variant="small" color="yellow">
        Noch nie gelesen: {view.neverRead.join(', ')}.
      </Typography>
    ) : null}
    {view.waiting.length > 0 ? (
      <Typography variant="small" color="yellow">
        Gefunden, aber noch nicht gelesen: {view.waiting.map((p) => p.section).join(', ')}. Nochmal
        aktualisieren.
      </Typography>
    ) : null}
    {view.unread.length > 0 ? (
      <Typography variant="small" color="yellow">
        Nicht lesbar, Aufgaben unbekannt:{' '}
        {view.unread.map((p) => `${p.section} (${p.error ?? 'Fehler'})`).join('; ')}.
      </Typography>
    ) : null}
  </>
);

type TabsProps = {
  view: TaskView;
  current: ViewId;
  timeline: Timeline;
};

const Tabs = ({ view, current, timeline }: TabsProps) => (
  <nav
    aria-label="Ansichten"
    className="sticky top-0 z-10 -mx-4 overflow-x-auto bg-background px-4 py-2 sm:mx-0 sm:px-0"
  >
    <ul className="flex gap-2">
      {VIEWS.map(({ id, label }) => {
        const count = !timeline.available
          ? view.counts[id]
          : id === 'zeitplan' || id === 'fristen'
            ? timeline.placed.length
            : id === 'heute'
              ? dueByToday(timeline).length + timeline.urgent.length
              : view.counts[id];
        return (
          <li key={id} className="shrink-0">
            <Link
              href={`?ansicht=${id}`}
              aria-current={id === current ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center gap-1 border px-3 font-mono text-sm font-bold whitespace-nowrap',
                id === current
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-signal-cyan text-signal-cyan',
              )}
            >
              {label}
              {count === null ? null : (
                <Typography as="span" variant="small" className="font-normal text-current">
                  ({count})
                </Typography>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
    <CurrentTabIntoView current={current} />
  </nav>
);

type BodyProps = {
  view: TaskView;
  current: ViewId;
  timeline: Timeline;
  seenControl: ReactNode;
};

const Body = ({ view, current, timeline, seenControl }: BodyProps) => {
  if (current === 'zeitplan') return <Zeitplan timeline={timeline} />;
  if (current === 'heute') return <Heute timeline={timeline} />;
  if (current === 'fristen') return <Fristen timeline={timeline} />;
  if (current === 'menschen') {
    return <Menschen open={view.open} delegated={view.delegated} available={timeline.available} />;
  }

  const waiting = WAITING[current];
  if (waiting !== undefined) {
    return (
      <div className="border border-signal-yellow p-3">
        <Typography variant="label" color="yellow">
          Noch nicht verfügbar
        </Typography>
        <Typography variant="small" className="mt-2">
          {waiting}
        </Typography>
      </div>
    );
  }

  if (current === 'projekte') {
    return view.projects.length === 0 ? (
      <Empty>Keine CL Aufgaben-Seite gelesen.</Empty>
    ) : (
      <div className="border-t border-foreground/15">
        {view.projects.map((group) => (
          <ProjectSection key={group.page.page_id} group={group} />
        ))}
      </div>
    );
  }

  if (current === 'warten') {
    return (
      <>
        <Typography variant="small" color="muted">
          Zählen für dich als erledigt.
        </Typography>
        {view.delegated.length === 0 ? (
          <Empty>Keine übergebenen Aufgaben vermerkt.</Empty>
        ) : (
          <List>
            {view.delegated.map((h) => (
              <HandoverRow key={h.key} handover={h} />
            ))}
          </List>
        )}
      </>
    );
  }

  if (current === 'klaeren') {
    return (
      <>
        <Typography variant="small" color="muted">
          Offen markiert, aber die Zeile sagt etwas anderes. Stehen in keiner anderen Liste.
        </Typography>
        {view.unsettled.length === 0 ? (
          <Empty>Nichts zu klären.</Empty>
        ) : (
          <List>
            {view.unsettled.map((t) => (
              <TaskRow key={t.key} task={t} standalone />
            ))}
          </List>
        )}
      </>
    );
  }

  // Neu
  return (
    <>
      <Typography variant="small" color="muted">
        Seit du zuletzt „Gesehen“ gedrückt hast.
      </Typography>
      {view.fresh === null ? (
        <Empty>
          Noch kein Vergleich möglich. Drück „Gesehen“, dann zeigt Neu ab jetzt, was dazukommt.
        </Empty>
      ) : view.fresh.tasks.length + view.fresh.delegated.length === 0 ? (
        <Empty>Nichts Neues.</Empty>
      ) : (
        <List>
          {view.fresh.tasks.map((t) => (
            <TaskRow key={t.key} task={t} standalone />
          ))}
          {view.fresh.delegated.map((h) => (
            <HandoverRow key={h.key} handover={h} />
          ))}
        </List>
      )}
      <div className="mt-4">{seenControl}</div>
    </>
  );
};

type TaskScreenProps = {
  view: TaskView;
  timeline: Timeline;
  current: ViewId;
  refreshControl: ReactNode;
  seenControl: ReactNode;
  /** Shown under the header: the first visit's explanation and notebook choice. */
  intro?: ReactNode;
  /** The notebook choice, at the bottom once made. */
  settings?: ReactNode;
};

const TaskScreen = ({
  view,
  timeline,
  current,
  refreshControl,
  seenControl,
  intro,
  settings,
}: TaskScreenProps) => {
  const stand = standLine(view);
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-3 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Typography as="h1" variant="pageTitle" color="yellow">
          Aufgaben
        </Typography>
        <Link href="/" className="font-mono text-sm text-signal-cyan underline underline-offset-4">
          Konto
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography variant="small" color="cyan">
          {stand ?? 'Noch nicht gelesen'}
        </Typography>
        {refreshControl}
      </div>
      {intro}
      <Warnings view={view} />
      <Tabs view={view} current={current} timeline={timeline} />
      <Body view={view} current={current} timeline={timeline} seenControl={seenControl} />
      <section className="mt-6 grid gap-2 border-t border-foreground/30 pt-4">
        <Typography as="h2" variant="label" color="muted">
          Hinweise
        </Typography>
        <Typography variant="small" color="muted">
          Zeigt, was auf den CL Aufgaben-Seiten steht. Aufgaben auf anderen Seiten fehlen, bis der
          Digest sie überträgt. Hier wird nichts geändert: Abhaken und Bearbeiten passiert in
          OneNote.
        </Typography>
        {view.sectionsWithout.length > 0 ? (
          <Typography variant="small" color="muted">
            Ohne CL Aufgaben-Seite, daher nicht gelesen:{' '}
            {view.sectionsWithout.map((s) => `${s.section} (${s.notebook})`).join(', ')}.
          </Typography>
        ) : null}
        {view.sectionsSeveral.length > 0 ? (
          <Typography variant="small" color="muted">
            Mit mehreren CL Aufgaben-Seiten, daher keine gelesen:{' '}
            {view.sectionsSeveral.map((s) => `${s.section} (${s.notebook})`).join(', ')}.
          </Typography>
        ) : null}
        <Typography variant="small" color="muted">
          Eine Kopie der Aufgaben wird verschlüsselt gespeichert, bis zur nächsten Aktualisierung
          oder bis du Microsoft trennst.
        </Typography>
        {settings}
      </section>
    </main>
  );
};

export { TaskScreen };
