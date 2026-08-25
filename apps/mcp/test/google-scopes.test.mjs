import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PROVIDERS, WRITE_SCOPES, scopesFor } from '../dist/oauth.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const edgeFunction = resolve(repoRoot, 'supabase/functions/graph/index.ts');

/**
 * The Google scope list exists twice: once here for a local install, once in
 * the edge function for a hosted one. They cannot share code across a Node
 * package and a Deno function, so they are two literals that have to agree.
 *
 * They have to agree for a reason that bites at runtime rather than at build
 * time: a refresh asking for more than the original grant carries is rejected,
 * so a list that drifts does not fail here, it fails in a user's session an
 * hour after they connected.
 */
const scopesFromEdgeFunction = async () => {
  const text = await readFile(edgeFunction, 'utf8');
  const block = text.match(/const GOOGLE_SCOPES = \[([\s\S]*?)\]\.join/);
  assert.ok(block, 'GOOGLE_SCOPES is no longer a literal array in the edge function');
  // Whole-line comments first. A prose comment inside the array quoting a
  // calendar name otherwise reads as a scope, which is how this test first
  // failed against two lists that were in fact identical. Anchored to the line
  // start because an unanchored match eats the `//` inside every https URL.
  const code = block[1].replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
};

test('both Google scope lists are identical, in the same order', async () => {
  const local = PROVIDERS.google.scope.split(' ');
  assert.deepEqual(
    local,
    await scopesFromEdgeFunction(),
    'The local and hosted Google scopes have drifted. A refresh that asks for ' +
      'more than the grant carries is rejected, so this fails in a session, not a build.',
  );
});

/**
 * Written out by hand for the same reason the operation table is: this file
 * should fail when someone widens the consent screen, so that widening it is a
 * decision rather than a diff nobody read.
 *
 * If this fails and the new scope is intended, read
 * docs/decisions/0001-opt-in-calendar-writes.md and update the literal in the
 * same commit.
 */
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
