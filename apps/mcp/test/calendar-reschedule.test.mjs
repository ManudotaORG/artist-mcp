import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { idempotencyId, previewRescheduleEvent, rescheduleEvent } from '../dist/calendar.js';

/**
 * Rescheduling is a create and a delete, so everything here is about something
 * that persists on someone else's calendar. The order of those two writes is
 * the design, and most of these tests exist to hold it in place.
 */

process.env.ARTIST_MCP_AUDIT = join(
  await mkdtemp(join(tmpdir(), 'artist-reschedule-')),
  'writes.log',
);

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const OLD_DRAFT = {
  calendar_id: 'material',
  summary: '[Saarbrücken] Noten an die Musiker',
  start: '2026-11-17',
  end: '2026-11-18',
  time_zone: null,
  location: null,
  description: null,
};

/** The id an event created from OLD_DRAFT would really carry. */
const oldId = await idempotencyId(OLD_DRAFT);

const existing = {
  id: oldId,
  summary: OLD_DRAFT.summary,
  start: { date: OLD_DRAFT.start },
  end: { date: OLD_DRAFT.end },
};

/** Move it a week later, everything else unchanged. */
const move = {
  event_id: oldId,
  calendar_id: 'material',
  summary: OLD_DRAFT.summary,
  start: '2026-11-24',
  end: '2026-11-25',
};

/**
 * A calendar that answers the fetch of the existing event, an empty destination
 * day, an insert, and a delete — recording what it was asked to do.
 */
const stubCalendar = ({ insertFails = false, deleteFails = false } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = String(url);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${path.replace('https://www.googleapis.com/calendar/v3', '')}`);

    if (method === 'POST') {
      if (insertFails) return new Response('{"error":{"message":"boom"}}', { status: 500 });
      return new Response(JSON.stringify({ id: 'artistnew', htmlLink: 'https://cal/new' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'DELETE') {
      if (deleteFails) return new Response('{"error":{"message":"boom"}}', { status: 500 });
      return new Response(null, { status: 204 });
    }
    // A GET for the event itself, or for the destination day's listing.
    if (path.includes(`/events/${oldId}`)) {
      return new Response(JSON.stringify(existing), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
};

const tokenFor = async (params) => {
  const { fetchImpl } = stubCalendar();
  const { confirmation_token } = await withFetch(fetchImpl, () =>
    previewRescheduleEvent('t', params),
  );
  return confirmation_token;
};

// ------------------------------------------------------------- the refusals

/**
 * The rule the whole capability rests on, inherited from delete: an event
 * somebody else made is not this tool's to move any more than it is to remove.
 */
test('an event this tool did not create cannot be rescheduled', async () => {
  const { fetchImpl } = stubCalendar();
  await assert.rejects(
    () =>
      withFetch(fetchImpl, () =>
        previewRescheduleEvent('t', { ...move, event_id: 'someoneElsesEvent' }),
      ),
    /not created by artist-mcp/,
  );
});

test('the refusal says it is a reschedule being refused, not a delete', async () => {
  const { fetchImpl } = stubCalendar();
  await assert.rejects(
    () =>
      withFetch(fetchImpl, () =>
        previewRescheduleEvent('t', { ...move, event_id: 'someoneElsesEvent' }),
      ),
    /cannot be rescheduled here/,
  );
});

/**
 * A slipped deadline is the commonest reason to reach for this, and the
 * commonest way to invent a date nobody chose.
 */
test('an unsettled value is refused rather than written', async () => {
  const { fetchImpl } = stubCalendar();
  await assert.rejects(
    () =>
      withFetch(fetchImpl, () =>
        previewRescheduleEvent('t', { ...move, description: 'Neuer Termin TBC' }),
      ),
    /not settled/,
  );
});

test('rescheduling an event to the values it already has is refused', async () => {
  const { fetchImpl } = stubCalendar();
  await assert.rejects(
    () =>
      withFetch(fetchImpl, () =>
        previewRescheduleEvent('t', {
          event_id: oldId,
          calendar_id: 'material',
          summary: OLD_DRAFT.summary,
          start: OLD_DRAFT.start,
          end: OLD_DRAFT.end,
        }),
      ),
    /nothing to reschedule/,
  );
});

test('no confirmation token means no write', async () => {
  const { fetchImpl, calls } = stubCalendar();
  await assert.rejects(
    () => withFetch(fetchImpl, () => rescheduleEvent('t', move)),
    /No confirmation_token/,
  );
  assert.equal(
    calls.filter((c) => c.startsWith('POST') || c.startsWith('DELETE')).length,
    0,
    'a refused reschedule still wrote something',
  );
});

/** The preview is over both halves, so changing either invalidates it. */
test('a token from a different destination does not authorise this one', async () => {
  const stale = await tokenFor({ ...move, start: '2026-12-01', end: '2026-12-02' });
  const { fetchImpl, calls } = stubCalendar();
  await assert.rejects(
    () =>
      withFetch(fetchImpl, () =>
        rescheduleEvent('t', { ...move, confirmation_token: stale }),
      ),
    /does not match/,
  );
  assert.equal(calls.filter((c) => c.startsWith('POST')).length, 0);
});

// -------------------------------------------------------------- the preview

test('the preview shows both halves and does not write', async () => {
  const { fetchImpl, calls } = stubCalendar();
  const result = await withFetch(fetchImpl, () => previewRescheduleEvent('t', move));

  assert.match(result.before, /2026-11-17 to 2026-11-18/);
  assert.match(result.after, /2026-11-24 to 2026-11-25/);
  assert.match(result.before, /\[Saarbrücken\]/);
  assert.equal(calls.filter((c) => !c.startsWith('GET')).length, 0);
});

test('the preview enumerates the destination, not the dates it is leaving', async () => {
  const { fetchImpl, calls } = stubCalendar();
  await withFetch(fetchImpl, () => previewRescheduleEvent('t', move));
  const listing = calls.find((c) => c.includes('timeMin'));
  assert.ok(listing?.includes('2026-11-24'), `listed the wrong day: ${listing}`);
  assert.ok(!listing?.includes('2026-11-17'), `listed the day it is leaving: ${listing}`);
});

// --------------------------------------------------------------- the writes

/**
 * The order is the design. Interrupted between the two, create-then-delete
 * leaves a visible duplicate; the other order leaves a gap, and nobody notices
 * absence.
 */
test('the new event is written before the old one is removed', async () => {
  const { fetchImpl, calls } = stubCalendar();
  const confirmation_token = await tokenFor(move);
  await withFetch(fetchImpl, () => rescheduleEvent('t', { ...move, confirmation_token }));

  const post = calls.findIndex((c) => c.startsWith('POST'));
  const del = calls.findIndex((c) => c.startsWith('DELETE'));
  assert.ok(post !== -1 && del !== -1, `both writes should happen: ${calls.join(' | ')}`);
  assert.ok(post < del, 'the old event was removed before the replacement existed');
});

test('a failed insert removes nothing', async () => {
  const { fetchImpl, calls } = stubCalendar({ insertFails: true });
  const confirmation_token = await tokenFor(move);
  await assert.rejects(() =>
    withFetch(fetchImpl, () => rescheduleEvent('t', { ...move, confirmation_token })),
  );
  assert.equal(
    calls.filter((c) => c.startsWith('DELETE')).length,
    0,
    'the original was removed even though its replacement was never written',
  );
});

/**
 * The half-completed case. It cannot be hidden: the musician is looking at two
 * events, and the answer has to name the one to remove and where it is.
 */
test('a failed delete reports both events, and names the one left behind', async () => {
  const { fetchImpl } = stubCalendar({ deleteFails: true });
  const confirmation_token = await tokenFor(move);
  await assert.rejects(
    () => withFetch(fetchImpl, () => rescheduleEvent('t', { ...move, confirmation_token })),
    (err) => {
      assert.match(err.message, /both/);
      assert.match(err.message, new RegExp(oldId));
      assert.match(err.message, /material/);
      return true;
    },
  );
});

test('a move to another calendar writes to the destination and deletes from the source', async () => {
  const { fetchImpl, calls } = stubCalendar();
  const params = { ...move, to_calendar_id: 'studium' };
  const confirmation_token = await tokenFor(params);
  const result = await withFetch(fetchImpl, () =>
    rescheduleEvent('t', { ...params, confirmation_token }),
  );

  assert.equal(result.from_calendar_id, 'material');
  assert.equal(result.calendar_id, 'studium');
  assert.ok(calls.some((c) => c.startsWith('POST') && c.includes('studium')));
  assert.ok(calls.some((c) => c.startsWith('DELETE') && c.includes('material')));
});

/** Both halves are audited, so the log stays a record of what reached Google. */
test('both writes are recorded, under their own operation names', async () => {
  const { fetchImpl } = stubCalendar();
  const confirmation_token = await tokenFor(move);
  const recorded = [];
  await withFetch(fetchImpl, () =>
    rescheduleEvent('t', { ...move, confirmation_token }, async (line) => {
      recorded.push(line.operation);
    }),
  );
  assert.deepEqual(recorded, ['create_calendar_event', 'delete_calendar_event']);
});

// ------------------------------------------------ what the preview looks at

/**
 * The start day alone was enough while every event was one day long. A span
 * written straight through an occupied week answered "nothing else is on that
 * day" — true about the one day it looked at, and misleading exactly where it
 * mattered. The window is now the event's whole range.
 */
test('the preview enumerates every day the event would occupy, not just the first', async () => {
  const { fetchImpl, calls } = stubCalendar();
  await withFetch(fetchImpl, () =>
    previewRescheduleEvent('t', { ...move, start: '2026-11-24', end: '2026-12-01' }),
  );

  const listing = calls.find((c) => c.includes('timeMin'));
  assert.ok(listing?.includes('2026-11-24'), `wrong window start: ${listing}`);
  assert.ok(listing?.includes('2026-12-01'), `window stopped short of the end: ${listing}`);
});

test('a single-day event still asks about its own day', async () => {
  const { fetchImpl, calls } = stubCalendar();
  await withFetch(fetchImpl, () => previewRescheduleEvent('t', move));

  const listing = calls.find((c) => c.includes('timeMin'));
  assert.ok(listing?.includes('2026-11-24'), `wrong window start: ${listing}`);
  assert.ok(listing?.includes('2026-11-25'), `wrong window end: ${listing}`);
});
