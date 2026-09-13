import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotebooks, listNotes, mapNotes, notebookKeyFor } from '../dist/notes.js';
import { withGraphBatch } from './support/graph-batch.mjs';

/**
 * Asking which notebook must not cost every page in every notebook.
 *
 * `list_notes` answers the notebook question as a side effect of fetching the
 * pages of every section — one Graph request each, a hundred on an organised
 * account — and the notebook question is the one asked most: every call that
 * has to ask "which notebook?" was paying for all of them to print a list of
 * names that the sections request already contains.
 *
 * Graph refused that with 20166, "the app has issued too many requests on
 * behalf of this user". So the cost is asserted here, not just the answer: a
 * correct list of notebooks that costs a hundred requests is the bug.
 */

const ACCOUNT = {
  '/me/onenote/sections?': {
    value: [
      { id: 'sec1', displayName: 'Cosi', parentNotebook: { displayName: 'Season' } },
      { id: 'sec2', displayName: 'Figaro', parentNotebook: { displayName: 'Season' } },
      { id: 'sec3', displayName: 'Admin', parentNotebook: { displayName: 'Personal' } },
    ],
  },
  '/sections/sec1/pages': { value: [{ id: 'p1', title: 'Rehearsals' }] },
  '/sections/sec2/pages': { value: [{ id: 'p2', title: 'Contacts' }] },
  '/sections/sec3/pages': { value: [{ id: 'p3', title: 'Invoices' }] },
  '/preview': { previewText: 'x'.repeat(80) },
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const serverCountingRequests = async () => {
  const paths = [];
  globalThis.fetch = withGraphBatch(async (url) => {
    const path = String(url);
    paths.push(path);
    const match = Object.keys(ACCOUNT).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(ACCOUNT[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const dispatch = async (op, args) => {
    if (op === 'list_notebooks') return listNotebooks('token');
    if (op === 'list_notes') return listNotes('token');
    if (op === 'map_notes') return mapNotes('token', args.pages);
    throw new Error(`unexpected operation ${op}`);
  };

  return { server: await createServer(dispatch), paths };
};

const textOf = (result) => result.content.map((c) => c.text).join('\n');

test('asking which notebook fetches no pages at all', async () => {
  const { server, paths } = await serverCountingRequests();
  const text = textOf(await server._registeredTools.map_notes.handler({}));

  assert.match(text, /Season/, 'the notebooks were not listed');
  assert.match(text, /Personal/);

  const pageRequests = paths.filter((p) => p.includes('/pages'));
  assert.deepEqual(pageRequests, [], `asking which notebook fetched pages: ${pageRequests}`);
  assert.equal(paths.length, 1, `took ${paths.length} requests to list notebooks: ${paths}`);
});

test('a misspelled notebook is refused without fetching pages', async () => {
  const { server, paths } = await serverCountingRequests();
  const key = notebookKeyFor(['Season', 'Personal']);
  const text = textOf(
    await server._registeredTools.map_notes.handler({ notebook: 'Saison', notebook_key: key }),
  );

  assert.match(text, /No notebook named "Saison"/);
  assert.deepEqual(
    paths.filter((p) => p.includes('/pages')),
    [],
    'a typo cost a full listing',
  );
});

test('a settled notebook does fetch pages — the saving is not a loss of function', async () => {
  const { server, paths } = await serverCountingRequests();
  const key = notebookKeyFor(['Season', 'Personal']);
  const text = textOf(
    await server._registeredTools.map_notes.handler({ notebook: 'Season', notebook_key: key }),
  );

  assert.match(text, /Rehearsals/, 'the chosen notebook was not surveyed');
  assert.equal(text.includes('Invoices'), false, 'a page from the other notebook leaked in');
  assert.equal(
    paths.some((p) => p.includes('/pages')),
    true,
    'a settled survey somehow read no pages',
  );
});
