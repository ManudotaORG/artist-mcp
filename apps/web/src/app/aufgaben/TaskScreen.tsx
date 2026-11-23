import Link from 'next/link';
import { type ReactNode } from 'react';

import { Typography } from '@/components/ui/Typography';
import { cn } from '@/lib/utils';
import { CurrentTabIntoView } from './CurrentTabIntoView';
import {
  VIEWS,
  WAITING,
  standLine,
  viennaTime,
  type ProjectGroup,
  type ShownHandover,
  type ShownTask,
  type SnapshotPage,
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

const SUMMARY =
  'flex min-h-11 cursor-pointer list-none items-start gap-2 py-2 [&::-webkit-details-marker]:hidden';

type MarkerProps = {
  className?: string;
};

/** The ▸ that turns when its `<details>` (marked `group`) opens. */
const Marker = ({ className }: MarkerProps) => (
  <Typography
    as="span"
    variant="small"
    color="cyan"
    className={cn(
      'mt-0.5 inline-block shrink-0 transition-transform group-open:rotate-90',
      className,
    )}
  >
    ▸
  </Typography>
);

type OneNoteLinkProps = {
  page: SnapshotPage;
};

const OneNoteLink = ({ page }: OneNoteLinkProps) => {
  const href = page.client_url ?? page.web_url;
  if (href === null) {
    return (
      <Typography variant="small" color="muted">
        Kein Link zur Seite gespeichert. Nach der nächsten Aktualisierung ist er da.
      </Typography>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-4">
      <a
        href={href}
        className="inline-flex min-h-11 items-center font-mono text-sm font-bold text-signal-cyan underline underline-offset-4"
      >
        In OneNote öffnen
      </a>
      {page.client_url !== null && page.web_url !== null ? (
        <a
          href={page.web_url}
          className="inline-flex min-h-11 items-center font-mono text-sm text-muted-foreground underline underline-offset-4"
        >
          im Browser
        </a>
      ) : null}
    </div>
  );
};

type TaskRowProps = {
  task: ShownTask;
  /** Outside Projekte a row names its project and carries the link itself. */
  standalone: boolean;
};

const TaskRow = ({ task, standalone }: TaskRowProps) => (
  <li className="border-b border-foreground/15">
    <details className="group">
      <summary className={SUMMARY}>
        <Marker />
        <span className="grid gap-0.5">
          <Typography as="span" variant="small" className="text-base leading-snug">
            {task.unsettled !== null ? (
              <Typography as="span" variant="small" color="yellow" className="font-bold">
                Zu klären:{' '}
              </Typography>
            ) : null}
            {task.text}
          </Typography>
          {standalone ? (
            <Typography as="span" variant="small" color="cyan">
              {task.page.section}
            </Typography>
          ) : null}
        </span>
      </summary>
      <div className="grid gap-1 pb-3 pl-6">
        {task.details !== null ? (
          <Typography variant="small" color="muted" className="break-words">
            {task.details}
          </Typography>
        ) : null}
        {task.unsettled !== null ? (
          <Typography variant="small">
            Der Haken steht offen, die Zeile sagt „{task.unsettled}“. Weder offen noch erledigt, bis
            du es auf der Seite klärst.
          </Typography>
        ) : null}
        {task.stale_status !== null ? (
          <Typography variant="small">
            Die Status-Zelle sagt {task.stale_status}, der Haken ist offen. Es gilt der Haken.
          </Typography>
        ) : null}
        {standalone ? <OneNoteLink page={task.page} /> : null}
      </div>
    </details>
  </li>
);

type HandoverRowProps = {
  handover: ShownHandover;
};

const HandoverRow = ({ handover }: HandoverRowProps) => (
  <li className="border-b border-foreground/15">
    <details className="group">
      <summary className={SUMMARY}>
        <Marker />
        <span className="grid gap-0.5">
          <Typography as="span" variant="small" className="text-base leading-snug">
            {handover.text}
          </Typography>
          <Typography as="span" variant="small" color="cyan">
            {handover.from === 'table' ? `bei ${handover.to}` : 'übergeben'} ·{' '}
            {handover.page.section}
          </Typography>
        </span>
      </summary>
      <div className="grid gap-1 pb-3 pl-6">
        <Typography variant="small" color="muted">
          {handover.from === 'table' ? `An ${handover.to}` : 'Übergeben, laut abgehaktem Eintrag'}
          {handover.on !== null ? `, ${handover.on}` : ''}
          {handover.reply !== null
            ? ` · Rückmeldung: ${handover.reply}`
            : handover.from === 'table'
              ? ' · keine Rückmeldung vermerkt'
              : ''}
        </Typography>
        <OneNoteLink page={handover.page} />
      </div>
    </details>
  </li>
);

type ListProps = {
  children: ReactNode;
};

const List = ({ children }: ListProps) => (
  <ul className="mt-2 border-t border-foreground/15">{children}</ul>
);

type EmptyProps = {
  children: ReactNode;
};

const Empty = ({ children }: EmptyProps) => (
  <Typography variant="small" color="muted" className="mt-3">
    {children}
  </Typography>
);

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
};

const Tabs = ({ view, current }: TabsProps) => (
  <nav
    aria-label="Ansichten"
    className="sticky top-0 z-10 -mx-4 overflow-x-auto bg-background px-4 py-2 sm:mx-0 sm:px-0"
  >
    <ul className="flex gap-2">
      {VIEWS.map(({ id, label }) => {
        const count = view.counts[id];
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
  seenControl: ReactNode;
};

const Body = ({ view, current, seenControl }: BodyProps) => {
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
      <Tabs view={view} current={current} />
      <Body view={view} current={current} seenControl={seenControl} />
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
