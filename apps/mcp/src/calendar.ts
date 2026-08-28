/**
 * Google Calendar: supporting evidence, like Gmail. An event corroborates a
 * page; it is never the working unit.
 *
 * Ported from the edge function. The two normalisations here — all-day events
 * and recurring series — are both cases where the obvious code returns
 * something plausible and wrong, so they moved across unchanged.
 */

import { DuplicateEventError, GraphError, ScopeError } from './client.js';
import {
  CALENDAR_LIST_NEED,
  calendarDeleteEvent,
  calendarGet,
  calendarInsertEvent,
} from './api.js';
import { recordWrite, type RecordWrite } from './audit.js';

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


type CalendarListEntry = {
  id?: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
  deleted?: boolean;
};

/**
 * Which calendars this musician has.
 *
 * The point is not the list, it is what the list lets a later answer say. A
 * search of `primary` that finds nothing cannot tell "this gig is not in the
 * diary" from "this gig is on the calendar I did not look at", and the second
 * is common: gigs land on a band or a venue calendar far more often than a
 * musician expects. Absence is only evidence once the reach of the look is
 * known — see `policy:evidence`, and
 * docs/decisions/0001-opt-in-calendar-writes.md.
 *
 * `calendar.calendarlist.readonly` was added for this, so a connection made
 * before it exists cannot answer. That is not a failure: `primary` is still
 * readable and still worth reading. The result therefore says it is partial and
 * why, rather than throwing, because a caller that cannot list calendars must
 * still be able to say what it did and did not cover.
 */
export async function listCalendars(token: string) {
  let items: CalendarListEntry[];
  try {
    const res = await calendarGet('/users/me/calendarList', token, CALENDAR_LIST_NEED);
    items = ((await res.json()) as { items?: CalendarListEntry[] }).items ?? [];
  } catch (err) {
    // Only the gap this call can work around. A real fault still throws — the
    // whole reason ScopeError is its own type is so that this catch cannot
    // quietly swallow one.
    if (err instanceof ScopeError && err.optional) {
      return {
        calendars: [],
        complete: false,
        // Phrased for the reader of an answer, not for a log. Whatever calls
        // this has to be able to repeat it verbatim beside its own result.
        limitation:
          'Only the primary calendar could be searched: this Google connection ' +
          'was made before artist-mcp could see your calendar list. Anything on ' +
          'another calendar would not have been found. Run `artist-mcp connect ' +
          'google` to widen it.',
      };
    }
    throw err;
  }

  const calendars = items
    // A deleted entry is a calendar the musician removed from their list. It is
    // not somewhere a gig can be, and offering it would invite a look that
    // cannot find anything.
    .filter((c) => c.deleted !== true && typeof c.id === 'string')
    .map((c) => ({
      id: c.id as string,
      summary: c.summary ?? '(no name)',
      primary: c.primary === true,
      // Kept because it decides whether a write could ever land here, and a
      // reader is entitled to know a calendar is one they can only look at.
      access_role: c.accessRole ?? null,
      time_zone: c.timeZone ?? null,
    }));

  return { calendars, complete: true, limitation: null };
}


// ------------------------------------------------------- creating an event

/**
 * The fields that define an event, in a fixed order.
 *
 * Fixed because both the confirmation token and the idempotency id are hashes
 * of this, and a shape that varied with key order would make the same event
 * hash differently between two calls.
 */
export type EventDraft = {
  calendar_id: string;
  summary: string;
  /** `YYYY-MM-DD` for an all-day event, or an RFC3339 datetime. */
  start: string;
  end: string;
  /** IANA name. Required for a timed event, meaningless for an all-day one. */
  time_zone: string | null;
  location: string | null;
  description: string | null;
};

const canonical = (d: EventDraft): string =>
  [
    d.calendar_id,
    d.summary,
    d.start,
    d.end,
    d.time_zone ?? '',
    d.location ?? '',
    d.description ?? '',
  ].join(' ');

/**
 * Google accepts a client-set event id, which is what makes a retry safe: the
 * second attempt collides with 409 rather than double-booking. Its ids are
 * base32hex — digits and `a`-`v` — 5 to 1024 characters, unique per calendar.
 */
const base32hex = (bytes: Uint8Array): string => {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
};

const digest = async (prefix: string, draft: EventDraft): Promise<string> => {
  const data = new TextEncoder().encode(`${prefix} ${canonical(draft)}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base32hex(new Uint8Array(hash));
};

/**
 * The token a preview returns and a create must carry back.
 *
 * Derived from the payload, so it proves the create is for the values that were
 * shown - not merely that a preview happened at some point. It cannot prove a
 * human read them; nothing inside MCP can. See
 * docs/decisions/0001-opt-in-calendar-writes.md.
 */
export const confirmationToken = (draft: EventDraft): Promise<string> =>
  digest('confirm', draft);

/**
 * The event's id in Google, which is what stops a retry double-booking.
 *
 * Derived independently of the confirmation token, from a different prefix, on
 * purpose: if the double-book guard rode on the token, dropping the token
 * requirement later would silently drop double-booking protection with it.
 */
export const ARTIST_ID_PREFIX = 'artist';

export const idempotencyId = async (draft: EventDraft): Promise<string> =>
  // Prefixed so a human reading their calendar's raw data can tell where the
  // event came from, and trimmed because Google caps ids at 1024 characters
  // while 32 base32hex characters is already 160 bits.
  //
  // The prefix is load-bearing beyond legibility: it is what makes deleting
  // safe to offer at all, since only an id carrying it may be removed.
  `${ARTIST_ID_PREFIX}${(await digest('event', draft)).slice(0, 32)}`;

/**
 * Anything a page left unsettled, in the spellings the pack actually uses.
 *
 * Case-sensitive for the placeholder words, which is not fussiness: the pack
 * writes `UNKNOWN` in capitals, and matching case-insensitively refused
 * "Unknown Pleasures tribute night" — a real gig title, and a refusal a
 * musician could do nothing about except rename their own event. A field that
 * is *only* the word is caught in any case, since "unknown" alone is never a
 * venue.
 *
 * The trade is deliberate. A lowercase "unknown" buried in a sentence gets
 * through, and the playbook rule still governs the session that composed it;
 * refusing every occurrence would block legitimate writes to prevent a case
 * the preview already shows the musician.
 */
const PLACEHOLDERS = ['UNKNOWN', 'TBC', 'TBD', 'T.B.C', 'T.B.D'];
const unsettled = (value: string): boolean => {
  const trimmed = value.trim();
  if (PLACEHOLDERS.some((word) => trimmed.toUpperCase() === word)) return true;
  if (/\?\?+/.test(trimmed)) return true;
  return PLACEHOLDERS.some((word) =>
    new RegExp(`(^|[^A-Za-z])${word.replace(/\./g, '\\.')}([^A-Za-z]|$)`).test(trimmed),
  );
};

/**
 * Refuse to write a value the notebook has not settled.
 *
 * This is the rule that matters most in the decision record, and it lives here
 * rather than only in a playbook because a playbook governs a session while
 * this governs the write. Two pages disagreeing about a date is exactly what
 * `policy:divergence` spends its length refusing to decide; a write would
 * decide it silently, durably, and where other people can see it.
 */
export const refuseUnsettled = (draft: EventDraft): void => {
  const fields: [string, string | null][] = [
    ['title', draft.summary],
    ['start', draft.start],
    ['end', draft.end],
    ['location', draft.location],
    ['notes', draft.description],
  ];
  for (const [name, value] of fields) {
    if (value && unsettled(value)) {
      throw failure(
        `The ${name} is not settled - it still reads "${value.trim()}". A calendar ` +
          'event is durable and other people see it, so an unsettled value is not ' +
          'written. Settle it on the page first, then ask again.',
      );
    }
  }
};


/** Shape-check what a caller gave us, before any of it is hashed or written. */
const draftFrom = (params: Record<string, unknown>): EventDraft => {
  const text = (v: unknown, name: string, required: boolean): string | null => {
    if (v === undefined || v === null || v === '') {
      if (required) throw failure(`${name} is required to create an event.`);
      return null;
    }
    if (typeof v !== 'string') throw failure(`${name} must be text.`);
    if (v.length > 1024) throw failure(`${name} is too long.`);
    return v.trim();
  };

  const calendarId = text(params.calendar_id, 'calendar_id', false) ?? 'primary';
  if (!CALENDAR_ID.test(calendarId)) throw failure('calendar_id is malformed.');

  const start = text(params.start, 'start', true) as string;
  const end = text(params.end, 'end', true) as string;
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);

  if (allDay !== /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw failure(
      'start and end must be the same kind: both dates for an all-day event, or ' +
        'both date-times.',
    );
  }
  if (!allDay) {
    for (const [name, value] of [['start', start], ['end', end]] as const) {
      if (Number.isNaN(new Date(value).getTime())) throw failure(`${name} is not a date-time.`);
    }
  }

  // A timed event with no zone is the bug this file already warns about in the
  // other direction: the calendar's zone need not be the reader's, and letting
  // one be assumed here writes a gig an hour out and looks entirely correct.
  const timeZone = text(params.time_zone, 'time_zone', false);
  if (!allDay && !timeZone) {
    throw failure(
      'time_zone is required for a timed event, as an IANA name such as ' +
        'Europe/Madrid. Without it the time is guesswork, and a gig written an ' +
        'hour out looks exactly like a correct one.',
    );
  }

  if (new Date(end).getTime() < new Date(start).getTime()) {
    throw failure('The event ends before it starts.');
  }

  // Equal ends are the subtler half, and they differ by kind.
  //
  // Google treats an all-day `end.date` as exclusive: a gig on the 11th ends on
  // the 12th. `end` equal to `start` is an empty range, which Google refuses —
  // and a model that does not know the convention writes it without hesitating.
  // A timed event of zero length is not a gig either. Refused here rather than
  // surfacing as a Google 400 that says nothing about what to do.
  if (end === start) {
    throw failure(
      allDay
        ? `An all-day event ends on the following day: Google reads the end date as ` +
            `exclusive, so a single day on ${start} is start ${start}, end ` +
            `${new Date(new Date(start).getTime() + 86_400_000).toISOString().slice(0, 10)}.`
        : 'The event starts and ends at the same moment. Give it a duration.',
    );
  }

  return {
    calendar_id: calendarId,
    summary: text(params.summary, 'summary', true) as string,
    start,
    end,
    time_zone: allDay ? null : timeZone,
    location: text(params.location, 'location', false),
    description: text(params.description, 'description', false),
  };
};

/** How an event reads to a person checking it against a page. */
const renderDraft = (draft: EventDraft): string => {
  const allDay = draft.time_zone === null;
  const lines = [
    `Title:    ${draft.summary}`,
    allDay
      ? `When:     ${draft.start} to ${draft.end} (all day)`
      : `When:     ${draft.start} to ${draft.end} (${draft.time_zone})`,
  ];
  if (draft.location) lines.push(`Where:    ${draft.location}`);
  if (draft.description) lines.push(`Notes:    ${draft.description}`);
  lines.push(`Calendar: ${draft.calendar_id}`);
  return lines.join('\n');
};

/**
 * Show an event exactly as it would be written, and hand back the token that
 * lets it be written.
 *
 * The day is enumerated alongside it, because a preview that shows only what
 * would be added invites the question it cannot answer: whether it is already
 * there. That listing is also the only honest form of "is this missing" this
 * product has - see docs/decisions/0001-opt-in-calendar-writes.md.
 */
export async function previewEvent(token: string, params: Record<string, unknown>) {
  const draft = draftFrom(params);
  refuseUnsettled(draft);

  const day = draft.start.slice(0, 10);
  const { events } = await listEvents(
    token,
    draft.calendar_id,
    undefined,
    `${day}T00:00:00Z`,
    `${day}T23:59:59Z`,
  );

  return {
    preview: renderDraft(draft),
    confirmation_token: await confirmationToken(draft),
    existing_that_day: events,
    calendar_searched: draft.calendar_id,
  };
}

/**
 * Say which kind of "already taken" this is.
 *
 * A cancelled event is one sitting in that calendar's bin, where Google keeps it
 * for 30 days and where it goes on holding its id. Recreating the same event is
 * therefore impossible until it is restored or the bin expires — which is a
 * thing the musician can act on, unlike "already in the calendar".
 */
const describeDuplicate = async (
  token: string,
  calendarId: string,
  eventId: string,
): Promise<GraphError> => {
  try {
    const res = await calendarGet(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      token,
    );
    const existing = (await res.json()) as CalendarEvent;
    if (existing.status === 'cancelled') {
      return failure(
        'This exact event was created before and then deleted, and it is still ' +
          "in that calendar's bin, which holds its id. Nothing was duplicated " +
          'and nothing new was created. To bring it back, restore it from the ' +
          "calendar's bin in Google Calendar — Google keeps it for 30 days. " +
          'Creating it again here will keep failing until then.',
      );
    }
  } catch {
    // Fall through: not being able to look it up is not worth failing over,
    // and the safe half of the answer is true either way.
  }
  return failure(
    'That event is already in the calendar — this exact event was created ' +
      'before, so nothing was duplicated.',
  );
};

/** The Google payload for a draft, id included. Shared so a create and a
 * reschedule cannot drift into writing different shapes for the same values. */
const eventBody = async (draft: EventDraft) => {
  const allDay = draft.time_zone === null;
  return {
    id: await idempotencyId(draft),
    summary: draft.summary,
    start: allDay ? { date: draft.start } : { dateTime: draft.start, timeZone: draft.time_zone },
    end: allDay ? { date: draft.end } : { dateTime: draft.end, timeZone: draft.time_zone },
    ...(draft.location ? { location: draft.location } : {}),
    ...(draft.description ? { description: draft.description } : {}),
  };
};

/**
 * Create the event, if the token matches the payload.
 *
 * The comparison is the boundary: it makes creating an event that was never
 * previewed inexpressible, and previewing one event and creating another
 * inexpressible too. It does not prove a person read the preview, and no part
 * of this protocol can.
 */
export async function createEvent(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite = recordWrite,
) {
  const draft = draftFrom(params);
  refuseUnsettled(draft);

  const supplied = typeof params.confirmation_token === 'string' ? params.confirmation_token : '';
  const expected = await confirmationToken(draft);
  if (supplied !== expected) {
    throw failure(
      supplied === ''
        ? 'No confirmation_token. Call preview_calendar_event first and show the ' +
            'musician what it returns; creating an event nobody has seen is not ' +
            'something this tool can do.'
        : 'The confirmation_token does not match this event. It belongs to a ' +
            'different set of values, so something changed after the preview. ' +
            'Preview again and show the musician the new version.',
    );
  }

  const body = await eventBody(draft);

  let res: Response;
  try {
    res = await calendarInsertEvent(draft.calendar_id, body, token);
  } catch (err) {
    // The id is taken. Whether that means "it is already there" or "it is in
    // the bin" is the difference between a reassuring answer and one that sends
    // someone hunting for an event they cannot see, so it is looked up rather
    // than guessed. Confirmed against a real calendar: deleting an event and
    // creating it again lands here, with the trashed event still holding the id.
    if (err instanceof DuplicateEventError) {
      throw await describeDuplicate(token, draft.calendar_id, body.id);
    }
    throw err;
  }
  const created = (await res.json()) as CalendarEvent;

  // Here, not in the tool handler that used to hold it. A record kept one layer
  // above the write is a record of calls to that layer, and anything reaching
  // the write another way leaves no trace at all — which is exactly what
  // happened the first time this was run against a real calendar. The audit has
  // to sit where the event is created or it is not an audit.
  await record({
    operation: 'create_calendar_event',
    summary: renderDraft(draft),
    target: `${draft.calendar_id}/${created.id ?? 'unknown'}`,
    source_page: typeof params.source_page === 'string' ? params.source_page : null,
  });

  return {
    created: shapeEvent(created),
    link: created.htmlLink ?? null,
    calendar_id: draft.calendar_id,
    written: renderDraft(draft),
  };
}


// -------------------------------------------------------- removing an event

/**
 * Fetch the event as it stands, so a delete is confirmed against what is really
 * there rather than against a description of it.
 *
 * This is the one place the confirmation is stricter than it is for a create:
 * the payload being hashed came from Google, not from the caller.
 */
const fetchForDeletion = async (
  token: string,
  calendarId: string,
  eventId: string,
  verb = 'deleted',
) => {
  if (!EVENT_ID.test(eventId)) throw failure('event_id is malformed.');
  if (!CALENDAR_ID.test(calendarId)) throw failure('calendar_id is malformed.');

  // The rule the whole capability rests on. An id without the prefix belongs to
  // an event somebody else made — typed in by hand, or shared onto the calendar
  // — and this tool has no business removing it. Checked before the fetch, so a
  // refusal does not depend on the event being readable.
  if (!eventId.startsWith(ARTIST_ID_PREFIX)) {
    throw failure(
      `That event was not created by artist-mcp, so it cannot be ${verb} here. ` +
        'Only events this tool created can be touched by it — anything else is ' +
        "the musician's own, and belongs to them to change in Google Calendar.",
    );
  }

  const res = await calendarGet(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token,
  );
  return (await res.json()) as CalendarEvent;
};

/**
 * An instant, written in the zone it belongs to.
 *
 * Google answers with the instant, often as UTC, while the event carries its own
 * zone. Printing the two side by side reads as a local time and is wrong by the
 * offset: a 20:00 gig in Madrid renders as "18:00:00Z (Europe/Madrid)", which a
 * musician checking a deletion reads as six in the evening. The file already
 * warns about this in the other direction, and it is worse here, because the
 * whole point of the preview is that a person can check it.
 */
const inZone = (value: string | null, zone: string | null): string => {
  if (value === null) return 'unknown';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  if (!zone) return `${at.toISOString().replace('.000Z', 'Z')} (UTC)`;
  try {
    const shown = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(at);
    return `${shown} (${zone})`;
  } catch {
    // An unknown zone name is not a reason to render nothing; say the instant
    // and admit the zone could not be applied.
    return `${at.toISOString().replace('.000Z', 'Z')} (UTC; ${zone} not recognised)`;
  }
};

/** How a deletion reads to someone deciding whether to allow it. */
const renderExisting = (e: CalendarEvent, calendarId: string): string => {
  const start = eventTime(e.start);
  const end = eventTime(e.end);
  const zone = start.time_zone ?? end.time_zone;
  const lines = [
    `Title:    ${e.summary ?? '(no title)'}`,
    start.all_day
      ? `When:     ${start.value} to ${end.value} (all day)`
      : `When:     ${inZone(start.value, zone)} to ${inZone(end.value, zone)}`,
  ];
  if (e.location) lines.push(`Where:    ${e.location}`);
  if (e.description) lines.push(`Notes:    ${e.description}`);
  lines.push(`Calendar: ${calendarId}`);
  return lines.join('\n');
};

/** A token over the event as Google returns it, not as anyone described it. */
const deletionToken = async (e: CalendarEvent, calendarId: string): Promise<string> => {
  const data = new TextEncoder().encode(
    `delete ${calendarId} ${e.id ?? ''} ${e.summary ?? ''} ` +
      `${eventTime(e.start).value ?? ''} ${eventTime(e.end).value ?? ''}`,
  );
  return base32hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
};

/**
 * Show what would be removed, and hand back the token that permits removing it.
 */
export async function previewDeleteEvent(token: string, params: Record<string, unknown>) {
  const calendarId =
    typeof params.calendar_id === 'string' && params.calendar_id.trim()
      ? params.calendar_id.trim()
      : 'primary';
  const eventId = typeof params.event_id === 'string' ? params.event_id.trim() : '';
  const event = await fetchForDeletion(token, calendarId, eventId);

  return {
    preview: renderExisting(event, calendarId),
    confirmation_token: await deletionToken(event, calendarId),
    calendar_id: calendarId,
  };
}

/**
 * Remove an event this tool created.
 *
 * The audit records the whole event rather than a reference to it. A wrong
 * create leaves something visible; a wrong delete leaves a gap, and nobody
 * notices absence — so what is written down has to be enough to put it back by
 * hand once Google's 30-day bin has expired.
 */
export async function deleteEvent(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite = recordWrite,
) {
  const calendarId =
    typeof params.calendar_id === 'string' && params.calendar_id.trim()
      ? params.calendar_id.trim()
      : 'primary';
  const eventId = typeof params.event_id === 'string' ? params.event_id.trim() : '';
  const event = await fetchForDeletion(token, calendarId, eventId);

  const supplied = typeof params.confirmation_token === 'string' ? params.confirmation_token : '';
  const expected = await deletionToken(event, calendarId);
  if (supplied !== expected) {
    throw failure(
      supplied === ''
        ? 'No confirmation_token. Call preview_calendar_delete first and show the ' +
            'musician what would be removed.'
        : 'The confirmation_token does not match this event. It has changed since ' +
            'the preview, so preview again and show the musician what is there now.',
    );
  }

  const written = renderExisting(event, calendarId);
  await calendarDeleteEvent(calendarId, eventId, token);

  await record({
    operation: 'delete_calendar_event',
    summary: written,
    target: `${calendarId}/${eventId}`,
    source_page: typeof params.source_page === 'string' ? params.source_page : null,
  });

  return { deleted: written, calendar_id: calendarId, event_id: eventId };
}


// ---------------------------------------------------- rescheduling an event

/**
 * Moving an event is a create and a delete, not an update.
 *
 * Google will happily patch an event in place, and this deliberately does not.
 * `idempotencyId` is a hash of every field, so identity here *is* content: patch
 * the date and the event keeps an id that no longer describes it, the
 * double-book guard stops matching, and the next create of the same task lands
 * a second copy nobody asked for. Deriving the id is what makes a retry safe and
 * what makes deleting safe to offer, and neither survives an in-place edit.
 *
 * So the pair below writes the new event first and removes the old one after.
 * That order is the whole design: interrupted between the two, it leaves a
 * visible duplicate that anyone can see and clean up. The other order leaves a
 * gap, and nobody notices absence.
 *
 * The cost, which callers must say out loud before offering this: the new event
 * is a new event. Reminders set on the old one, and notifications other people
 * on a shared calendar arranged for it, do not come across.
 */

/**
 * A token over both halves — the event as Google has it, and the values that
 * would replace it. Bound together so a confirmed reschedule cannot be replayed
 * against a different destination, or a different source.
 */
const rescheduleToken = async (
  existing: CalendarEvent,
  fromCalendarId: string,
  draft: EventDraft,
): Promise<string> => {
  const data = new TextEncoder().encode(
    `reschedule ${fromCalendarId} ${existing.id ?? ''} ${existing.summary ?? ''} ` +
      `${eventTime(existing.start).value ?? ''} ${eventTime(existing.end).value ?? ''}` +
      ` :: ${canonical(draft)}`,
  );
  return base32hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
};

/**
 * The source event and the destination draft.
 *
 * `to_calendar_id` defaults to the calendar the event is already on, so moving
 * between calendars and moving in time are the same operation — which they are,
 * mechanically, and splitting them would mean two tools that do one thing each
 * and a third case nobody built for doing both at once.
 */
const rescheduleFrom = (params: Record<string, unknown>) => {
  const fromCalendarId =
    typeof params.calendar_id === 'string' && params.calendar_id.trim()
      ? params.calendar_id.trim()
      : 'primary';
  const eventId = typeof params.event_id === 'string' ? params.event_id.trim() : '';
  const toCalendarId =
    typeof params.to_calendar_id === 'string' && params.to_calendar_id.trim()
      ? params.to_calendar_id.trim()
      : fromCalendarId;

  const draft = draftFrom({ ...params, calendar_id: toCalendarId });
  return { fromCalendarId, eventId, draft };
};

/** Refuse a reschedule that would not change anything. */
const refuseUnchanged = async (eventId: string, draft: EventDraft): Promise<void> => {
  if ((await idempotencyId(draft)) === eventId) {
    throw failure(
      'Those are the values the event already has, so there is nothing to ' +
        'reschedule. Change the date, the title or the calendar, or leave the ' +
        'event alone.',
    );
  }
};

/**
 * Show the move as a before and an after, and hand back the token that permits
 * it.
 *
 * Both halves are rendered because a preview showing only the new values asks
 * the musician to remember what it is replacing, and the thing most worth
 * catching here is a move away from a date they meant to keep.
 */
export async function previewRescheduleEvent(token: string, params: Record<string, unknown>) {
  const { fromCalendarId, eventId, draft } = rescheduleFrom(params);
  const existing = await fetchForDeletion(token, fromCalendarId, eventId, 'rescheduled');

  refuseUnsettled(draft);
  await refuseUnchanged(eventId, draft);

  // The destination day, for the same reason a create previews it: an event
  // already sitting there is the thing a move most often collides with.
  const day = draft.start.slice(0, 10);
  const { events } = await listEvents(
    token,
    draft.calendar_id,
    undefined,
    `${day}T00:00:00Z`,
    `${day}T23:59:59Z`,
  );

  return {
    before: renderExisting(existing, fromCalendarId),
    after: renderDraft(draft),
    confirmation_token: await rescheduleToken(existing, fromCalendarId, draft),
    existing_that_day: events,
    calendar_searched: draft.calendar_id,
  };
}

/**
 * Write the new event, then remove the old one.
 *
 * Each half is audited separately and under its own operation name, because the
 * audit has to remain readable as a list of what actually reached Google. A
 * reschedule that half-completed is two rows saying so, not one row implying a
 * move that did not finish.
 */
export async function rescheduleEvent(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite = recordWrite,
) {
  const { fromCalendarId, eventId, draft } = rescheduleFrom(params);
  const existing = await fetchForDeletion(token, fromCalendarId, eventId, 'rescheduled');

  refuseUnsettled(draft);
  await refuseUnchanged(eventId, draft);

  const supplied = typeof params.confirmation_token === 'string' ? params.confirmation_token : '';
  const expected = await rescheduleToken(existing, fromCalendarId, draft);
  if (supplied !== expected) {
    throw failure(
      supplied === ''
        ? 'No confirmation_token. Call preview_calendar_reschedule first and show ' +
            'the musician both the event as it stands and what would replace it.'
        : 'The confirmation_token does not match. Either the event changed since ' +
            'the preview or the new values did, so preview again and show the ' +
            'musician the current version of both.',
    );
  }

  const removed = renderExisting(existing, fromCalendarId);
  const body = await eventBody(draft);

  // New first. Interrupted here, nothing has been lost.
  let res: Response;
  try {
    res = await calendarInsertEvent(draft.calendar_id, body, token);
  } catch (err) {
    if (err instanceof DuplicateEventError) {
      throw await describeDuplicate(token, draft.calendar_id, body.id);
    }
    throw err;
  }
  const created = (await res.json()) as CalendarEvent;

  await record({
    operation: 'create_calendar_event',
    summary: renderDraft(draft),
    target: `${draft.calendar_id}/${created.id ?? 'unknown'}`,
    source_page: typeof params.source_page === 'string' ? params.source_page : null,
  });

  // The old one goes second, and a failure here is reported rather than
  // swallowed: the musician is now looking at two events and has to be told
  // which one to remove, by hand, rather than discovering it later.
  try {
    await calendarDeleteEvent(fromCalendarId, eventId, token);
  } catch (err) {
    throw failure(
      'The new event was created, but the old one could not be removed, so both ' +
        `are now on the calendar. Remove "${existing.summary ?? '(no title)'}" ` +
        `(${eventId}) in ${fromCalendarId} by hand, or call ` +
        'preview_calendar_delete and delete_calendar_event for it. The ' +
        `underlying error was: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await record({
    operation: 'delete_calendar_event',
    summary: removed,
    target: `${fromCalendarId}/${eventId}`,
    source_page: typeof params.source_page === 'string' ? params.source_page : null,
  });

  return {
    removed,
    written: renderDraft(draft),
    created: shapeEvent(created),
    link: created.htmlLink ?? null,
    from_calendar_id: fromCalendarId,
    calendar_id: draft.calendar_id,
    old_event_id: eventId,
  };
}
