import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { OPERATIONS, WRITE_OPERATIONS } from '../dist/dispatch.js';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/**
 * These tests exist to fail when someone adds an operation.
 *
 * That is the point, not a side effect. The read-only boundary used to rest on
 * OAuth scopes, which are enforced by Google rather than by us. Google has no
 * insert-only Calendar scope, so from the first write onward the operation
 * table and the grant check are the boundary, and both are our own code. A
 * boundary that lives only in a comment is the drift this repository keeps
 * finding the hard way.
 *
 * If one of these fails and the new operation is intended: read
 * docs/decisions/0001-opt-in-calendar-writes.md, then update the literal below
 * in the same commit that adds the row.
 */

/** Written out by hand, deliberately. A derived expectation would assert nothing. */
const SANCTIONED = {
  list_notes: 'read',
  map_notes: 'read',
  read_note: 'read',
  list_emails: 'read',
  read_email: 'read',
  read_attachment: 'read',
  map_attachment: 'read',
  list_events: 'read',
  read_event: 'read',
  list_calendars: 'read',
  preview_calendar_event: 'read',
  create_calendar_event: 'write',
  preview_calendar_delete: 'read',
  delete_calendar_event: 'write',
};

test('the operation table is exactly what was sanctioned', () => {
  const actual = Object.fromEntries(
    Object.entries(OPERATIONS).map(([op, meta]) => [op, meta.effect]),
  );
  assert.deepEqual(
    actual,
    SANCTIONED,
    'An operation was added, removed, or changed effect. This is a boundary change.',
  );
});

test('write operations are exactly the rows marked write', () => {
  const marked = Object.keys(OPERATIONS).filter((op) => OPERATIONS[op].effect === 'write');
  assert.deepEqual([...WRITE_OPERATIONS].sort(), marked.sort());
});

test('every operation names a provider, so no call can pick a token by accident', () => {
  for (const [op, meta] of Object.entries(OPERATIONS)) {
    assert.ok(
      meta.provider === 'microsoft' || meta.provider === 'google',
      `${op} has no usable provider`,
    );
  }
});

/**
 * The layer below the table. `dispatch` can only be as read-only as the HTTP
 * helpers it is built on: a `graphPost` sitting in `api.ts` is reachable from
 * anywhere in the package regardless of what the operation union says.
 *
 * Asserted against the source rather than the exports because a helper that
 * is not exported is still a write path for the file it lives in.
 */
test('the HTTP layer sends exactly one non-GET, and it is the sanctioned one', async () => {
  const api = await readFile(resolve(srcRoot, 'api.ts'), 'utf8');
  const methods = [...api.matchAll(/method\s*:\s*['"`](\w+)['"`]/g)].map((m) => m[1].toUpperCase());
  const nonGet = methods.filter((m) => m !== 'GET');
  // One POST: calendarInsertEvent. Not "no writes" any more, but still a
  // counted set — a second one has to be argued for here before it can ship.
  assert.deepEqual(
    nonGet,
    ['POST', 'DELETE'],
    `api.ts sends ${nonGet.join(', ') || 'nothing but GET'}. Any change here is a boundary change.`,
  );
});

/**
 * Deleting is now possible, and narrowly: only an event this tool created, by
 * the `artist` id prefix. Updating still is not, and that is the assertion —
 * Google grants PATCH and PUT with the same scope, so nothing at the provider
 * stops them and only this repository does.
 *
 * An event this tool did not create must stay unreachable. If that check is
 * ever removed, the capability should go back to not existing at all; see
 * docs/decisions/0001-opt-in-calendar-writes.md.
 */
test('nothing can update an event', async () => {
  const api = await readFile(resolve(srcRoot, 'api.ts'), 'utf8');
  for (const method of ['PATCH', 'PUT']) {
    assert.doesNotMatch(
      api,
      new RegExp(`method\\s*:\\s*['"\`]${method}`, 'i'),
      `api.ts can send ${method}. calendar.events grants it; only this repository refuses it.`,
    );
  }
});

test('only an event this tool created can be deleted', async () => {
  const calendar = await readFile(resolve(srcRoot, 'calendar.ts'), 'utf8');
  assert.match(
    calendar,
    /startsWith\(ARTIST_ID_PREFIX\)/,
    'The prefix check is what makes deleting safe to offer. Without it this is ' +
      'a tool that can remove any event on the calendar.',
  );
});

/**
 * Belt and braces on the same layer: a write does not need an explicit
 * `method:` if it is built with a Request or a helper that defaults elsewhere.
 * Names are a weaker signal than behaviour, but the failure they catch — a
 * `calendarPost` added beside `calendarGet` without anyone reading this file —
 * is the realistic one.
 */
test('no module outside the sanctioned list exports a write-shaped helper', async () => {
  // Case-insensitive, which it was not: `deleteEvent` and `createEvent` slipped
  // straight past a pattern looking for a capital D, so the guard was blind to
  // the two functions that actually write. Found when adding delete.
  const suspicious =
    /export\s+(?:const|function|async function)\s+(\w*(?:post|put|patch|delete|insert|create|send|write)\w*)/gi;
  const files = ['api.ts', 'calendar.ts', 'mail.ts', 'notes.ts', 'attachments.ts'];
  // The sanctioned write path, named in full. Anything else matching the shape
  // is a boundary change and fails here.
  const SANCTIONED = [
    'api.ts:calendarInsertEvent',
    'api.ts:calendarDeleteEvent',
    'calendar.ts:createEvent',
    'calendar.ts:deleteEvent',
    // A read: it fetches the event so a deletion is confirmed against what is
    // really there. Named here because the pattern cannot tell it apart.
    'calendar.ts:previewDeleteEvent',
  ];
  const found = [];
  for (const file of files) {
    const text = await readFile(resolve(srcRoot, file), 'utf8');
    for (const m of text.matchAll(suspicious)) found.push(`${file}:${m[1]}`);
  }
  assert.deepEqual(
    found.filter((name) => !SANCTIONED.includes(name)),
    [],
    `Unsanctioned write-shaped exports: ${found.join(', ')}`,
  );
});
