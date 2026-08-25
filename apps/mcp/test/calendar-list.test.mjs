import assert from 'node:assert/strict';
import test from 'node:test';

import { listCalendars } from '../dist/calendar.js';
import { GraphError } from '../dist/client.js';

/**
 * Listing calendars exists to make absence mean something. These pin the two
 * answers that are easy to conflate and must never be: "nothing is on your
 * calendars" and "I could only see one of them".
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

const json = (body) => async () => new Response(JSON.stringify(body), { status: 200 });

const insufficient = async () =>
  new Response(
    JSON.stringify({ error: { message: 'Request had insufficient authentication scopes.' } }),
    { status: 403 },
  );

test('calendars are returned with primary and access role kept', async () => {
  const { calendars, complete, limitation } = await withFetch(
    json({
      items: [
        { id: 'primary@x', summary: 'Manu', primary: true, accessRole: 'owner', timeZone: 'Europe/Madrid' },
        { id: 'band@group.calendar.google.com', summary: 'Quartet', accessRole: 'reader' },
      ],
    }),
    () => listCalendars('t'),
  );

  assert.equal(complete, true);
  assert.equal(limitation, null);
  assert.deepEqual(calendars.map((c) => c.id), ['primary@x', 'band@group.calendar.google.com']);
  assert.equal(calendars[0].primary, true);
  assert.equal(calendars[1].primary, false);
  // Whether a gig could ever be written here is decided by this field.
  assert.equal(calendars[1].access_role, 'reader');
});

/**
 * A calendar the musician removed from their list is not somewhere a gig can
 * be, and offering it invites a look that cannot find anything.
 */
test('deleted entries and entries without an id are dropped', async () => {
  const { calendars } = await withFetch(
    json({
      items: [
        { id: 'a', summary: 'Kept' },
        { id: 'b', summary: 'Gone', deleted: true },
        { summary: 'No id at all' },
      ],
    }),
    () => listCalendars('t'),
  );
  assert.deepEqual(calendars.map((c) => c.summary), ['Kept']);
});

/**
 * The case this whole scope was added for. An older connection cannot list
 * calendars, and that must degrade into a stated limitation rather than an
 * error or, far worse, a confident empty result.
 */
test('an old connection degrades to a stated limitation, not a failure', async () => {
  const { calendars, complete, limitation } = await withFetch(insufficient, () =>
    listCalendars('t'),
  );

  assert.equal(complete, false);
  assert.deepEqual(calendars, []);
  assert.match(limitation, /Only the primary calendar could be searched/);
  // It must say what follows from that, not merely that a scope is missing.
  assert.match(limitation, /would not have been found/);
  assert.match(limitation, /connect google/i);
});

/**
 * The catch above is narrow on purpose. A real fault must not be swallowed into
 * a cheerful partial answer, which is exactly how a broken integration would
 * come to look like an empty diary.
 */
test('a genuine failure still throws', async () => {
  const err = await withFetch(
    async () => new Response('{"error":{"message":"boom"}}', { status: 500 }),
    () => listCalendars('t').then(() => null, (e) => e),
  );
  assert.ok(err instanceof GraphError);
  assert.doesNotMatch(err.message, /Only the primary calendar/);
});

test('a 401 is not mistaken for a scope gap', async () => {
  const err = await withFetch(
    async () => new Response('{"error":{"message":"Invalid Credentials"}}', { status: 401 }),
    () => listCalendars('t').then(() => null, (e) => e),
  );
  assert.ok(err instanceof GraphError);
  assert.doesNotMatch(err.message, /Only the primary calendar/);
});
