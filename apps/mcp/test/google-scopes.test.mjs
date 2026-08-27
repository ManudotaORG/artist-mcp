import assert from 'node:assert/strict';
import test from 'node:test';

import { PROVIDERS, WRITE_SCOPES, scopesFor } from '../dist/oauth.js';

test('Google is asked for exactly the sanctioned scopes, all of them read-only', () => {
  assert.deepEqual(PROVIDERS.google.scope.split(' '), [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  ]);
});

/**
 * The narrower check that survives a write shipping. Every scope above happens
 * to end in `.readonly` today; the first write scope will not, and at that
 * point this test is the one that has to be edited deliberately rather than
 * silently passing because someone appended to the list above.
 */
test('no write-capable Google scope is requested unconditionally', () => {
  const writeCapable = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ];
  const asked = PROVIDERS.google.scope.split(' ');
  const found = asked.filter((s) => writeCapable.includes(s));
  assert.deepEqual(
    found,
    [],
    `A write-capable scope is requested for every user: ${found.join(', ')}. ` +
      'A write scope belongs behind a grant, not in the default consent screen.',
  );
});

test('Microsoft is unchanged and still read-only', () => {
  assert.equal(PROVIDERS.microsoft.scope, 'offline_access Notes.Read');
});


/**
 * The grant has to reach the consent screen, or it gates the tools while
 * leaving the token unable to use them — every create would 403, and the
 * failure would look like a Google problem rather than a missing scope.
 */
test('a granted install asks for the write scope, on top of the reads', () => {
  const asked = scopesFor('google', ['calendar-create']).split(' ');
  assert.ok(asked.includes('https://www.googleapis.com/auth/calendar.events'));
  // The reads are still there: writing does not replace the evidence scopes.
  for (const base of PROVIDERS.google.scope.split(' ')) {
    assert.ok(asked.includes(base), `${base} was dropped`);
  }
});

test('an ungranted install asks for exactly the read-only set', () => {
  assert.equal(scopesFor('google', []), PROVIDERS.google.scope);
  assert.equal(scopesFor('google'), PROVIDERS.google.scope);
});

test('a grant never widens Microsoft', () => {
  assert.equal(scopesFor('microsoft', ['calendar-create']), PROVIDERS.microsoft.scope);
});

test('every capability maps to at least one scope, or the grant is inert', () => {
  for (const [name, scopes] of Object.entries(WRITE_SCOPES)) {
    assert.ok(scopes.length > 0, `${name} grants a tool but no scope to use it`);
  }
});
