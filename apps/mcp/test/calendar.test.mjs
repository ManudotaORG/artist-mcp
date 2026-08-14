import assert from 'node:assert/strict';
import test from 'node:test';

import { eventTime, shapeEvent, thinRecurring } from '../dist/calendar.js';

/**
 * Ported from supabase/functions/graph/index.test.ts with the code they cover.
 * Both normalisations here fail silently when they fail: an all-day event reads
 * as no event at all, and an unthinned weekly series fills a page so nothing
 * else that week is visible.
 */
const assertIncludes = (haystack, needle) =>
  assert.ok(String(haystack).includes(needle), `expected ${needle} in ${haystack}`);

test("eventTime reads a timed event", () => {
  assert.deepEqual(
    eventTime({ dateTime: "2026-09-14T19:30:00+02:00", timeZone: "Europe/Madrid" }),
    { value: "2026-09-14T19:30:00+02:00", all_day: false, time_zone: "Europe/Madrid" },
  );
});

test("eventTime reads an all-day event", () => {
  // A festival or tour block arrives as `date`, never `dateTime`. Code that
  // reads only dateTime returns null here and the event looks contentless.
  assert.deepEqual(
    eventTime({ date: "2026-09-14" }),
    { value: "2026-09-14", all_day: true, time_zone: null },
  );
});

test("eventTime tolerates a missing time", () => {
  assert.deepEqual(eventTime(undefined), { value: null, all_day: false, time_zone: null });
});

test("shapeEvent keeps an all-day event's dates", () => {
  const e = shapeEvent({
    id: "abc",
    summary: "Tour block",
    start: { date: "2026-09-14" },
    end: { date: "2026-09-18" },
  });
  assert.deepEqual(e.start, "2026-09-14");
  assert.deepEqual(e.end, "2026-09-18");
  assert.deepEqual(e.all_day, true);
});

test("shapeEvent flags a recurring instance", () => {
  // "every Tuesday" and "this Tuesday" are different claims about a page, so
  // the distinction has to survive into the output.
  const once = shapeEvent({ id: "a", start: { dateTime: "2026-09-14T10:00:00Z" } });
  const series = shapeEvent({
    id: "b_20260914T100000Z",
    recurringEventId: "b",
    start: { dateTime: "2026-09-14T10:00:00Z" },
  });
  assert.deepEqual(once.recurring, false);
  assert.deepEqual(series.recurring, true);
});

test("shapeEvent falls back to a placeholder title", () => {
  assert.deepEqual(shapeEvent({ id: "a" }).summary, "(no title)");
});

test("shapeEvent carries the time zone from whichever end has one", () => {
  const e = shapeEvent({
    id: "a",
    start: { dateTime: "2026-09-14T19:30:00+02:00" },
    end: { dateTime: "2026-09-14T22:00:00+02:00", timeZone: "Europe/Madrid" },
  });
  assert.deepEqual(e.time_zone, "Europe/Madrid");
});

test("shapeEvent preserves status so a cancelled event reads as cancelled", () => {
  assert.deepEqual(shapeEvent({ id: "a", status: "cancelled" }).status, "cancelled");
});

test("thinRecurring caps one series without touching single events", () => {
  // The shape a real calendar produced: a weekly rehearsal expanded to 50
  // occurrences and pushed every other event off the page.
  const events = [
    { id: "concert", start: { dateTime: "2026-08-14T15:00:00Z" } },
    ...Array.from({ length: 50 }, (_, i) => ({
      id: `r_${i}`,
      recurringEventId: "rehearsal",
      start: { dateTime: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T14:00:00Z` },
    })),
    { id: "tour", start: { date: "2026-08-20" } },
  ];

  const { kept, omitted } = thinRecurring(events, 3);
  assert.deepEqual(omitted, 47);
  assert.deepEqual(kept.filter((e) => e.recurringEventId).length, 3);
  // Both one-off events survive, which is the point of the exercise.
  assert.deepEqual(kept.some((e) => e.id === "concert"), true);
  assert.deepEqual(kept.some((e) => e.id === "tour"), true);
});

test("thinRecurring counts each series separately", () => {
  const events = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, recurringEventId: "a" })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, recurringEventId: "b" })),
  ];
  const { kept, omitted } = thinRecurring(events, 2);
  assert.deepEqual(kept.length, 4);
  assert.deepEqual(omitted, 6);
});

test("thinRecurring leaves a calendar of one-offs alone", () => {
  const events = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}` }));
  const { kept, omitted } = thinRecurring(events, 3);
  assert.deepEqual(kept.length, 10);
  assert.deepEqual(omitted, 0);
});
