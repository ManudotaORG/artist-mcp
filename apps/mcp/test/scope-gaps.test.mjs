import assert from 'node:assert/strict';
import test from 'node:test';

import { CALENDAR_LIST_NEED, getWithRetry } from '../dist/api.js';
import { GraphError, ScopeError } from '../dist/client.js';

/**
 * A 403 for a missing scope is the one failure that is neither a fault nor
 * transient. A refresh token carries the scopes it was granted with, so it will
 * fail identically forever until the user reconnects — and what to tell them
 * depends entirely on what was missing.
 *
 * The bug these exist to prevent: telling a musician whose calendar reading
 * works perfectly that their "connection predates Google Calendar access",
 * because a newer, narrower scope was the thing actually refused.
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

const insufficient = () =>
  new Response(
    JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.' } }),
    { status: 403 },
  );

test('a missing optional scope degrades: it names the gap and does not demand a reconnect', async () => {
  const err = await withFetch(insufficient, () =>
    getWithRetry('https://example.test/users/me/calendarList', 't', 'Google Calendar', CALENDAR_LIST_NEED)
      .then(() => null, (e) => e),
  );

  assert.ok(err instanceof ScopeError);
  assert.equal(err.optional, true);
  assert.equal(err.capability, 'see which calendars you have');
  // The distinction that matters to the reader: their setup is not broken.
  assert.equal(err.reconnectNeeded, false);
  assert.match(err.message, /Everything else still works/);
  assert.doesNotMatch(err.message, /predates/);
});

test('a missing required scope still reads as a reconnect', async () => {
  const err = await withFetch(insufficient, () =>
    getWithRetry('https://example.test/calendars/primary/events', 't', 'Google Calendar', {
      capability: 'read your calendar',
      optional: false,
    }).then(() => null, (e) => e),
  );

  assert.ok(err instanceof ScopeError);
  assert.equal(err.optional, false);
  assert.equal(err.reconnectNeeded, true);
  assert.match(err.message, /connect google/i);
});

/**
 * The path that existed before this change. A call that declares nothing keeps
 * the old wording, so nothing that already worked started saying something new.
 */
test('a call that declares no need keeps the original message', async () => {
  const err = await withFetch(insufficient, () =>
    getWithRetry('https://example.test/x', 't', 'Gmail').then(() => null, (e) => e),
  );

  assert.ok(err instanceof GraphError);
  assert.ok(!(err instanceof ScopeError));
  assert.equal(err.reconnectNeeded, true);
  assert.match(err.message, /predates Gmail access/);
});

/**
 * A scope gap is permanent until the user acts, so retrying it spends the
 * user's time to be told the same thing three more times.
 */
test('a scope gap is not retried', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return insufficient();
    },
    () =>
      getWithRetry('https://example.test/x', 't', 'Google Calendar', CALENDAR_LIST_NEED).then(
        () => null,
        () => null,
      ),
  );
  assert.equal(calls, 1);
});

test('a ScopeError is still a GraphError, so existing handling keeps working', () => {
  assert.ok(new ScopeError('x', 'y', true) instanceof GraphError);
});
