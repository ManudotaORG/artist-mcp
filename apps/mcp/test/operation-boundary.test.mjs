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
  list_notebooks: 'read',
  list_notes: 'read',
  map_notes: 'read',
  read_note: 'read',
  list_emails: 'read',
  read_email: 'read',
  read_gmail_attachment: 'read',
  map_gmail_attachment: 'read',
  // Not a tool: create_onenote_page's handler fetches each picture through it
  // on the Google token before the page is created on the Microsoft one. A
  // read; it returns bytes and writes nothing. See
  // docs/decisions/0012-images-on-a-new-page.md.
  load_gmail_image: 'read',
  // The same two reads against a OneNote page rather than a mail message.
  // Separate rows because the provider is resolved from this table before the
  // call runs, so a single row cannot serve both a Google and a Microsoft
  // token. Reads only: nothing here writes to a page. See issue #70.
  read_page_attachment: 'read',
  map_page_attachment: 'read',
  list_events: 'read',
  read_event: 'read',
  list_calendars: 'read',
  // No preview rows for the calendar or for creating a page since 0009: those
  // writes commit in one call. Removed deliberately, in the same commit as the
  // rows, which is what this literal is for.
  create_calendar_event: 'write',
  delete_calendar_event: 'write',
  // Two writes under one row: it creates the replacement and deletes the
  // original. Sanctioned as one because it is gated on holding both
  // calendar-create and calendar-delete, so it can reach nothing those two
  // could not reach separately.
  reschedule_calendar_event: 'write',
  // 0013: one event changed in place, the musician's own included, behind a
  // confirmation bound to its etag. Gated on both calendar grants.
  edit_calendar_event: 'write',
  // The first write to OneNote, and the first whose boundary is not ours. It
  // is gated on onenote-create, whose scope `Notes.Create` cannot express an
  // edit or a delete — so there is deliberately no update or delete row here
  // to refuse. See docs/decisions/0003-onenote-writes.md.
  create_onenote_page: 'write',
  // Under Notes.Create as well, which cannot rename or delete a section.
  // See docs/decisions/0011-creating-sections.md.
  create_onenote_section: 'write',
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
  // Four POSTs, one DELETE and one PATCH: graphBatchGet's envelope,
  // calendarInsertEvent, calendarDeleteEvent, onenoteCreatePage,
  // onenoteCreateSection (0011) and onenotePatchPage. Not "no writes" any more, but still a counted set — each
  // one had to be argued for here before it could ship, and the PATCH took a
  // decision record and a probe against a real notebook.
  //
  // The batch POST is a read: it carries only GETs of OneNote paths, checked in
  // graphBatchGet and pinned by the next test, because a `$batch` that accepted
  // any method would be a way round everything else asserted here.
  assert.deepEqual(
    nonGet,
    // 0013 added the second PATCH, calendarPatchEvent.
    ['POST', 'POST', 'DELETE', 'PATCH', 'POST', 'POST', 'PATCH'],
    `api.ts sends ${nonGet.join(', ') || 'nothing but GET'}. Any change here is a boundary change.`,
  );
});

test('a Graph batch carries only GETs of OneNote paths', async () => {
  const { graphBatchGet } = await import('../dist/api.js');
  let sent;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ responses: sent.requests.map((r) => ({ id: r.id, status: 200, body: {} })) }),
      { status: 200 },
    );
  };
  try {
    await graphBatchGet(['/me/onenote/sections/0-AB!s1/pages?$top=100', '/me/onenote/pages/p1/preview'], 't');
    assert.deepEqual([...new Set(sent.requests.map((r) => r.method))], ['GET']);

    sent = undefined;
    for (const path of ['/me/events', '/me/onenote/pages/p1/content?x=1#', '/users/x/onenote/pages/p1', 'https://graph.microsoft.com/v1.0/me/onenote/pages/p1']) {
      await assert.rejects(() => graphBatchGet([path], 't'), /only OneNote reads can be batched/, path);
    }
    assert.equal(sent, undefined, 'a refused batch still reached the network');
  } finally {
    globalThis.fetch = original;
  }
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

/**
 * 0013 reversed "nothing can update an event": the musician's events can now be
 * changed. What this guards instead is the shape of that one path. There is
 * exactly one calendar PATCH; it carries the etag the confirmation was made
 * against and never emails anyone; and no PUT exists, since a PUT replaces the
 * whole event and would drop every field the caller did not restate.
 */
test('the one calendar update is guarded, silent, and never a PUT', async () => {
  const api = await readFile(resolve(srcRoot, 'api.ts'), 'utf8');
  assert.doesNotMatch(api, /method\s*:\s*['"`]PUT/i, 'api.ts can send PUT');

  const at = api.indexOf('export const calendarPatchEvent');
  assert.notEqual(at, -1, 'the calendar PATCH helper was renamed or removed');
  const helper = api.slice(at, api.indexOf('\n};', at));
  assert.match(helper, /'if-match': etag/, 'the calendar PATCH lost its If-Match');
  assert.match(helper, /sendUpdates=none/, 'the calendar PATCH can email attendees');
  assert.match(api, /events\/\$\{encodeURIComponent\(eventId\)\}\?sendUpdates=none`;\n  const res = await fetch\(url, \{\n    method: 'DELETE'/,
    'the calendar DELETE can email attendees');
});

test('an event this tool did not create is changed only with a confirmation', async () => {
  const calendar = await readFile(resolve(srcRoot, 'calendar.ts'), 'utf8');
  // Deleting one of the musician's events, and every edit, goes through the
  // token check before the write helper is reached.
  assert.match(calendar, /if \(!eventId\.startsWith\(ARTIST_ID_PREFIX\)\) \{\n    const expected = await confirmationFor\('delete'/);
  assert.match(calendar, /const expected = await confirmationFor\('edit'/);
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
    /export\s+(?:const|function|async function)\s+(\w*(?:post|put|patch|delete|insert|create|send|write|reschedule|move|replace|edit)\w*)/gi;
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
    // 0013: the calendar PATCH and the edit that reaches it.
    'api.ts:calendarPatchEvent',
    'calendar.ts:editEvent',
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
    // 0011: one section per call, under the same Notes.Create boundary.
    'api.ts:onenoteCreateSection',
    'onenote-write.ts:createSection',
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
    // The 0004 edit path. Never scanned until 0013 added `edit` to the pattern:
    // the guard was blind to the whole of it, a fourth way it went blind. The
    // write is applyEdit; the rest shape, read or bind the change.
    'onenote-patch.ts:editFrom',
    'onenote-patch.ts:editToken',
    'onenote-patch.ts:readEditableParts',
    'onenote-patch.ts:editablePartsFrom',
    'onenote-patch.ts:previewEdit',
    'onenote-patch.ts:applyEdit',
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
