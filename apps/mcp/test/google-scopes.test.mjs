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

test('every user is still asked for a read-only Microsoft scope', () => {
  assert.equal(PROVIDERS.microsoft.scope, 'offline_access Notes.Read');
});

/**
 * The same rule as the Google test above, now that Microsoft can be widened
 * too: `Notes.Create` belongs behind a grant, not on the consent screen every
 * install sees. Written as a scan for any Notes scope beyond Notes.Read so
 * that Notes.ReadWrite — the one that would undo 0003 entirely — is caught by
 * the same assertion rather than needing to be predicted.
 */
test('no write-capable Microsoft scope is requested unconditionally', () => {
  const asked = PROVIDERS.microsoft.scope.split(' ');
  const found = asked.filter((s) => s.startsWith('Notes.') && s !== 'Notes.Read');
  assert.deepEqual(
    found,
    [],
    `A write-capable scope is requested for every user: ${found.join(', ')}.`,
  );
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

/**
 * A capability's scope must reach its own provider's consent screen and no
 * other. This used to read "a grant never widens Microsoft", which was true
 * only while Google was the sole writable provider; stated that way it would
 * now pass while `Notes.Create` was quietly being asked of Google.
 */
test('a grant widens its own provider and never the other', () => {
  assert.equal(scopesFor('microsoft', ['calendar-create']), PROVIDERS.microsoft.scope);
  assert.equal(scopesFor('google', ['onenote-create']), PROVIDERS.google.scope);

  assert.ok(scopesFor('microsoft', ['onenote-create']).split(' ').includes('Notes.Create'));
  assert.ok(
    !scopesFor('google', ['onenote-create', 'calendar-create']).includes('Notes.Create'),
    'Notes.Create reached a Google consent screen, which Google rejects.',
  );
});

test('an install holding both providers asks each for only its own writes', () => {
  const both = ['calendar-create', 'onenote-create'];
  const ms = scopesFor('microsoft', both).split(' ');
  const google = scopesFor('google', both).split(' ');

  assert.ok(ms.includes('Notes.Create'));
  assert.ok(!ms.some((s) => s.startsWith('https://www.googleapis.com/')));
  assert.ok(google.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.ok(!google.includes('Notes.Create'));

  // The reads survive on both sides: a write grant adds, it never replaces.
  for (const base of PROVIDERS.microsoft.scope.split(' ')) assert.ok(ms.includes(base), base);
  for (const base of PROVIDERS.google.scope.split(' ')) assert.ok(google.includes(base), base);
});

test('every capability maps to at least one scope, or the grant is inert', () => {
  for (const [name, entry] of Object.entries(WRITE_SCOPES)) {
    assert.ok(entry.scopes.length > 0, `${name} grants a tool but no scope to use it`);
    assert.ok(
      entry.provider === 'microsoft' || entry.provider === 'google',
      `${name} names no usable provider`,
    );
  }
});
