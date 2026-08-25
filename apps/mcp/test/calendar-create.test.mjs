import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  confirmationToken,
  createEvent,
  idempotencyId,
  previewEvent,
  refuseUnsettled,
} from '../dist/calendar.js';
import { recordWrite, auditPath } from '../dist/audit.js';

/**
 * The write path. Every test here is about something that persists and that
 * other people can see, which is what separates these from the read tests: a
 * wrong read is a wrong answer, a wrong write is on someone's calendar.
 */

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const draft = {
  calendar_id: 'primary',
  summary: 'Quartet at St Mary',
  start: '2026-10-16T20:00:00',
  end: '2026-10-16T22:00:00',
  time_zone: 'Europe/Madrid',
  location: null,
  description: null,
};

const params = {
  calendar_id: 'primary',
  summary: 'Quartet at St Mary',
  start: '2026-10-16T20:00:00',
  end: '2026-10-16T22:00:00',
  time_zone: 'Europe/Madrid',
};

const emptyDay = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });

// ------------------------------------------------------------- the refusals

/**
 * The rule the decision record calls the one that matters most. Two pages
 * disagreeing about a date is what policy:divergence refuses to decide; a
 * write would decide it silently and durably.
 */
test('an unsettled value is refused, in every spelling the pack uses', () => {
  for (const bad of ['UNKNOWN', 'unknown', 'TBC', 'tbd', 'Venue ??', 'St Mary (TBC)']) {
    assert.throws(
      () => refuseUnsettled({ ...draft, location: bad }),
      /not settled/,
      `${bad} was not refused`,
    );
  }
  // And it says which field, so the musician knows what to settle.
  assert.throws(() => refuseUnsettled({ ...draft, summary: 'Wedding TBC' }), /The title is not settled/);
});

test('a settled value that merely contains those letters is not refused', () => {
  assert.doesNotThrow(() => refuseUnsettled({ ...draft, summary: 'Unknown Pleasures tribute night' }));
  assert.doesNotThrow(() => refuseUnsettled({ ...draft, location: 'Tbilisi Hall' }));
});

test('a timed event with no time zone is refused rather than guessed', async () => {
  const { time_zone, ...noZone } = params;
  await assert.rejects(
    () => withFetch(emptyDay, () => previewEvent('t', noZone)),
    /time_zone is required/,
  );
});

test('a mismatched start and end kind is refused', async () => {
  await assert.rejects(
    () => withFetch(emptyDay, () => previewEvent('t', { ...params, start: '2026-10-16' })),
    /same kind/,
  );
});

test('an event that ends before it starts is refused', async () => {
  await assert.rejects(
    () => withFetch(emptyDay, () => previewEvent('t', { ...params, end: '2026-10-16T19:00:00' })),
    /ends before it starts/,
  );
});

// --------------------------------------------------------------- the binding

test('a create with no token is refused, and says where the token comes from', async () => {
  await assert.rejects(
    () => withFetch(emptyDay, () => createEvent('t', params)),
    /preview_calendar_event first/,
  );
});

/**
 * The property the whole two-tool shape exists for: previewing one event and
 * creating another is not expressible.
 */
test('a token from a different event does not create this one', async () => {
  const other = await confirmationToken({ ...draft, summary: 'Something else entirely' });
  await assert.rejects(
    () => withFetch(emptyDay, () => createEvent('t', { ...params, confirmation_token: other })),
    /does not match this event/,
  );
});

test('changing any field after the preview invalidates the token', async () => {
  const token = await confirmationToken(draft);
  for (const changed of [
    { summary: 'Quartet at St Marys' },
    // Shifted whole, so this fails on the token rather than on validation.
    { start: '2026-10-17T20:00:00', end: '2026-10-17T22:00:00' },
    { time_zone: 'Europe/London' },
    { location: 'added later' },
    { calendar_id: 'other@group.calendar.google.com' },
  ]) {
    await assert.rejects(
      () =>
        withFetch(emptyDay, () =>
          createEvent('t', { ...params, ...changed, confirmation_token: token }),
        ),
      /does not match this event/,
      `${JSON.stringify(changed)} still matched the old token`,
    );
  }
});

test('the matching token creates the event, once', async () => {
  const token = await confirmationToken(draft);
  let posted;
  const result = await withFetch(
    async (url, init) => {
      if (init?.method === 'POST') {
        posted = { url, body: JSON.parse(init.body) };
        return new Response(
          JSON.stringify({ id: posted.body.id, summary: draft.summary, htmlLink: 'https://cal/x' }),
          { status: 200 },
        );
      }
      return emptyDay();
    },
    () => createEvent('t', { ...params, confirmation_token: token }),
  );

  assert.match(posted.url, /\/calendars\/primary\/events$/);
  assert.equal(posted.body.summary, draft.summary);
  // Timed events must carry their zone to Google, not an ambient local one.
  assert.equal(posted.body.start.timeZone, 'Europe/Madrid');
  assert.equal(posted.body.start.dateTime, draft.start);
  assert.equal(result.link, 'https://cal/x');
});

test('an all-day event is sent as a date, not a midnight date-time', async () => {
  const allDay = { ...draft, start: '2026-10-16', end: '2026-10-17', time_zone: null };
  const token = await confirmationToken(allDay);
  let body;
  await withFetch(
    async (url, init) => {
      if (init?.method === 'POST') {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ id: body.id }), { status: 200 });
      }
      return emptyDay();
    },
    () =>
      createEvent('t', {
        calendar_id: 'primary',
        summary: allDay.summary,
        start: '2026-10-16',
        end: '2026-10-17',
        confirmation_token: token,
      }),
  );
  assert.equal(body.start.date, '2026-10-16');
  assert.equal(body.start.dateTime, undefined);
});

// ---------------------------------------------------------- double booking

/**
 * Derived independently of the confirmation token, so that dropping the token
 * requirement later cannot silently drop double-booking protection.
 */
test('the event id is stable for a payload and differs from its token', async () => {
  const id = await idempotencyId(draft);
  assert.equal(id, await idempotencyId({ ...draft }));
  assert.notEqual(id, await confirmationToken(draft));
  // Google's rules: base32hex, 5 to 1024 characters.
  assert.match(id, /^[0-9a-v]{5,1024}$/);
  assert.notEqual(id, await idempotencyId({ ...draft, start: '2026-10-17T20:00:00' }));
});

test('a duplicate is reported as already there, not as a failure', async () => {
  const token = await confirmationToken(draft);
  const err = await withFetch(
    async (url, init) =>
      init?.method === 'POST'
        ? new Response('{"error":{"message":"duplicate"}}', { status: 409 })
        : emptyDay(),
    () => createEvent('t', { ...params, confirmation_token: token }).then(() => null, (e) => e),
  );
  assert.match(err.message, /already in the calendar/);
  assert.doesNotMatch(err.message, /refused/);
});

/**
 * A create is never retried. A repeated read is free; a repeated create can
 * double-book, and a 5xx does not say whether the event was made.
 */
test('a failed create is attempted exactly once', async () => {
  const token = await confirmationToken(draft);
  let posts = 0;
  await withFetch(
    async (url, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        return new Response('{"error":{"message":"boom"}}', { status: 500 });
      }
      return emptyDay();
    },
    () => createEvent('t', { ...params, confirmation_token: token }).then(() => null, () => null),
  );
  assert.equal(posts, 1);
});

// -------------------------------------------------------------- the preview

test('the preview shows the day alongside what would be written', async () => {
  const result = await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          items: [{ id: 'a', summary: 'Rehearsal', start: { dateTime: '2026-10-16T10:00:00Z' } }],
        }),
        { status: 200 },
      ),
    () => previewEvent('t', params),
  );

  assert.equal(result.existing_that_day.length, 1);
  assert.match(result.preview, /Quartet at St Mary/);
  assert.match(result.preview, /Europe\/Madrid/);
  assert.equal(result.confirmation_token, await confirmationToken(draft));
});

// ---------------------------------------------------------------- the audit

test('a write leaves a line naming what, where and from which page', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-audit-'));
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = join(dir, 'writes.log');
  try {
    await recordWrite({
      operation: 'create_calendar_event',
      summary: 'Quartet at St Mary',
      target: 'primary/abc',
      source_page: 'page-id-1',
    });
    const line = JSON.parse(await readFile(auditPath(), 'utf8'));
    assert.equal(line.target, 'primary/abc');
    assert.equal(line.source_page, 'page-id-1');
    assert.ok(line.at, 'no timestamp');
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The event exists by the time this runs. Throwing would report a successful
 * write as a failure, which is the one outcome guaranteed to make someone
 * create it a second time.
 */
test('an unwritable audit does not turn a successful write into a failure', async () => {
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = '/proc/nonexistent/writes.log';
  try {
    await recordWrite({ operation: 'x', summary: 'y', target: 'z' });
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
  }
});
