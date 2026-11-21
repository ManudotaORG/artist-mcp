import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotebooks, listNotes, mapNotes, notebookKeyFor } from '../dist/notes.js';
import { withGraphBatch } from './support/graph-batch.mjs';

/**
 * A named notebook lists only its own sections (0016).
 *
 * Every call that named a notebook used to list every section on the account
 * first: one request per hundred sections, one after another — five and about
 * 23 s on the 429-section account hosted serves, before any work began. The
 * URLs are asserted, not the text, because a listing narrowed after the fetch
 * would pass every text assertion and save nothing.
 */

const section = (id, name, notebook) => ({
  id,
  displayName: name,
  lastModifiedDateTime: '2026-11-20T10:00:00Z',
  parentNotebook: { displayName: notebook },
});

const ACCOUNT = {
  notebooks: [
    { id: 'nb-season', displayName: '2026-27' },
    { id: 'nb-old', displayName: '2025-26' },
  ],
  sections: [
    section('s-a', 'GPT Platee', '2026-27'),
    section('s-b', 'Köln Orfeo', '2026-27'),
    section('s-c', 'Archiv', '2025-26'),
  ],
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** A Graph that answers the notebook, section and page listings, recording every URL. */
const serve = (account, seen) =>
  withGraphBatch(async (url) => {
    const path = decodeURIComponent(String(url));
    seen.push(path);
    if (path.includes('/me/onenote/notebooks?')) return json({ value: account.notebooks });
    if (path.includes('/me/onenote/sections?')) {
      const id = path.match(/parentNotebook\/id eq '([^']+)'/)?.[1];
      const name = account.notebooks.find((n) => n.id === id)?.displayName;
      const value = id === undefined ? account.sections : account.sections.filter((s) => s.parentNotebook.displayName === name);
      const skip = Number(path.match(/\$skip=(\d+)/)?.[1] ?? 0);
      return json({ value: value.slice(skip, skip + 100) });
    }
    if (path.includes('/pages')) return json({ value: [{ id: 'p-1', title: 'Seite', lastModifiedDateTime: '2026-11-20T10:00:00Z' }] });
    if (path.includes('/preview')) return json({ previewText: 'A preview long enough to triage the page on, with a date and a venue.' });
    return new Response('{}', { status: 404 });
  });

const run = async (account, tool, args) => {
  const seen = [];
  globalThis.fetch = serve(account, seen);
  const server = await createServer(async (op, params = {}) => {
    if (op === 'list_notebooks') return listNotebooks('token', params);
    if (op === 'list_notes') return listNotes('token', params);
    if (op === 'map_notes') return mapNotes('token', params.pages, { deadlineMs: params.deadline_ms });
    throw new Error(`unexpected operation ${op}`);
  });
  const result = await server._registeredTools[tool].handler(args);
  const text = result.content.map((c) => c.text).join('\n');
  const accountWide = seen.filter((u) => u.includes('/me/onenote/sections?') && !u.includes('$filter'));
  const filtered = seen.filter((u) => u.includes('/me/onenote/sections?') && u.includes('$filter'));
  const pagesOf = seen.map((u) => u.match(/\/sections\/([^/]+)\/pages/)?.[1]).filter(Boolean);
  return { text, seen, accountWide, filtered, pagesOf };
};

const KEY = notebookKeyFor(['2026-27', '2025-26']);

test('a named, proven notebook never lists the whole account', async () => {
  const { accountWide, filtered, pagesOf, text } = await run(ACCOUNT, 'map_notes', {
    notebook: '2026-27',
    notebook_key: KEY,
  });
  assert.deepEqual(accountWide, [], 'the account-wide listing was still made');
  assert.equal(filtered.length, 1);
  assert.match(filtered[0], /parentNotebook\/id eq 'nb-season'/);
  assert.deepEqual(pagesOf.sort(), ['s-a', 's-b'], 'pages were walked outside the notebook');
  assert.doesNotMatch(text, /Ask the user which notebook|came without the notebook_key/);
});

test('the key the question issues proves the narrow path', async () => {
  // Asked without a name, the account-wide path issues the key...
  const asked = await run(ACCOUNT, 'list_notes', {});
  const issued = asked.text.match(/notebook_key: (\S+)/)?.[1];
  assert.equal(issued, KEY);
  // ...and the same key, handed back, is accepted without the full listing.
  const { accountWide } = await run(ACCOUNT, 'list_notes', { notebook: '2026-27', notebook_key: issued });
  assert.deepEqual(accountWide, []);
});

/**
 * The hosted regression. On 2026-11-21 the first deploy of 0016 made hosted
 * slower, not faster: the key had been derived from the notebooks the section
 * listing shows, the narrow path derived it from the notebook listing, and the
 * two differ wherever a notebook has no sections. Every narrow call failed its
 * own key and paid for the full listing as well.
 */
const WITH_EMPTY = { ...ACCOUNT, notebooks: [...ACCOUNT.notebooks, { id: 'nb-empty', displayName: 'Leer' }] };

test('on an account with an empty notebook, the issued key proves the narrow path', async () => {
  const asked = await run(WITH_EMPTY, 'list_notes', {});
  const issued = asked.text.match(/notebook_key: (\S+)/)?.[1];
  const { accountWide, filtered, text } = await run(WITH_EMPTY, 'map_notes', {
    notebook: '2026-27',
    notebook_key: issued,
  });
  assert.deepEqual(accountWide, [], 'the key failed and the full listing was paid for as well');
  assert.equal(filtered.length, 1);
  assert.doesNotMatch(text, /came without the notebook_key|Ask the user which notebook/, 'a valid key was refused');
});

test('the empty notebook is shown in the question, not hidden', async () => {
  const { text } = await run(WITH_EMPTY, 'list_notes', {});
  assert.match(text, /- Leer — 0 sections/);
});

test('a key issued from section names before the fix is asked again, not trusted', async () => {
  // What the old full path issued: only the notebooks that have sections.
  const stale = notebookKeyFor(['2026-27', '2025-26']);
  const { text } = await run(WITH_EMPTY, 'map_notes', { notebook: '2026-27', notebook_key: stale });
  assert.match(text, /came without the notebook_key/);
});

test('an unknown notebook is refused, and nothing is filtered', async () => {
  const { filtered, text } = await run(ACCOUNT, 'list_notes', { notebook: '2024-25', notebook_key: KEY });
  assert.deepEqual(filtered, []);
  assert.match(text, /No notebook named "2024-25"|came without the notebook_key/);
});

test('a notebook over a hundred sections is paged on the filtered listing', async () => {
  const many = Array.from({ length: 105 }, (_, i) => section(`s-${i}`, `Projekt ${i}`, '2026-27'));
  const result = await (async () => {
    const seen = [];
    globalThis.fetch = serve({ ...ACCOUNT, sections: many }, seen);
    const listed = await listNotebooks('token', { notebook: '2026-27' });
    return { listed, seen };
  })();
  assert.equal(result.listed.section_list.length, 105);
  const filtered = result.seen.filter((u) => u.includes('$filter'));
  assert.equal(filtered.length, 2);
  assert.match(filtered[1], /\$skip=100/);
});
