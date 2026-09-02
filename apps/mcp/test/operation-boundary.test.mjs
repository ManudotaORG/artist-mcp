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
  read_gmail_attachment: 'read',
  map_gmail_attachment: 'read',
  // The same two reads against a OneNote page rather than a mail message.
  // Separate rows because the provider is resolved from this table before the
  // call runs, so a single row cannot serve both a Google and a Microsoft
  // token. Reads only: nothing here writes to a page. See issue #70.
  read_page_attachment: 'read',
  map_page_attachment: 'read',
  list_events: 'read',
  read_event: 'read',
  list_calendars: 'read',
  preview_calendar_event: 'read',
  create_calendar_event: 'write',
  preview_calendar_delete: 'read',
  delete_calendar_event: 'write',
  preview_calendar_reschedule: 'read',
  // Two writes under one row: it creates the replacement and deletes the
  // original. Sanctioned as one because it is gated on holding both
  // calendar-create and calendar-delete, so it can reach nothing those two
  // could not reach separately.
  reschedule_calendar_event: 'write',
  preview_onenote_page: 'read',
  // The first write to OneNote, and the first whose boundary is not ours. It
  // is gated on onenote-create, whose scope `Notes.Create` cannot express an
  // edit or a delete — so there is deliberately no update or delete row here
  // to refuse. See docs/decisions/0003-onenote-writes.md.
  create_onenote_page: 'write',
  // Reads the page and shows the change against what is written there now. A
  // read, and it has to be: it is the safeguard a write is conditional on.
  preview_onenote_edit: 'read',
  // The first operation in this table that can destroy something a musician
  // might want back, and the only one whose undo is this install's own write
  // log rather than the provider's. Appending and replacing share one row
  // because no scope separates them; what separates them is that a replace
  // cannot proceed unless what it would overwrite was captured first.
  // See docs/decisions/0004-onenote-page-maintenance.md.
  edit_onenote_page: 'write',
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
  // Two POSTs, one DELETE and one PATCH: calendarInsertEvent,
  // calendarDeleteEvent, onenoteCreatePage and onenotePatchPage. Not "no
  // writes" any more, but still a counted set — each one had to be argued for
  // here before it could ship, and the PATCH took a decision record and a probe
  // against a real notebook.
  assert.deepEqual(
    nonGet,
    ['POST', 'DELETE', 'POST', 'PATCH'],
    `api.ts sends ${nonGet.join(', ') || 'nothing but GET'}. Any change here is a boundary change.`,
  );
});

/**
 * Deleting is now possible, and narrowly: only an event this tool created, by
 * the `artist` id prefix. Updating still is not, and that is the assertion —
 * rescheduling is deliberately not an exception to it: it writes a new event
 * and deletes the old, precisely so that no PATCH is needed and the event id
 * goes on being a hash of the event's own contents. If a PATCH ever appears
 * here, that invariant has been abandoned somewhere.
 *
 * Google grants PATCH and PUT with the same scope, so nothing at the provider
 * stops them and only this repository does.
 *
 * An event this tool did not create must stay unreachable. If that check is
 * ever removed, the capability should go back to not existing at all; see
 * docs/decisions/0001-opt-in-calendar-writes.md.
 */
/**
 * The OneNote half of the same rule. It used to read "nothing can edit or
 * delete a OneNote page", and half of that is no longer true:
 * docs/decisions/0004-onenote-page-maintenance.md permits editing a page this
 * tool created, on `Notes.ReadWrite.CreatedByApp`, which Microsoft enforces
 * against *this* application rather than merely against some application.
 *
 * What has not changed, and what this now guards:
 *
 *   - **No DELETE, ever.** A deleted page is not in the notebook recycle bin.
 *     There is no pre-image to capture and nothing to restore from, so it stays
 *     out on the same recoverability grounds that once covered replacing.
 *   - **Not bare `Notes.ReadWrite`.** That grants edit and delete over every
 *     page and puts the boundary back in our code, which is the position 0003
 *     exists to avoid returning to. The `.CreatedByApp` suffix is the whole
 *     difference, so it is checked for rather than matched loosely.
 */
test('a OneNote page can be edited but never deleted', async () => {
  const api = await readFile(resolve(srcRoot, 'api.ts'), 'utf8');
  assert.doesNotMatch(
    api,
    /onenote\/pages\/[^`'"]*`?,?\s*\{[^}]*method\s*:\s*['"`](DELETE|PUT)/i,
    'api.ts can delete or overwrite a OneNote page. A Graph delete leaves ' +
      'nothing in the recycle bin, so there is no undo to build on — see 0004.',
  );

  const readWrite = [...api.matchAll(/Notes\.ReadWrite(?:\.\w+)?/g)].map((m) => m[0]);
  assert.deepEqual(
    readWrite.filter((scope) => scope !== 'Notes.ReadWrite.CreatedByApp'),
    [],
    'Bare Notes.ReadWrite appears in api.ts. It grants edit and delete over ' +
      'every page in the notebook, which makes the boundary ours again.',
  );
});

test('nothing can update an event', async () => {
  const api = await readFile(resolve(srcRoot, 'api.ts'), 'utf8');

  // api.ts now contains exactly one PATCH, and it belongs to OneNote. Cutting
  // that helper out and asserting over the remainder keeps this rule absolute
  // for Calendar rather than weakening it to "no PATCH except somewhere":
  // rescheduling still creates and deletes, precisely so that an event id can
  // go on being a hash of the event's own contents.
  const at = api.indexOf('export const onenotePatchPage');
  assert.notEqual(at, -1, 'the sanctioned OneNote PATCH helper was renamed or removed');
  const beforeOnenotePatch = api.slice(0, at);

  for (const method of ['PATCH', 'PUT']) {
    assert.doesNotMatch(
      beforeOnenotePatch,
      new RegExp(`method\\s*:\\s*['"\`]${method}`, 'i'),
      `api.ts can send ${method} outside the OneNote patch helper. calendar.events ` +
        'grants it; only this repository refuses it.',
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
  // `reschedule` is in the list because it was not, and `rescheduleEvent` —
  // which creates and deletes — sailed through a pattern built from HTTP verbs
  // and CRUD words. A write can be named for what it accomplishes rather than
  // for how, and this guard has now missed that twice.
  const suspicious =
    /export\s+(?:const|function|async function)\s+(\w*(?:post|put|patch|delete|insert|create|send|write|reschedule|move|replace)\w*)/gi;
  // Every module that can reach the network, not merely the ones that write
  // today. A new file is the third way this guard can go blind — after the
  // capital-D pattern and the verb-shaped names — because a module absent from
  // this list is not scanned at all, however write-shaped its exports are.
  const files = [
    'api.ts',
    'calendar.ts',
    'mail.ts',
    'notes.ts',
    'attachments.ts',
    'onenote-write.ts',
    'onenote-patch.ts',
  ];
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
    // Create then delete, never an update. Both halves are the sanctioned
    // paths above; this is the pair applied in one confirmed step.
    'calendar.ts:rescheduleEvent',
    // A read, like previewDeleteEvent: it fetches the event so the move is
    // confirmed against what is really there.
    'calendar.ts:previewRescheduleEvent',
    // The OneNote create path, in full. Unlike the calendar rows above, the
    // scope behind these cannot express an edit or a delete, so the risk this
    // guard covers is narrower: not "could this write the wrong thing", but
    // "has a second create path appeared without anyone reading 0003".
    'api.ts:onenoteCreatePage',
    'onenote-write.ts:createPage',
    // Reads. Named here because the pattern cannot tell them apart: one renders
    // the page and resolves its section, the other shapes and escapes it.
    'onenote-write.ts:previewPage',
    'onenote-write.ts:draftFrom',
    // The editing path, in full. Unlike the create rows, the scope behind this
    // one *can* express an edit — Microsoft narrows it to pages this app
    // created, and nothing narrows it further. So the risk here is the one this
    // guard is actually for: a second patch path appearing without anyone
    // reading 0004.
    'api.ts:onenotePatchPage',
    // Command builders and the pre-image. They send nothing; they are named
    // because the pattern matches `patch` and `replace` and cannot tell a
    // string builder from a request. `preImage` is what makes a replace
    // permissible at all, so it is deliberately visible in this list.
    'onenote-patch.ts:replaceCommand',
    'onenote-patch.ts:appendCommand',
    // The third command builder, and the one that reaches the middle of a page.
    // It destroys nothing — a sibling insert leaves the anchor table where it
    // is — but it is named here for the same reason as the other two: the guard
    // matches the shape, not the effect.
    'onenote-patch.ts:insertCommand',
    'onenote-patch.ts:preImage',
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
