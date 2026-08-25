import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WRITE_CAPABILITIES,
  isWriteCapability,
  describeGrants,
  isGranted,
  parseGrants,
} from '../dist/grants.js';
import { createServerEntry } from '../dist/init.js';
import { createServer } from '../dist/server.js';
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
  assert.throws(() => parseGrants('calendar-create,calendar-update'), /calendar-update/);
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

/**
 * A comma does not survive Windows. Claude Desktop spawns `npx`, which is a
 * .cmd batch script there, and cmd.exe treats a comma as an argument separator:
 * `--allow-writes calendar-create,calendar-delete` reached the server as the
 * single string `calendar-create calendar-delete` and was refused as one
 * unknown capability. Reported from a real Windows install, where it presented
 * as Claude Desktop simply not listing the write tools.
 */
test('whitespace separates capabilities as well as a comma', () => {
  assert.deepEqual(parseGrants('calendar-create calendar-delete'), [
    'calendar-create',
    'calendar-delete',
  ]);
  assert.deepEqual(parseGrants('calendar-create,  calendar-delete'), [
    'calendar-create',
    'calendar-delete',
  ]);
  assert.deepEqual(parseGrants('calendar-create\tcalendar-delete'), [
    'calendar-create',
    'calendar-delete',
  ]);
});

test('a genuinely unknown name is still refused when space-separated', () => {
  assert.throws(() => parseGrants('calendar-create calendar-update'), /calendar-update/);
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

test('a grant set answers for itself, and an empty one says so', () => {
  assert.equal(isGranted([], 'calendar-create'), false);
  assert.match(describeGrants([]), /Writes: none/);

  assert.equal(isGranted(['calendar-create'], 'calendar-create'), true);
  assert.equal(isGranted(['calendar-create'], 'calendar-delete'), false);
  assert.match(describeGrants(['calendar-create']), /calendar-create/);
});

/**
 * The property that matters once one process serves more than one user: two
 * grant sets cannot see each other. Module state could not offer this, and the
 * hosted route is where it would have failed — in production, under
 * concurrency, in a way no test here would reproduce.
 */
test('two grant sets are independent', () => {
  const a = ['calendar-create'];
  const b = [];
  assert.equal(isGranted(a, 'calendar-create'), true);
  assert.equal(isGranted(b, 'calendar-create'), false);
  assert.equal(isGranted(a, 'calendar-create'), true);
});

/**
 * A capability nobody can see is one nobody accounts for — the handshake bug
 * again, where a correct thing never reached the client. The briefing is the
 * one surface a session actually reads.
 */
const briefingWith = (grants) =>
  renderWorkflowBriefing(
    [{ id: 'policy:intake', name: 'Intake', description: 'x', source: 'bundled', origin: '/', file: 'a.md' }],
    async () => ({ content: '# Intake\n\nrules' }),
    grants,
  );

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


/**
 * The registration gate. An ungranted write tool is absent, not present and
 * refusing: a tool that exists is a tool a model will try, and a refusal in a
 * tool result reads as an obstacle to route around rather than as a boundary.
 */
const toolNames = async (grants) => {
  const server = await createServer(async () => ({}), grants);
  // The SDK keeps registered tools on the server instance; read whichever
  // shape this version exposes rather than reaching into a private field
  // blindly.
  return Object.keys(server._registeredTools ?? {});
};

test('an ungranted install has no write tool at all', async () => {
  const names = await toolNames([]);
  assert.ok(names.length > 0, 'no tools registered at all — the probe is wrong, not the gate');
  assert.equal(names.includes('create_calendar_event'), false);
  assert.equal(names.includes('preview_calendar_event'), false);
  // The reads are unaffected: this is a gate, not a kill switch.
  assert.ok(names.includes('list_events'));
  assert.ok(names.includes('list_notes'));
});

test('a granted install has the preview and the create, and nothing more', async () => {
  const granted = await toolNames(['calendar-create']);
  const plain = await toolNames([]);
  assert.deepEqual(
    granted.filter((name) => !plain.includes(name)).sort(),
    ['create_calendar_event', 'preview_calendar_event'],
  );
});


test('the delete tools are gated on their own capability, not on any grant', async () => {
  const createOnly = await toolNames(['calendar-create']);
  assert.equal(createOnly.includes('delete_calendar_event'), false);
  assert.equal(createOnly.includes('preview_calendar_delete'), false);

  const both = await toolNames(['calendar-create', 'calendar-delete']);
  assert.ok(both.includes('delete_calendar_event'));
  assert.ok(both.includes('preview_calendar_delete'));
});

/**
 * Granting delete alone is legal and self-consistent: it removes events this
 * tool made on an install that no longer creates them.
 */
test('delete can be granted without create', async () => {
  const names = await toolNames(['calendar-delete']);
  assert.ok(names.includes('delete_calendar_event'));
  assert.equal(names.includes('create_calendar_event'), false);
});


test('a capability token is recognised, and nothing else is', () => {
  assert.equal(isWriteCapability('calendar-create'), true);
  assert.equal(isWriteCapability('calendar-delete'), true);
  assert.equal(isWriteCapability('status'), false);
  assert.equal(isWriteCapability(undefined), false);
});


/**
 * The hosted failure this shape exists to prevent.
 *
 * One process serves many users there. With the grant in module state, serving
 * a granted user and an ungranted one concurrently could hand the second the
 * first's tools — and it would pass every other test in this suite, because
 * they all run one user at a time. Built concurrently on purpose.
 */
test('servers built at the same time do not see each other\'s grants', async () => {
  const [none, both, createOnly] = await Promise.all([
    toolNames([]),
    toolNames(['calendar-create', 'calendar-delete']),
    toolNames(['calendar-create']),
  ]);

  assert.equal(none.some((n) => n.includes('create_calendar') || n.includes('delete_calendar')), false);
  assert.equal(both.includes('create_calendar_event'), true);
  assert.equal(both.includes('delete_calendar_event'), true);
  assert.equal(createOnly.includes('create_calendar_event'), true);
  assert.equal(createOnly.includes('delete_calendar_event'), false);
});

test('the briefings rendered together each describe their own grant', async () => {
  const [plain, granted] = await Promise.all([briefingWith([]), briefingWith(['calendar-create'])]);
  assert.match(plain, /can only read/);
  assert.doesNotMatch(plain, /calendar-create/);
  assert.match(granted, /calendar-create/);
  assert.doesNotMatch(granted, /can only read/);
});
