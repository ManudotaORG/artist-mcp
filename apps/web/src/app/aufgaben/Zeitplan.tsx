import { Typography } from '@/components/ui/Typography';
import {
  addDays,
  daysBetween,
  germanDay,
  lanes,
  type Day,
  type PlacedTask,
  type Timeline,
} from '@/lib/task-timeline';
import { cn } from '@/lib/utils';
import { Empty, List, TaskRow } from './TaskRows';

/**
 * The Zeitplan (0021): one row per project, weeks scrolling sideways under a
 * project column that stays put, then the same tasks as a list by date. A
 * marker is a link to its line in the list, which is where the words are:
 * the chart alone never says anything the list does not.
 */

const WEEK_PX = 48;
const WEEKS = 10;
const LANE_PX = 14;

/** Monday of the week before `today`, where the view opens. */
const rangeStart = (today: Day): Day => {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, -weekday - 7);
};

const x = (from: Day, d: Day) => (daysBetween(from, d) * WEEK_PX) / 7;

type BarProps = {
  item: PlacedTask;
  from: Day;
  lane: number;
};

const Bar = ({ item, from, lane }: BarProps) => {
  const left = Math.max(0, x(from, item.start));
  const width = Math.max(8, x(from, addDays(item.end, 1)) - left);
  const late = item.overdueSince !== null;
  return (
    <>
      <a
        href={`#z-${item.task.key}`}
        aria-label={`${item.task.text}, ${germanDay(item.end)}`}
        className={cn(
          'absolute h-2.5 border',
          late ? 'border-signal-red' : 'border-signal-cyan',
          !item.rule && (late ? 'bg-signal-red' : 'bg-signal-cyan'),
        )}
        style={{ left, width, top: 3 + lane * LANE_PX }}
      />
      {item.latest !== null ? (
        <span
          aria-hidden
          className="absolute h-2.5 w-px bg-signal-cyan"
          style={{ left: x(from, item.latest), top: 3 + lane * LANE_PX }}
        />
      ) : null}
    </>
  );
};

type ChartProps = {
  timeline: Timeline;
};

const Chart = ({ timeline }: ChartProps) => {
  const from = rangeStart(timeline.today);
  const until = addDays(from, WEEKS * 7);
  const width = WEEKS * WEEK_PX;
  const todayX = x(from, timeline.today);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        <div className="flex">
          <div className="sticky left-0 z-1 w-28 shrink-0 bg-background" />
          <div className="relative flex" style={{ width }}>
            {Array.from({ length: WEEKS }, (_, i) => (
              <Typography
                key={i}
                as="span"
                variant="small"
                color="muted"
                className="w-12 shrink-0 border-l border-foreground/15 pl-1 text-[10px]"
              >
                {germanDay(addDays(from, i * 7)).slice(0, 6)}
              </Typography>
            ))}
          </div>
        </div>
        {timeline.rows.map((row) => {
          const shown = row.items.filter((i) => i.start < until);
          const rowLanes = lanes(shown);
          const later = row.items.length - shown.length;
          return (
            <div key={row.pageId} className="flex border-t border-foreground/15">
              <Typography
                as="span"
                variant="small"
                className="sticky left-0 z-1 w-28 shrink-0 truncate bg-background py-1 pr-2 text-xs"
              >
                {row.section}
                {later > 0 ? (
                  <Typography as="span" variant="small" color="muted" className="text-[10px]">
                    {' '}
                    +{later} später
                  </Typography>
                ) : null}
              </Typography>
              <div
                className="relative"
                style={{ width, height: Math.max(1, rowLanes.length) * LANE_PX + 6 }}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-signal-yellow"
                  style={{ left: todayX }}
                />
                {rowLanes.flatMap((lane, i) =>
                  lane.map((item) => <Bar key={item.task.key} item={item} from={from} lane={i} />),
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

type DateLeadProps = {
  item: PlacedTask;
};

const DateLead = ({ item }: DateLeadProps) => (
  <Typography
    as="span"
    variant="small"
    color={item.overdueSince !== null ? 'red' : 'cyan'}
    className="font-bold"
  >
    {item.overdueSince !== null
      ? `überfällig seit ${germanDay(item.overdueSince)}`
      : germanDay(item.end)}
    {item.rule ? ' · gerechnet' : ''}{' '}
  </Typography>
);

/** A snapshot stored before the parser returned cells has no Frist to read. */
const NeedsRefresh = () => (
  <div className="border border-signal-yellow p-3">
    <Typography variant="small">
      Der gespeicherte Stand ist zu alt für diese Ansicht. Nach der nächsten Aktualisierung steht
      sie hier.
    </Typography>
  </div>
);

type ZeitplanProps = {
  timeline: Timeline;
};

const Zeitplan = ({ timeline }: ZeitplanProps) => {
  if (!timeline.available) return <NeedsRefresh />;
  const undated = timeline.urgent.length + timeline.undated.length + timeline.unclear.length;
  return (
    <>
      <Typography variant="small" color="muted">
        {timeline.placed.length} mit Datum, {undated} ohne. Gefüllt: geschrieben, leer: aus Regel,
        rot: überfällig.
      </Typography>
      {timeline.placed.length === 0 ? (
        <Empty>Keine Aufgabe mit Datum.</Empty>
      ) : (
        <Chart timeline={timeline} />
      )}
      {timeline.placed.length > 0 ? (
        <List>
          {timeline.placed.map((item) => (
            <TaskRow
              key={item.task.key}
              id={`z-${item.task.key}`}
              task={item.task}
              standalone
              lead={<DateLead item={item} />}
            />
          ))}
        </List>
      ) : null}
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
      {timeline.undated.length > 0 ? (
        <details className="group mt-4">
          <summary className="min-h-11 cursor-pointer py-2">
            <Typography as="span" variant="label" color="muted">
              Ohne Datum ({timeline.undated.length})
            </Typography>
          </summary>
          <List>
            {timeline.undated.map((t) => (
              <TaskRow key={t.key} task={t} standalone />
            ))}
          </List>
        </details>
      ) : null}
    </>
  );
};

export { NeedsRefresh, Zeitplan };
