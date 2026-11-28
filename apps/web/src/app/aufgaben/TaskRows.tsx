import { type ReactNode } from 'react';

import { Typography } from '@/components/ui/Typography';
import { cn } from '@/lib/utils';
import { type ShownHandover, type ShownTask, type SnapshotPage } from '@/lib/task-view-model';
import { TickBox } from './TickBox';

/** The rows every view of the task screen is made of (0020). */

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
  /** Said before the task, such as its date on the Zeitplan. */
  lead?: ReactNode;
  id?: string;
};

const TaskRow = ({ task, standalone, lead, id }: TaskRowProps) => {
  const details = (
    <details className="group">
      <summary className={SUMMARY}>
        <Marker />
        <span className="grid gap-0.5">
          <Typography as="span" variant="small" className="text-base leading-snug">
            {lead}
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
  );
  return (
    <li id={id} className="scroll-mt-16 border-b border-foreground/15">
      {task.tickable ? (
        <TickBox taskKey={task.key} onenoteHref={task.page.client_url ?? task.page.web_url}>
          {details}
        </TickBox>
      ) : (
        details
      )}
    </li>
  );
};

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

export { Empty, HandoverRow, List, Marker, OneNoteLink, SUMMARY, TaskRow };
