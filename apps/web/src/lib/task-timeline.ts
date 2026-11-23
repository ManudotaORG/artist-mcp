/**
 * The Zeitplan (0021): open tasks placed on the dates their `Frist` cell
 * states. Pure, like `task-view-model.ts`, so the node tests run it directly.
 *
 * Only two shapes are read: a full `dd.mm.yyyy` (or a span ending in one), and
 * an ideal date with a latest one after it ("spät." or "spätestens"). Anything
 * else stays in the page's words, beside the timeline. A cell saying
 * "(Regel: …)" or "(gerechnet)" was worked out, not written, and is marked so.
 * Overdue tasks slide to tomorrow for drawing only; nothing is written.
 */
import type { ShownTask } from './task-view-model';

/** A calendar day as `yyyy-mm-dd`, compared as a string. */
export type Day = string;

export type Frist = {
  start: Day;
  /** The ideal date: where the span or the single day ends. */
  end: Day;
  /** The latest date, where the cell gives one after the ideal date. */
  latest: Day | null;
  /** Worked out from a rule rather than written. */
  rule: boolean;
};

export type PlacedTask = Frist & {
  task: ShownTask;
  cell: string;
  /** Set when the task slid: the date it was due. */
  overdueSince: Day | null;
};

export type TimelineRow = { section: string; pageId: string; items: PlacedTask[] };

export type Timeline = {
  /** False until the parser returns cells: nothing can be placed. */
  available: boolean;
  today: Day;
  rows: TimelineRow[];
  placed: PlacedTask[];
  /** A Frist cell with no date this reads, in the page's words. */
  unclear: { task: ShownTask; cell: string }[];
  urgent: ShownTask[];
  undated: ShownTask[];
};

const DATE = String.raw`(\d{1,2})\.(\d{1,2})\.(\d{4})`;
const DAY_MONTH = String.raw`(\d{1,2})\.(?:(\d{1,2})\.)?`;

const day = (d: string, m: string, y: string): Day | null => {
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
};

export const addDays = (d: Day, n: number): Day => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export const daysBetween = (a: Day, b: Day): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Read a Frist cell. Null where its first thing is not a date this reads —
 * "laufend", "UNKNOWN", "Ende Jänner" — so it is never guessed into one.
 */
export const readFrist = (cell: string): Frist | null => {
  const text = cell
    .trim()
    .replace(/^(?:idealerweise|bis(?:\s+zum|\s+spätestens)?|vor(?:\s+dem)?)\s+/i, '');
  const rule = /\(Regel:|\bgerechnet\b/i.test(text);

  // A span: "15.–29.09.2026", "15.09.–29.09.2026", "15.09.2026–29.09.2026".
  const span = new RegExp(String.raw`^${DAY_MONTH}(\d{4})?\s*[–-]\s*${DATE}`).exec(text);
  let start: Day | null = null;
  let end: Day | null = null;
  let rest = text;
  if (span) {
    const [, d1, m1, y1, d2, m2, y2] = span;
    end = day(d2, m2, y2);
    start = day(d1, m1 ?? m2, y1 ?? y2);
    rest = text.slice(span[0].length);
  } else {
    const single = new RegExp(String.raw`^${DATE}`).exec(text);
    if (!single) return null;
    start = end = day(single[1], single[2], single[3]);
    rest = text.slice(single[0].length);
  }
  if (start === null || end === null || start > end) return null;

  const later = new RegExp(String.raw`^\s*,?\s*spät(?:\.|estens)\s+${DATE}`, 'i').exec(rest);
  const latest = later ? day(later[1], later[2], later[3]) : null;
  return { start, end, latest: latest !== null && latest > end ? latest : null, rule };
};

/** The task's Frist cell, by any header starting "Frist". */
export const fristCell = (task: ShownTask): string | null => {
  if (task.cells === null) return null;
  const key = Object.keys(task.cells).find((k) => /^frist/i.test(k.trim()));
  return key === undefined ? null : task.cells[key];
};

/** `policy:tasks`' urgency marks, which outrank the absence of a date. */
const URGENT = /PRIORITÄT\s*1|SEHR DRINGEND|höchste Priorität|\bJETZT\b|\bSOFORT\b|\bHOCH\b/;

const isUrgent = (task: ShownTask): boolean =>
  [task.text, ...Object.values(task.cells ?? {})].some((part) => URGENT.test(part));

/**
 * Place the open tasks. `open` is the view's open list, which leaves out done
 * and unsettled tasks already; `today` is Ruben's day, in Vienna.
 */
export const buildTimeline = (open: ShownTask[], today: Day): Timeline => {
  const available = open.some((t) => t.cells !== null);
  const placed: PlacedTask[] = [];
  const unclear: Timeline['unclear'] = [];
  const urgent: ShownTask[] = [];
  const undated: ShownTask[] = [];

  for (const task of open) {
    const cell = fristCell(task);
    const frist = cell === null ? null : readFrist(cell);
    if (cell !== null && frist !== null) {
      // Passed entirely: drawn from tomorrow, keeping its length.
      const slid = frist.end < today;
      const tomorrow = addDays(today, 1);
      const length = daysBetween(frist.start, frist.end);
      placed.push({
        ...frist,
        start: slid ? tomorrow : frist.start,
        end: slid ? addDays(tomorrow, length) : frist.end,
        latest: slid ? null : frist.latest,
        task,
        cell,
        overdueSince: slid ? frist.end : null,
      });
      continue;
    }
    const words = cell?.trim() ?? '';
    if (isUrgent(task)) urgent.push(task);
    else if (words !== '' && !/^unknown$/i.test(words)) unclear.push({ task, cell: words });
    else undated.push(task);
  }

  placed.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const rows = new Map<string, TimelineRow>();
  for (const item of placed) {
    const id = item.task.page.page_id;
    const row = rows.get(id) ?? { section: item.task.page.section, pageId: id, items: [] };
    row.items.push(item);
    rows.set(id, row);
  }

  return {
    available,
    today,
    rows: [...rows.values()].sort((a, b) => a.section.localeCompare(b.section, 'de')),
    placed,
    unclear,
    urgent,
    undated,
  };
};

/** Today in Vienna, as a Day. */
export const viennaToday = (now: Date = new Date()): Day =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(now);

/** A Day as Ruben writes it: 01.09.2026. */
export const germanDay = (d: Day): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Lanes, so two tasks of one project on overlapping days do not cover each other. */
export const lanes = (items: PlacedTask[]): PlacedTask[][] => {
  const out: PlacedTask[][] = [];
  for (const item of items) {
    const lane = out.find((l) => {
      const last = l[l.length - 1];
      return (last.latest ?? last.end) < item.start;
    });
    if (lane) lane.push(item);
    else out.push([item]);
  }
  return out;
};

/** The date the page gives, before any sliding. */
export const dueOn = (item: PlacedTask): Day => item.overdueSince ?? item.end;

/** Fristen: every placed task, by the date the page gives, earliest first. */
export const byDue = (timeline: Timeline): PlacedTask[] =>
  [...timeline.placed].sort((a, b) => dueOn(a).localeCompare(dueOn(b)));

/** Heute (0020): open tasks whose Frist, as the page gives it, is today or earlier. */
export const dueByToday = (timeline: Timeline): PlacedTask[] =>
  byDue(timeline).filter((item) => dueOn(item) <= timeline.today);

/** One person, as the `Verantwortlich` cell writes them, and their open tasks. */
export type PersonGroup = { who: string; tasks: ShownTask[] };

/**
 * Menschen (0020): open tasks grouped by the `Verantwortlich` cell exactly as
 * written. Names are not split out of a cell or merged across spellings: "Büro"
 * and "Ruben, Büro" are two groups, because deciding they overlap is reading.
 * Tasks with no such cell are counted, not grouped.
 */
export const byResponsible = (open: ShownTask[]): { groups: PersonGroup[]; without: number } => {
  const groups = new Map<string, ShownTask[]>();
  let without = 0;
  for (const task of open) {
    const key = Object.keys(task.cells ?? {}).find((k) => /^verantwortlich/i.test(k.trim()));
    if (key === undefined) {
      without++;
      continue;
    }
    const who = (task.cells as Record<string, string>)[key].trim() || '(leer)';
    groups.set(who, [...(groups.get(who) ?? []), task]);
  }
  return {
    groups: [...groups.entries()]
      .map(([who, tasks]) => ({ who, tasks }))
      .sort((a, b) => b.tasks.length - a.tasks.length || a.who.localeCompare(b.who, 'de')),
    without,
  };
};
