import { Typography } from '@/components/ui/Typography';
import {
  byDue,
  byPerson,
  byResponsible,
  dueByToday,
  dueOn,
  germanDay,
  type PlacedTask,
  type Timeline,
} from '@/lib/task-timeline';
import { type ShownHandover, type ShownTask } from '@/lib/task-view-model';
import { Empty, HandoverRow, List, TaskRow } from './TaskRows';
import { NeedsRefresh } from './Zeitplan';

/**
 * Heute, Fristen and Menschen (0020), from the row's own cells. A row leads
 * with its date alone, kept short; the Frist cell as the page writes it is in
 * the row when it is opened. A date is read only to order the list.
 */

type FristLeadProps = {
  item: PlacedTask;
  today: string;
};

const FristLead = ({ item, today }: FristLeadProps) => {
  const past = dueOn(item) < today;
  return (
    <Typography as="span" variant="small" color={past ? 'red' : 'cyan'} className="font-bold">
      {past ? 'vorbei · ' : ''}
      {germanDay(dueOn(item))}
      {item.rule ? ' · gerechnet' : ''}{' '}
    </Typography>
  );
};

type DatedListProps = {
  items: PlacedTask[];
  today: string;
};

const DatedList = ({ items, today }: DatedListProps) => (
  <List>
    {items.map((item) => (
      <TaskRow
        key={item.task.key}
        task={item.task}
        standalone
        lead={<FristLead item={item} today={today} />}
      />
    ))}
  </List>
);

type HeuteProps = {
  timeline: Timeline;
};

const Heute = ({ timeline }: HeuteProps) => {
  if (!timeline.available) return <NeedsRefresh />;
  const due = dueByToday(timeline);
  return (
    <>
      <Typography variant="small" color="muted">
        Frist heute oder vorbei, laut Seite. Dringende ohne Datum darunter.
      </Typography>
      {due.length === 0 ? (
        <Empty>Nichts mit Frist bis heute.</Empty>
      ) : (
        <DatedList items={due} today={timeline.today} />
      )}
      {timeline.urgent.length > 0 ? (
        <>
          <Typography as="h2" variant="label" color="yellow" className="mt-4">
            Dringend, ohne Datum ({timeline.urgent.length})
          </Typography>
          <List>
            {timeline.urgent.map((t) => (
              <TaskRow key={t.key} task={t} standalone />
            ))}
          </List>
        </>
      ) : null}
    </>
  );
};

type FristenProps = {
  timeline: Timeline;
};

const Fristen = ({ timeline }: FristenProps) => {
  if (!timeline.available) return <NeedsRefresh />;
  const dated = byDue(timeline);
  return (
    <>
      <Typography variant="small" color="muted">
        Nach Datum, wie die Seite es schreibt.
      </Typography>
      {dated.length === 0 ? (
        <Empty>Keine Frist mit Datum.</Empty>
      ) : (
        <DatedList items={dated} today={timeline.today} />
      )}
      {timeline.unclear.length > 0 ? (
        <>
          <Typography as="h2" variant="label" color="muted" className="mt-4">
            Frist ohne eindeutiges Datum ({timeline.unclear.length})
          </Typography>
          <List>
            {timeline.unclear.map(({ task, cell }) => (
              <TaskRow
                key={task.key}
                task={task}
                standalone
                lead={
                  <Typography as="span" variant="small" color="muted">
                    {cell}:{' '}
                  </Typography>
                }
              />
            ))}
          </List>
        </>
      ) : null}
      <Typography variant="small" color="muted" className="mt-4">
        Ohne Frist: {timeline.urgent.length + timeline.undated.length}, im Zeitplan aufgelistet.
      </Typography>
    </>
  );
};

type MenschenProps = {
  open: ShownTask[];
  delegated: ShownHandover[];
  available: boolean;
};

const Menschen = ({ open, delegated, available }: MenschenProps) => {
  if (!available) return <NeedsRefresh />;
  const { groups, without } = byResponsible(open);
  const handedTo = byPerson(delegated.map((h) => ({ name: h.to, item: h })));
  return (
    <>
      <Typography variant="small" color="muted">
        Verantwortlich laut Seite.
        {without > 0 ? ` ${without} ohne diese Spalte.` : ''}
      </Typography>
      {groups.length === 0 ? <Empty>Keine Spalte „Verantwortlich“ gefunden.</Empty> : null}
      {groups.map((g) => (
        <details key={g.who} className="group/person border-b border-foreground/15">
          <summary className="flex min-h-11 cursor-pointer list-none items-baseline justify-between gap-3 py-2 [&::-webkit-details-marker]:hidden">
            <Typography as="span" variant="label" color="yellow" className="text-base">
              {g.who}
            </Typography>
            <Typography as="span" variant="small">
              {g.tasks.length} offen
            </Typography>
          </summary>
          <List>
            {g.tasks.map((t) => (
              <TaskRow key={t.key} task={t} standalone />
            ))}
          </List>
        </details>
      ))}
      {handedTo.length > 0 ? (
        <>
          <Typography as="h2" variant="label" color="muted" className="mt-4">
            Übergeben an
          </Typography>
          {handedTo.map(({ who, items }) => (
            <div key={who} className="mt-2">
              <Typography variant="small" color="cyan">
                {who} ({items.length})
              </Typography>
              <List>
                {items.map((h) => (
                  <HandoverRow key={h.key} handover={h} />
                ))}
              </List>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
};

export { Fristen, Heute, Menschen };
