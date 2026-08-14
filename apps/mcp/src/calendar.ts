/**
 * Google Calendar: supporting evidence, like Gmail. An event corroborates a
 * page; it is never the working unit.
 *
 * Ported from the edge function. The two normalisations here — all-day events
 * and recurring series — are both cases where the obvious code returns
 * something plausible and wrong, so they moved across unchanged.
 */

import { GraphError } from './client.js';
import { calendarGet } from './api.js';

/** The edge function returned HTTP statuses; here the message is the whole signal. */
const failure = (message: string): GraphError => new GraphError(message, false);

type CalendarTime = { dateTime?: string; date?: string; timeZone?: string };

type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: CalendarTime;
  end?: CalendarTime;
  recurringEventId?: string;
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  organizer?: { email?: string; displayName?: string };
};

/**
 * Calendar ids are `primary` or an email-shaped address. Checked because the
 * value is a caller-supplied path segment.
 */
const CALENDAR_ID = /^[A-Za-z0-9._%+@#-]{1,320}$/;
/** Event ids are base32hex-ish; recurring instances append `_<timestamp>`. */
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;

/**
 * Normalise a Calendar time into one shape.
 *
 * An event carries `dateTime` OR `date`, never both: timed events use the
 * first, all-day events the second. Reading only `dateTime` therefore returns
 * nothing for every all-day event, which is how a festival or a tour block is
 * usually recorded — the failure is silent and looks like an empty calendar.
 */
export function eventTime(t: CalendarTime | undefined): {
  value: string | null;
  all_day: boolean;
  time_zone: string | null;
} {
  if (!t) return { value: null, all_day: false, time_zone: null };
  if (t.date) return { value: t.date, all_day: true, time_zone: t.timeZone ?? null };
  return { value: t.dateTime ?? null, all_day: false, time_zone: t.timeZone ?? null };
}

/**
 * Events carry their own time zone, which need not be the musician's. Times are
 * returned as the API states them and always paired with their zone, rather
 * than rendered into an ambient local time that silently differs between
 * whoever formats it.
 */
export function shapeEvent(e: CalendarEvent) {
  const start = eventTime(e.start);
  const end = eventTime(e.end);
  return {
    id: e.id,
    summary: e.summary ?? "(no title)",
    status: e.status ?? null,
    location: e.location ?? null,
    start: start.value,
    end: end.value,
    all_day: start.all_day,
    time_zone: start.time_zone ?? end.time_zone,
    // Present only on an instance of a recurring series, which is worth saying:
    // "every Tuesday" and "this Tuesday" are different claims about a page.
    recurring: Boolean(e.recurringEventId),
  };
}

/** Events returned per call, and how many occurrences of one series may fill it. */
const PAGE = 25;
const MAX_PER_SERIES = 3;

/**
 * Keep at most `limit` occurrences of any one recurring series.
 *
 * A weekly rehearsal expands to dozens of instances and, ordered by start time,
 * crowds every other event out of the page: a real calendar returned 23
 * rehearsals and two other events. The first few occurrences answer "when does
 * this recur"; the rest push out the concert the page is actually about.
 *
 * Non-recurring events are never thinned, and the count of what was dropped is
 * returned so the caller can say so rather than implying an empty diary.
 */
export function thinRecurring(
  events: CalendarEvent[],
  limit: number,
): { kept: CalendarEvent[]; omitted: number } {
  const seen = new Map<string, number>();
  const kept: CalendarEvent[] = [];
  let omitted = 0;

  for (const e of events) {
    const series = e.recurringEventId;
    if (!series) {
      kept.push(e);
      continue;
    }
    const n = (seen.get(series) ?? 0) + 1;
    seen.set(series, n);
    if (n <= limit) kept.push(e);
    else omitted += 1;
  }
  return { kept, omitted };
}

/**
 * List events in a window, earliest first.
 *
 * singleEvents=true is not optional. Without it the API returns recurrence
 * *rules* rather than occurrences, so a weekly rehearsal appears once, at its
 * first date, carrying an RRULE that reads as a single event on the wrong day.
 * orderBy=startTime is only accepted alongside it.
 */
export async function listEvents(
  token: string,
  rawCalendarId: unknown,
  rawQuery: unknown,
  rawTimeMin: unknown,
  rawTimeMax: unknown,
) {
  const calendarId = typeof rawCalendarId === "string" && rawCalendarId.trim()
    ? rawCalendarId.trim()
    : "primary";
  if (!CALENDAR_ID.test(calendarId)) {
    throw failure("calendar_id is malformed.");
  }

  const iso = (v: unknown, fallback: string): string => {
    if (typeof v !== "string" || !v.trim()) return fallback;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw failure(`Not a date: ${v}`);
    return d.toISOString();
  };

  // Defaults lean recent-and-ahead: corroborating next month's concert is the
  // common case, but a page about last week still needs its evidence, so the
  // window opens slightly in the past rather than at now.
  const now = Date.now();
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    // Fetched wide and thinned below. A weekly series expands to ~50 instances
    // a year, so asking for exactly the number to be returned means one
    // rehearsal fills the whole page and a concert three months out is never
    // seen at all.
    maxResults: "100",
    timeMin: iso(rawTimeMin, new Date(now - 7 * 86_400_000).toISOString()),
    timeMax: iso(rawTimeMax, new Date(now + 365 * 86_400_000).toISOString()),
  });
  if (typeof rawQuery === "string" && rawQuery.trim()) {
    params.set("q", rawQuery.slice(0, 500).trim());
  }

  const res = await calendarGet(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    token,
  );
  const items = ((await res.json()) as { items?: CalendarEvent[] }).items ?? [];

  // Expanding a series also yields its cancelled instances. A cancelled
  // occurrence is not evidence that something is happening, so it is dropped
  // here — read_event still reports the status if one is asked for by id.
  const live = items.filter((e) => e.status !== "cancelled");

  const { kept, omitted } = thinRecurring(live, MAX_PER_SERIES);
  return {
    events: kept.slice(0, PAGE).map(shapeEvent),
    // Stated rather than silent: "nothing else is booked" and "the rest of the
    // page was rehearsals" are different answers about a musician's diary.
    omitted_occurrences: omitted + Math.max(0, kept.length - PAGE),
  };
}

export async function readEvent(token: string, rawEventId: unknown, rawCalendarId: unknown) {
  if (typeof rawEventId !== "string" || !EVENT_ID.test(rawEventId)) {
    throw failure("event_id is missing or malformed.");
  }
  const calendarId = typeof rawCalendarId === "string" && rawCalendarId.trim()
    ? rawCalendarId.trim()
    : "primary";
  if (!CALENDAR_ID.test(calendarId)) {
    throw failure("calendar_id is malformed.");
  }

  const res = await calendarGet(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawEventId)}`,
    token,
  );
  const e = (await res.json()) as CalendarEvent;

  return {
    ...shapeEvent(e),
    description: e.description ?? null,
    organizer: e.organizer?.email ?? e.organizer?.displayName ?? null,
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.email ?? null,
      name: a.displayName ?? null,
      response: a.responseStatus ?? null,
    })),
  };
}

