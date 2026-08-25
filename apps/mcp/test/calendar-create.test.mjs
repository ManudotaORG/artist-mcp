import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  confirmationToken,
  createEvent,
  deleteEvent,
  idempotencyId,
  previewDeleteEvent,
  previewEvent,
  refuseUnsettled,
} from '../dist/calendar.js';
import { recordWrite, auditPath } from '../dist/audit.js';

/**
 * The write path. Every test here is about something that persists and that
 * other people can see, which is what separates these from the read tests: a
 * wrong read is a wrong answer, a wrong write is on someone's calendar.
 */

/**
 * Every test in this file is redirected away from the real audit log before any
 * of them run.
 *
 * Two tests set this per-case already; the ones that simply create an event did
 * not, and so appended stub events to ~/.artist-mcp/writes.log on the machine
 * running the suite. That file exists to trace real writes back to a page, and
 * entries for events that were never created are worse than no file at all.
 * Set at module scope because node --test gives each file its own process.
 */
process.env.ARTIST_MCP_AUDIT = join(
  await mkdtemp(join(tmpdir(), 'artist-audit-suite-')),
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

/**
 * Google reads an all-day `end.date` as exclusive: a gig on the 11th ends on
 * the 12th. Equal dates are an empty range and Google refuses them, and a model
 * that does not know the convention writes it without hesitating — the one that
 * did know got it right, which is not the same as the code being safe.
 */
test('an all-day event ending on its own start date is refused, with the fix', async () => {
  await assert.rejects(
    () =>
      withFetch(emptyDay, () =>
        previewEvent('t', {
          summary: 'Classical Horizons',
          start: '2028-09-11',
          end: '2028-09-11',
        }),
      ),
    /exclusive.*2028-09-12/s,
  );
});

test('a zero-length timed event is refused', async () => {
  await assert.rejects(
    () => withFetch(emptyDay, () => previewEvent('t', { ...params, end: params.start })),
    /same moment/,
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

test('a duplicate still on the calendar is reported as already there', async () => {
  const token = await confirmationToken(draft);
  const err = await withFetch(
    async (url, init) =>
      init?.method === 'POST'
        ? new Response('{"error":{"message":"duplicate"}}', { status: 409 })
        : new Response(JSON.stringify({ id: 'x', status: 'confirmed' }), { status: 200 }),
    () => createEvent('t', { ...params, confirmation_token: token }).then(() => null, (e) => e),
  );
  assert.match(err.message, /already in the calendar/);
  assert.doesNotMatch(err.message, /refused/);
});

/**
 * Confirmed against a real calendar: delete an event, create the same one
 * again, and Google refuses because the trashed event still holds the id.
 * Reporting that as "already in the calendar" sends someone looking for an
 * event they cannot see — it is in the bin, which is a thing they can act on.
 */
test('a duplicate sitting in the bin says so, and says how to get it back', async () => {
  const token = await confirmationToken(draft);
  const err = await withFetch(
    async (url, init) =>
      init?.method === 'POST'
        ? new Response('{"error":{"message":"duplicate"}}', { status: 409 })
        : new Response(JSON.stringify({ id: 'x', status: 'cancelled' }), { status: 200 }),
    () => createEvent('t', { ...params, confirmation_token: token }).then(() => null, (e) => e),
  );
  assert.match(err.message, /bin/);
  assert.match(err.message, /30 days/);
  assert.doesNotMatch(err.message, /already in the calendar/);
});

test('a lookup that fails falls back to the answer that is true either way', async () => {
  const token = await confirmationToken(draft);
  const err = await withFetch(
    async (url, init) =>
      init?.method === 'POST'
        ? new Response('{"error":{"message":"duplicate"}}', { status: 409 })
        : new Response('nope', { status: 500 }),
    () => createEvent('t', { ...params, confirmation_token: token }).then(() => null, (e) => e),
  );
  assert.match(err.message, /already in the calendar|nothing was duplicated/);
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
  // A file standing where a directory would have to be. ENOTDIR on every
  // platform, unlike a path such as /proc/... which exists on Linux and not on
  // macOS and so tests something different depending on where it runs.
  const dir = await mkdtemp(join(tmpdir(), 'artist-audit-'));
  const blocker = join(dir, 'in-the-way');
  await writeFile(blocker, 'not a directory');

  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = join(blocker, 'writes.log');
  try {
    await recordWrite({ operation: 'x', summary: 'y', target: 'z' });
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});


/**
 * The audit used to live in the MCP tool handler, one layer above the write.
 * That made it a record of calls to that layer rather than of writes: the first
 * real run against a real calendar created an event and left no trace at all,
 * because it reached createEvent directly. It belongs where the event is made.
 */
test('creating an event writes the audit line, not the tool that called it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-audit-'));
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = join(dir, 'writes.log');
  try {
    const token = await confirmationToken(draft);
    await withFetch(
      async (url, init) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ id: 'created-id' }), { status: 200 })
          : emptyDay(),
      () => createEvent('t', { ...params, confirmation_token: token, source_page: 'page-7' }),
    );

    const line = JSON.parse(await readFile(join(dir, 'writes.log'), 'utf8'));
    assert.equal(line.operation, 'create_calendar_event');
    assert.equal(line.target, 'primary/created-id');
    assert.equal(line.source_page, 'page-7');
    // What was written, as the musician would read it back — an id alone does
    // not tell someone a week later what they are looking at.
    assert.match(line.summary, /Quartet at St Mary/);
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a refused create leaves no audit line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-audit-'));
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = join(dir, 'writes.log');
  try {
    await withFetch(emptyDay, () => createEvent('t', params).then(() => null, () => null));
    await assert.rejects(() => readFile(join(dir, 'writes.log'), 'utf8'), /ENOENT/);
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});


// ------------------------------------------------------------------ deleting

const ARTIST_EVENT = {
  id: 'artistabc123',
  summary: 'Quartet at St Mary',
  start: { dateTime: '2026-10-16T20:00:00+02:00', timeZone: 'Europe/Madrid' },
  end: { dateTime: '2026-10-16T22:00:00+02:00', timeZone: 'Europe/Madrid' },
};

const serving = (event) => async (url, init) => {
  if (init?.method === 'DELETE') return new Response(null, { status: 204 });
  return new Response(JSON.stringify(event), { status: 200 });
};

/**
 * The rule the whole capability rests on. Without it this is a tool that can
 * remove any event on the calendar, including the gigs the musician typed in
 * themselves and anything a venue shared with them.
 */
test('an event this tool did not create cannot be deleted', async () => {
  for (const id of ['abc123', 'ARTISTabc', 'someoneelse_1', '']) {
    await assert.rejects(
      () => withFetch(serving(ARTIST_EVENT), () => previewDeleteEvent('t', { event_id: id })),
      /not created by artist-mcp|malformed/,
      `${id || '(empty)'} was not refused`,
    );
  }
});

test('the refusal happens before the event is even fetched', async () => {
  let fetched = 0;
  await withFetch(
    async (...args) => {
      fetched += 1;
      return serving(ARTIST_EVENT)(...args);
    },
    () => previewDeleteEvent('t', { event_id: 'notours123' }).then(() => null, () => null),
  );
  // A refusal that depended on reading the event would fail differently for an
  // event that cannot be read, which is not a distinction worth having here.
  assert.equal(fetched, 0);
});

test('a delete with no token is refused', async () => {
  await assert.rejects(
    () => withFetch(serving(ARTIST_EVENT), () => deleteEvent('t', { event_id: ARTIST_EVENT.id })),
    /preview_calendar_delete first/,
  );
});

/**
 * The token is over the event as Google returns it, so an event that changed
 * between preview and delete stops matching — stricter than create, where the
 * payload comes from the caller.
 */
test('an event that changed since the preview stops matching', async () => {
  const { confirmation_token } = await withFetch(serving(ARTIST_EVENT), () =>
    previewDeleteEvent('t', { event_id: ARTIST_EVENT.id }),
  );
  const moved = { ...ARTIST_EVENT, start: { dateTime: '2026-10-20T20:00:00+02:00' } };
  await assert.rejects(
    () =>
      withFetch(serving(moved), () =>
        deleteEvent('t', { event_id: ARTIST_EVENT.id, confirmation_token }),
      ),
    /does not match this event/,
  );
});

test('the matching token deletes it, and records what it said', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-audit-'));
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = join(dir, 'writes.log');
  try {
    const { confirmation_token } = await withFetch(serving(ARTIST_EVENT), () =>
      previewDeleteEvent('t', { event_id: ARTIST_EVENT.id }),
    );

    let deleted;
    await withFetch(
      async (url, init) => {
        if (init?.method === 'DELETE') {
          deleted = String(url);
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify(ARTIST_EVENT), { status: 200 });
      },
      () => deleteEvent('t', { event_id: ARTIST_EVENT.id, confirmation_token }),
    );

    assert.match(deleted, /\/events\/artistabc123$/);

    // The whole event, not a reference to it: nobody notices an absence, so the
    // record has to be enough to put it back by hand.
    const line = JSON.parse(await readFile(join(dir, 'writes.log'), 'utf8'));
    assert.equal(line.operation, 'delete_calendar_event');
    assert.match(line.summary, /Quartet at St Mary/);
    // Written in the event's own zone, not as the UTC instant Google answers
    // with: an audit line is read by a person deciding whether to put the event
    // back, and 18:00Z labelled Europe/Madrid is a 20:00 gig described wrongly.
    assert.match(line.summary, /20:00/);
    assert.match(line.summary, /Europe\/Madrid/);
    assert.doesNotMatch(line.summary, /18:00/);
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Already gone is the same outcome as just removed, from the musician's side.
 * Reporting it as a failure invites a second attempt at something already done.
 */
test('an event already gone is not reported as a failure', async () => {
  const { confirmation_token } = await withFetch(serving(ARTIST_EVENT), () =>
    previewDeleteEvent('t', { event_id: ARTIST_EVENT.id }),
  );
  await withFetch(
    async (url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 410 })
        : new Response(JSON.stringify(ARTIST_EVENT), { status: 200 }),
    () => deleteEvent('t', { event_id: ARTIST_EVENT.id, confirmation_token }),
  );
});

test('a refused delete leaves no audit line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-audit-'));
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = join(dir, 'writes.log');
  try {
    await withFetch(serving(ARTIST_EVENT), () =>
      deleteEvent('t', { event_id: ARTIST_EVENT.id }).then(() => null, () => null),
    );
    await assert.rejects(() => readFile(join(dir, 'writes.log'), 'utf8'), /ENOENT/);
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});


/**
 * The confirmation surface has to be readable by a person, or confirming it
 * means nothing. Found against a real calendar: Google answers with the instant
 * in UTC while the event carries its own zone, and printing both together read
 * as a local time two hours earlier than the gig.
 */
test('a deletion preview shows the time in the event zone, not the UTC instant', async () => {
  const { preview } = await withFetch(serving(ARTIST_EVENT), () =>
    previewDeleteEvent('t', { event_id: ARTIST_EVENT.id }),
  );
  assert.match(preview, /20:00/);
  assert.match(preview, /Europe\/Madrid/);
  assert.doesNotMatch(preview, /18:00/);
});

test('an event with no zone is labelled UTC rather than silently localised', async () => {
  const noZone = {
    ...ARTIST_EVENT,
    start: { dateTime: '2026-10-16T20:00:00Z' },
    end: { dateTime: '2026-10-16T22:00:00Z' },
  };
  const { preview } = await withFetch(serving(noZone), () =>
    previewDeleteEvent('t', { event_id: noZone.id }),
  );
  assert.match(preview, /UTC/);
});


/**
 * The sink is injectable so hosted can write a row instead of a file. Asserted
 * here because the package is where the write happens, and a default that
 * quietly ignored the argument would leave hosted with no audit at all.
 */
test('a caller-supplied recorder is used instead of the file', async () => {
  const recorded = [];
  const token = await confirmationToken(draft);
  await withFetch(
    async (url, init) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ id: 'created-id' }), { status: 200 })
        : emptyDay(),
    () =>
      createEvent('t', { ...params, confirmation_token: token, source_page: 'page-9' }, async (e) =>
        void recorded.push(e),
      ),
  );

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].operation, 'create_calendar_event');
  assert.equal(recorded[0].source_page, 'page-9');
  assert.match(recorded[0].summary, /Quartet at St Mary/);
});

test('a deletion reaches the supplied recorder too', async () => {
  const recorded = [];
  const { confirmation_token } = await withFetch(serving(ARTIST_EVENT), () =>
    previewDeleteEvent('t', { event_id: ARTIST_EVENT.id }),
  );
  await withFetch(serving(ARTIST_EVENT), () =>
    deleteEvent('t', { event_id: ARTIST_EVENT.id, confirmation_token }, async (e) =>
      void recorded.push(e),
    ),
  );
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].operation, 'delete_calendar_event');
  assert.match(recorded[0].summary, /Quartet at St Mary/);
});
