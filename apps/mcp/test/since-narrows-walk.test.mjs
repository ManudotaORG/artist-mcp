import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotebooks, listNotes, mapNotes } from '../dist/notes.js';
import { withGraphBatch } from './support/graph-batch.mjs';

/**
 * `since` narrows the section walk by section dates, before any page is
 * listed. OneNote allows 400 requests an hour per app per user, and a full walk
 * of the three season notebooks measured about 270 — so a `since` question that
 * pays for every section in order to keep the few that moved is the throttling
 * problem itself. The URLs are asserted, not only the text: a filter applied
 * after the walk would pass every text assertion and save nothing.
 *
 * Sound because a section's timestamp moves when any page inside it changes
 * (the control is recorded on `narrowSections`): a section dated before the
 * cutoff holds no page that changed after it.
 */

const SINCE = '2026-11-14';

const page = (id, title, date) => ({ id, title, lastModifiedDateTime: date });

/** A healthy account: page dates are real, and a section is as new as its newest page. */
const HEALTHY = {
  '/me/onenote/sections?': {
    value: [
      { id: 'recent', displayName: 'GPT Platee', lastModifiedDateTime: '2026-11-20T10:00:00Z', parentNotebook: { displayName: 'S' } },
      { id: 'old', displayName: 'Köln Orfeo', lastModifiedDateTime: '2026-09-01T00:00:00Z', parentNotebook: { displayName: 'S' } },
      { id: 'undated', displayName: 'Ohne Datum', parentNotebook: { displayName: 'S' } },
    ],
  },
  '/sections/recent/pages': { value: [page('p-neu', 'Neu', '2026-11-20T10:00:00Z'), page('p-alt', 'Alt', '2026-09-01T00:00:00Z')] },
  '/sections/old/pages': { value: [page('p-archiv', 'Archiv', '2026-09-01T00:00:00Z')] },
  '/sections/undated/pages': { value: [page('p-od', 'Undatierte Sektion', '2026-11-19T09:00:00Z')] },
  '/preview': { previewText: 'A preview long enough to triage the page on, with a date and a venue and more.' },
};

/** Page dates are creation dates: the section moved later than every page in it. */
const CREATION = {
  '/me/onenote/sections?': {
    value: [
      { id: 'recent', displayName: 'GPT Platee', lastModifiedDateTime: '2026-11-20T12:00:00Z', parentNotebook: { displayName: 'S' } },
      { id: 'old', displayName: 'Köln Orfeo', lastModifiedDateTime: '2026-09-01T00:00:00Z', parentNotebook: { displayName: 'S' } },
    ],
  },
  '/sections/recent/pages': { value: [page('p-1', 'Besetzung', '2026-09-12T00:00:00Z')] },
  '/sections/old/pages': { value: [page('p-2', 'Archiv', '2026-09-01T00:00:00Z')] },
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const run = async (graph, tool, args) => {
  const seen = [];
  globalThis.fetch = withGraphBatch(async (url) => {
    const path = String(url);
    seen.push(path);
    const match = Object.keys(graph).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(graph[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const server = await createServer(async (op, params) => {
    if (op === 'list_notebooks') return listNotebooks('token');
    if (op === 'list_notes') return listNotes('token', params);
    if (op === 'map_notes') return mapNotes('token', params.pages, { deadlineMs: params.deadline_ms });
    throw new Error(`unexpected operation ${op}`);
  });
  const result = await server._registeredTools[tool].handler(args);
  const listed = seen
    .map((u) => u.match(/\/sections\/([^/]+)\/pages/)?.[1])
    .filter(Boolean);
  return { text: result.content.map((c) => c.text).join('\n'), seen, listed };
};

test('listNotes lists only sections that changed since, and counts the rest', async () => {
  globalThis.fetch = withGraphBatch(async (url) => {
    const path = String(url);
    const match = Object.keys(HEALTHY).find((key) => path.includes(key));
    return new Response(JSON.stringify(match ? HEALTHY[match] : {}), { status: 200 });
  });
  const result = await listNotes('token', { since: SINCE });
  assert.deepEqual(result.sections.map((s) => s.name).sort(), ['GPT Platee', 'Ohne Datum']);
  assert.equal(result.sections_unchanged, 1);
});

test('without since, nothing is skipped and nothing is counted as skipped', async () => {
  const { listed } = await run(HEALTHY, 'list_notes', {});
  // No notebook named on a one-notebook account lists sections only, by design.
  assert.deepEqual(listed, []);
  globalThis.fetch = withGraphBatch(async (url) => {
    const match = Object.keys(HEALTHY).find((key) => String(url).includes(key));
    return new Response(JSON.stringify(match ? HEALTHY[match] : {}), { status: 200 });
  });
  const result = await listNotes('token', {});
  assert.equal(result.sections.length, 3);
  assert.equal(result.sections_unchanged, undefined);
});

test('list_notes since walks only changed and undated sections, with the same answer', async () => {
  const { text, listed } = await run(HEALTHY, 'list_notes', { since: SINCE });
  assert.deepEqual(listed.sort(), ['recent', 'undated'], 'an unchanged section had its pages listed');
  assert.match(text, /Neu/);
  assert.match(text, /Undatierte Sektion/);
  // Trimmed by page date inside a changed section, as before.
  assert.doesNotMatch(text, /\bAlt\b/);
  assert.doesNotMatch(text, /Archiv/);
});

test('a section with no date is listed, because nothing shows it unchanged', async () => {
  const { listed } = await run(HEALTHY, 'list_notes', { since: '2026-11-21' });
  assert.deepEqual(listed, ['undated']);
});

test('nothing changed: no page is listed, and the answer says nothing changed', async () => {
  const dated = { ...HEALTHY, '/me/onenote/sections?': { value: HEALTHY['/me/onenote/sections?'].value.slice(0, 2) } };
  const { text, listed } = await run(dated, 'list_notes', { since: '2026-12-01' });
  assert.deepEqual(listed, []);
  assert.match(text, /No section in this account changed on or after 2026-12-01/);
  // Said from section dates, which is true on any account; not the claim that
  // this account's page dates are broken, which nothing here showed.
  assert.match(text, /Answered from section dates/);
  assert.doesNotMatch(text, /not reporting page modification times/);
  assert.doesNotMatch(text, /not evidence that nothing changed/);
});

test('page dates that are creation dates are still caught on the narrowed walk', async () => {
  const { text, listed } = await run(CREATION, 'list_notes', { since: SINCE });
  assert.deepEqual(listed, ['recent']);
  assert.match(text, /not reporting page modification times/);
  assert.match(text, /GPT Platee/);
  assert.doesNotMatch(text, /Köln Orfeo/);
});

test('a named section is never filtered out by since', async () => {
  const { text, listed } = await run(HEALTHY, 'list_notes', { section: 'Köln Orfeo', since: SINCE });
  assert.deepEqual(listed, ['old']);
  assert.doesNotMatch(text, /No section is named/);
});

test('map_notes since sketches only pages from sections that changed', async () => {
  const { text, listed, seen } = await run(HEALTHY, 'map_notes', { since: SINCE });
  assert.deepEqual(listed.sort(), ['recent', 'undated']);
  const previewed = seen.filter((u) => u.endsWith('/preview')).map((u) => u.match(/pages\/([^/]+)\/preview/)[1]);
  assert.deepEqual(previewed.sort(), ['p-neu', 'p-od']);
  assert.match(text, /## Neu/);
});

test('an unreadable since is refused, not ignored', async () => {
  const { text, listed } = await run(HEALTHY, 'list_notes', { since: 'last Tuesday-ish' });
  assert.match(text, /Could not read "last Tuesday-ish" as a date/);
  assert.deepEqual(listed, []);
});
