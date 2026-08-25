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
test('the HTTP layer offers no way to send anything but a GET', async () => {
  const api = await readFile(resolve(srcRoot, 'api.ts'), 'utf8');
  const methods = [...api.matchAll(/method\s*:\s*['"`](\w+)['"`]/g)].map((m) => m[1].toUpperCase());
  const nonGet = methods.filter((m) => m !== 'GET');
  assert.deepEqual(
    nonGet,
    [],
    `api.ts can send ${nonGet.join(', ')}. A write helper is a boundary change.`,
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
  const suspicious = /export\s+(?:const|function|async function)\s+(\w*(?:Post|Put|Patch|Delete|Insert|Create|Send|Write)\w*)/g;
  const files = ['api.ts', 'calendar.ts', 'mail.ts', 'notes.ts', 'attachments.ts'];
  const found = [];
  for (const file of files) {
    const text = await readFile(resolve(srcRoot, file), 'utf8');
    for (const m of text.matchAll(suspicious)) found.push(`${file}:${m[1]}`);
  }
  assert.deepEqual(found, [], `Write-shaped exports found: ${found.join(', ')}`);
});
