import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { colorIdFor, colorName, createEvent, deleteEvent, editEvent, shapeEvent } from '../dist/calendar.js';
import { createServer } from '../dist/server.js';

/**
 * Editing and deleting any event, and colours.
 * See docs/decisions/0013-editing-any-calendar-event.md.
 */

const MINE = {
  id: 'musician1',
  etag: '"100"',
  summary: 'Quartet at St Mary',
  location: 'St Mary',
  start: { dateTime: '2026-10-16T20:00:00+02:00', timeZone: 'Europe/Madrid' },
  end: { dateTime: '2026-10-16T22:00:00+02:00', timeZone: 'Europe/Madrid' },
  organizer: { email: 'me@example.com', self: true },
};

/** Serve one event; record every write. */
const google = (event) => {
  const writes = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    if (method === 'GET') {
      if (String(url).includes('/events?')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(JSON.stringify(event), { status: 200 });
    }
    writes.push({ method, url: String(url), headers: init.headers, body: init.body && JSON.parse(init.body) });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (method === 'PATCH') return new Response(JSON.stringify({ ...event, ...JSON.parse(init.body) }), { status: 200 });
    return new Response(JSON.stringify({ ...JSON.parse(init.body) }), { status: 200 });
  };
  return { fetch, writes };
};

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const withAudit = async (run) => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-audit-'));
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = join(dir, 'writes.log');
  try {
    await run();
    return (await readFile(join(dir, 'writes.log'), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
    await rm(dir, { recursive: true, force: true });
  }
};

// ------------------------------------------------------------------ colours

test('colours are read by the names Google Calendar shows', () => {
  assert.equal(colorName('11'), 'Tomato');
  assert.equal(colorName(undefined), 'calendar default');
  assert.equal(shapeEvent({ ...MINE, colorId: '2' }).color, 'Sage');
  assert.equal(shapeEvent(MINE).color, 'calendar default');
});

test('a colour name maps to its id, default clears it, and anything else is refused', () => {
  assert.equal(colorIdFor('Basil'), '10');
  assert.equal(colorIdFor('tomato'), '11');
  assert.equal(colorIdFor('default'), null);
  assert.throws(() => colorIdFor('Crimson'), /Lavender, Sage/);
});

test('a created event carries its colour, and the id does not depend on it', async () => {
  const params = {
    summary: 'Quartet at St Mary',
    start: '2026-10-16T20:00:00',
    end: '2026-10-16T22:00:00',
    time_zone: 'Europe/Madrid',
  };
  const plain = google({});
  await withAudit(() => withFetch(plain.fetch, () => createEvent('t', params)));
  const coloured = google({});
  await withAudit(() => withFetch(coloured.fetch, () => createEvent('t', { ...params, color: 'Tomato' })));

  assert.equal(coloured.writes[0].body.colorId, '11');
  assert.equal(plain.writes[0].body.colorId, undefined);
  // Every id minted before 0013 stays the id of that event.
  assert.equal(coloured.writes[0].body.id, plain.writes[0].body.id);
});

// ------------------------------------------------------------------ editing

test('an edit writes nothing until it is confirmed', async () => {
  const g = google(MINE);
  const preview = await withFetch(g.fetch, () =>
    editEvent('t', { event_id: 'musician1', location: 'Palau de la Música', color: 'Basil' }),
  );
  assert.equal(g.writes.length, 0);
  assert.equal(preview.changed, null);
  assert.match(preview.changes, /St Mary → Palau de la Música/);
  assert.match(preview.changes, /calendar default → Basil/);
  assert.match(preview.confirmation_token, /^[0-9a-f]{16}$/);
});

test('a confirmed edit is one PATCH, guarded by the etag, with a pre-image', async () => {
  const params = { event_id: 'musician1', location: 'Palau de la Música', color: 'Basil' };
  const { confirmation_token } = await withFetch(google(MINE).fetch, () => editEvent('t', params));

  const g = google(MINE);
  const audit = await withAudit(() =>
    withFetch(g.fetch, () => editEvent('t', { ...params, confirmation_token })),
  );
  assert.equal(g.writes.length, 1);
  const [patch] = g.writes;
  assert.equal(patch.method, 'PATCH');
  assert.match(patch.url, /\/events\/musician1\?sendUpdates=none$/);
  assert.equal(patch.headers['if-match'], '"100"');
  assert.deepEqual(patch.body, { location: 'Palau de la Música', colorId: '10' });

  assert.equal(audit[0].operation, 'edit_calendar_event');
  assert.equal(JSON.parse(audit[0].pre_image).location, 'St Mary');
});

test('a token for one change does not confirm another', async () => {
  const { confirmation_token } = await withFetch(google(MINE).fetch, () =>
    editEvent('t', { event_id: 'musician1', location: 'Palau' }),
  );
  const g = google(MINE);
  await assert.rejects(
    withFetch(g.fetch, () =>
      editEvent('t', { event_id: 'musician1', location: 'Somewhere else', confirmation_token }),
    ),
    /does not match/,
  );
  assert.equal(g.writes.length, 0);
});

test('a token goes stale when the event changes after the preview', async () => {
  const params = { event_id: 'musician1', summary: 'Quartet, late show' };
  const { confirmation_token } = await withFetch(google(MINE).fetch, () => editEvent('t', params));
  const g = google({ ...MINE, etag: '"101"' });
  await assert.rejects(
    withFetch(g.fetch, () => editEvent('t', { ...params, confirmation_token })),
    /does not match/,
  );
  assert.equal(g.writes.length, 0);
});

test('an edit keeps every rule a create keeps', async () => {
  const g = google(MINE);
  await withFetch(g.fetch, async () => {
    await assert.rejects(editEvent('t', { event_id: 'musician1' }), /Name what to change/);
    await assert.rejects(
      editEvent('t', { event_id: 'musician1', start: '2026-10-16T21:00:00' }),
      /start and end together/,
    );
    await assert.rejects(editEvent('t', { event_id: 'musician1', location: 'TBC' }), /not settled/);
    await assert.rejects(
      editEvent('t', {
        event_id: 'musician1',
        start: '2026-10-16T22:00:00',
        end: '2026-10-16T21:00:00',
      }),
      /ends before it starts/,
    );
  });
  assert.equal(g.writes.length, 0);
});

test('an edit is not refused for an unsettled value it does not touch', async () => {
  const g = google({ ...MINE, location: 'TBC' });
  const preview = await withFetch(g.fetch, () => editEvent('t', { event_id: 'musician1', color: 'Grape' }));
  assert.equal(preview.changed, null);
});

for (const [name, event, pattern] of [
  ['an invitation from someone else', { ...MINE, organizer: { email: 'venue@x.com', self: false }, attendees: [{ email: 'me@example.com', self: true }] }, /invitation/],
  ['a whole recurring series', { ...MINE, recurrence: ['RRULE:FREQ=WEEKLY'] }, /recurring series/],
  ['a focus-time entry', { ...MINE, eventType: 'focusTime' }, /focusTime/],
]) {
  test(`${name} can be neither edited nor deleted`, async () => {
    const g = google(event);
    await withFetch(g.fetch, async () => {
      await assert.rejects(editEvent('t', { event_id: 'musician1', color: 'Sage' }), pattern);
      await assert.rejects(deleteEvent('t', { event_id: 'musician1' }), pattern);
    });
    assert.equal(g.writes.length, 0);
  });
}

test('attendees are named in the confirmation, since their copies change too', async () => {
  const g = google({ ...MINE, attendees: [{ email: 'me@example.com', self: true }, { email: 'cello@x.com' }] });
  const preview = await withFetch(g.fetch, () => editEvent('t', { event_id: 'musician1', color: 'Sage' }));
  assert.match(preview.attendees, /1 other attendee/);
  assert.match(preview.attendees, /none of them is emailed/);
});

// --------------------------------------------------------- deleting any event

test('a confirmed delete of the musician’s event is silent and keeps a pre-image', async () => {
  const { confirmation_token } = await withFetch(google(MINE).fetch, () =>
    deleteEvent('t', { event_id: 'musician1' }),
  );
  const g = google(MINE);
  const audit = await withAudit(() =>
    withFetch(g.fetch, () => deleteEvent('t', { event_id: 'musician1', confirmation_token })),
  );
  assert.equal(g.writes.length, 1);
  assert.match(g.writes[0].url, /\/events\/musician1\?sendUpdates=none$/);
  assert.equal(JSON.parse(audit[0].pre_image).summary, 'Quartet at St Mary');
});

test('a wrong token deletes nothing', async () => {
  const g = google(MINE);
  await assert.rejects(
    withFetch(g.fetch, () => deleteEvent('t', { event_id: 'musician1', confirmation_token: 'deadbeefdeadbeef' })),
    /does not match/,
  );
  assert.equal(g.writes.length, 0);
});

test('an event artist-mcp created still goes in one call', async () => {
  const g = google({ ...MINE, id: 'artistabc' });
  const result = await withAudit(() => withFetch(g.fetch, () => deleteEvent('t', { event_id: 'artistabc' })));
  assert.equal(g.writes.length, 1);
  assert.ok(result);
});

// -------------------------------------------------------------------- tools

test('editing needs both calendar grants, and nobody is asked for a new one', async () => {
  const names = async (grants) =>
    Object.keys((await createServer(async () => ({}), grants))._registeredTools);
  assert.ok((await names(['calendar-create', 'calendar-delete'])).includes('edit_calendar_event'));
  assert.ok(!(await names(['calendar-create'])).includes('edit_calendar_event'));
  assert.ok(!(await names(['calendar-delete'])).includes('edit_calendar_event'));
});

test('the preview tells the reader to wait for a yes before confirming', async () => {
  const server = await createServer(
    async () => ({
      changed: null,
      before: 'Title: X',
      changes: 'Colour: calendar default → Sage',
      attendees: null,
      confirmation_token: 'abc',
      calendar_id: 'primary',
    }),
    ['calendar-create', 'calendar-delete'],
  );
  const result = await server._registeredTools.edit_calendar_event.handler({ event_id: 'e', color: 'Sage' });
  assert.match(result.content[0].text, /Not changed yet/);
  assert.match(result.content[0].text, /after their yes/);
});
