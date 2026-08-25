import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WRITE_CAPABILITIES,
  describeGrants,
  grantedWrites,
  isGranted,
  parseGrants,
  setGrants,
} from '../dist/grants.js';
import { createServerEntry } from '../dist/init.js';
import { renderWorkflowBriefing } from '../dist/server.js';

/**
 * The grant is what separates creating an event from deleting one, because the
 * OAuth scopes no longer do: Google's events.insert and events.delete accept
 * the identical four scopes. So these are not preference tests.
 */

test('no flag means no writes', () => {
  assert.deepEqual(parseGrants(undefined), []);
});

/**
 * Refused by name rather than ignored. A typo that silently granted nothing
 * would be diagnosed as "the write tool is broken", which sends someone looking
 * in entirely the wrong place.
 */
test('an unknown capability is refused, and the message names it', () => {
  assert.throws(() => parseGrants('calender-create'), /Unknown write capability: calender-create/);
  assert.throws(() => parseGrants('calendar-create,calendar-delete'), /calendar-delete/);
  // And it says what the legal values are, so the fix does not need the docs.
  assert.throws(() => parseGrants('nope'), /Available: calendar-create/);
});

/**
 * Someone typing the flag meant to grant something. Reading it as "grant
 * nothing" hides the mistake until the tool they wanted turns out to be absent.
 */
test('the flag with no value is refused, not read as granting nothing', () => {
  assert.throws(() => parseGrants(''), /needs at least one capability/);
  assert.throws(() => parseGrants('  '), /needs at least one capability/);
  assert.throws(() => parseGrants(','), /needs at least one capability/);
});

test('a list is parsed, trimmed and deduplicated', () => {
  assert.deepEqual(parseGrants('calendar-create'), ['calendar-create']);
  assert.deepEqual(parseGrants('  calendar-create  '), ['calendar-create']);
  assert.deepEqual(parseGrants('calendar-create,calendar-create'), ['calendar-create']);
});

test('every capability has a description, since it is shown to the user', () => {
  for (const [name, description] of Object.entries(WRITE_CAPABILITIES)) {
    assert.ok(description.length > 10, `${name} has no usable description`);
  }
});

/**
 * The grant lives in the Claude Desktop entry's args, which is where a user can
 * see it and where the server it spawns reads it back.
 */
test('a granted install records the flag in the entry it writes', () => {
  const entry = createServerEntry({ grants: ['calendar-create'] });
  const at = entry.args.indexOf('--allow-writes');
  assert.notEqual(at, -1, 'the grant was not written into the entry');
  assert.equal(entry.args[at + 1], 'calendar-create');
});

test('an install with no grant writes no flag at all', () => {
  assert.equal(createServerEntry().args.includes('--allow-writes'), false);
  assert.equal(createServerEntry({ grants: [] }).args.includes('--allow-writes'), false);
});

test('the local build records the grant the same way', () => {
  const entry = createServerEntry({ local: true, grants: ['calendar-create'] });
  assert.equal(entry.args[entry.args.indexOf('--allow-writes') + 1], 'calendar-create');
});

test('grants are readable back, and default to none', () => {
  setGrants([]);
  assert.deepEqual(grantedWrites(), []);
  assert.equal(isGranted('calendar-create'), false);
  assert.match(describeGrants(), /Writes: none/);

  setGrants(['calendar-create']);
  assert.equal(isGranted('calendar-create'), true);
  assert.match(describeGrants(), /calendar-create/);
  setGrants([]);
});

/**
 * A capability nobody can see is one nobody accounts for — the handshake bug
 * again, where a correct thing never reached the client. The briefing is the
 * one surface a session actually reads.
 */
const briefingWith = async (grants) => {
  setGrants(grants);
  try {
    return await renderWorkflowBriefing(
      [{ id: 'policy:intake', name: 'Intake', description: 'x', source: 'bundled', origin: '/', file: 'a.md' }],
      async () => ({ content: '# Intake\n\nrules' }),
    );
  } finally {
    setGrants([]);
  }
};

test('a read-only install says so in the briefing, unprompted', async () => {
  const text = await briefingWith([]);
  assert.match(text, /What this install may change/);
  assert.match(text, /can only read/);
  assert.match(text, /never offer to/);
});

test('a granted install names the write and carries the disputed-value rule', async () => {
  const text = await briefingWith(['calendar-create']);
  assert.match(text, /calendar-create/);
  // The rule that matters most, in the surface that is always loaded.
  assert.match(text, /disputed or UNKNOWN value may never be written/);
  // OneNote must stay named as read-only even once a write exists.
  assert.match(text, /including all of OneNote/);
});
