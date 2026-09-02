import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';

/**
 * "No events in that window" is true of one calendar and reads as true of the
 * diary. A gig on a band or venue calendar is exactly the case that makes it
 * wrong, and the tool description used to handle it by asking the reader to go
 * and call list_calendars before reporting an absence.
 *
 * A rule the tool can apply itself beats one it asks the reader to remember,
 * so the empty result now carries the set it was measured against.
 */

const serverWith = (calendars, { calendarsFail = false } = {}) => {
  const calls = [];
  return {
    calls,
    server: createServer(async (op, params) => {
      calls.push(op);
      if (op === 'list_events') return { events: [], omitted_occurrences: 0, ...params };
      if (op === 'list_calendars') {
        if (calendarsFail) throw new Error('insufficient scope');
        return { calendars, complete: true, limitation: null };
      }
      throw new Error(`unexpected ${op}`);
    }, []),
  };
};

const CALENDARS = [
  { id: 'primary', summary: 'Personal', primary: true, access_role: 'owner', time_zone: null },
  { id: 'band@group.calendar.google.com', summary: 'Quartet gigs', primary: false, access_role: 'reader', time_zone: null },
  { id: 'venue@group.calendar.google.com', summary: 'Konzerthaus', primary: false, access_role: 'reader', time_zone: null },
];

const listEvents = async (fixture, args = {}) => {
  const server = await fixture.server;
  return (await server._registeredTools.list_events.handler(args)).content
    .map((c) => c.text)
    .join('');
};

test('an empty result names the calendars it did not search', async () => {
  const fixture = serverWith(CALENDARS);
  const text = await listEvents(fixture);

  assert.match(text, /No events in that window on your primary calendar/);
  assert.match(text, /2 other calendars/);
  assert.match(text, /Quartet gigs/);
  assert.match(text, /Konzerthaus/);
  assert.doesNotMatch(text, /Personal/, 'the one it searched is not offered as unsearched');
});

test('an explicit calendar_id is the one excluded, not the primary', async () => {
  const fixture = serverWith(CALENDARS);
  const text = await listEvents(fixture, { calendar_id: 'band@group.calendar.google.com' });

  assert.match(text, /on band@group\.calendar\.google\.com/);
  assert.match(text, /Personal/);
  assert.match(text, /Konzerthaus/);
  assert.doesNotMatch(text, /Quartet gigs/);
});

test('one calendar on the account makes the absence complete, and says so', async () => {
  const fixture = serverWith([CALENDARS[0]]);
  const text = await listEvents(fixture);
  assert.match(text, /only calendar on the account/);
});

test('a connection that cannot list calendars degrades, it does not fail', async () => {
  const fixture = serverWith(CALENDARS, { calendarsFail: true });
  const text = await listEvents(fixture);

  assert.match(text, /No events in that window/);
  assert.match(text, /could not be listed/);
  assert.match(text, /Do not report a clean absence/);
});

test('a result with events costs no extra call', async () => {
  const calls = [];
  const server = await createServer(async (op) => {
    calls.push(op);
    if (op === 'list_events') {
      return {
        events: [{ id: 'e1', summary: 'Soundcheck', start: '2027-06-19T15:00:00', recurring: false }],
        omitted_occurrences: 0,
      };
    }
    throw new Error(`unexpected ${op}`);
  }, []);

  await server._registeredTools.list_events.handler({});
  assert.deepEqual(calls, ['list_events'], 'the calendar list is only worth fetching for an absence');
});

/**
 * Issue #139 established that mapping downloads the whole file and extracts all
 * of it. The description went on saying it "costs one small call" for a while
 * after, which is the claim that makes a reader choose it to look at less
 * rather than to say less.
 */
test('the map tools do not claim to be a cheap look', async () => {
  const server = await createServer(async () => ({}), []);
  for (const name of ['map_gmail_attachment', 'map_page_attachment']) {
    const description = server._registeredTools[name].description;
    assert.doesNotMatch(description, /small call|cheap|costs one/i, `${name} oversells its cost`);
    assert.match(description, /opens the whole file/, `${name} should say what it actually opens`);
  }
});
