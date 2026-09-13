import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotebooks, listNotes } from '../dist/notes.js';

/**
 * `list_notes` with `section`: the first step of resolving a chat update to one
 * CL Aufgabe page (#193). The saving is in requests, so the URLs are asserted,
 * not only the text — a filter applied after fetching every section would pass
 * every text assertion and save nothing.
 */

const pages = (titles) => ({
  value: titles.map((title, i) => ({
    id: `p-${title.replace(/\W/g, '')}-${i}`,
    title,
    lastModifiedDateTime: '2026-09-01T00:00:00Z',
  })),
});

const GRAPH = {
  '/me/onenote/sections?': {
    value: [
      { id: 'melk', displayName: 'GPT Melk', parentNotebook: { displayName: 'Season' } },
      { id: 'megeve', displayName: 'BCW Megeve', parentNotebook: { displayName: 'Season' } },
      { id: 'empty', displayName: 'Leer', parentNotebook: { displayName: 'Season' } },
    ],
  },
  '/sections/melk/pages': pages(['CL Aufgaben — GPT Melk', 'Programm', 'Kontakte']),
  '/sections/megeve/pages': pages(['Kirche Programm']),
  '/sections/empty/pages': { value: [] },
};

const stubGraph = (routes) => {
  const seen = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    seen.push(path);
    const match = Object.keys(routes).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return seen;
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const callList = async (graph, args) => {
  const seen = stubGraph(graph);
  const dispatch = async (op, params) => {
    if (op === 'list_notebooks') return listNotebooks('token');
    if (op === 'list_notes') return listNotes('token', params);
    throw new Error(`unexpected operation ${op}`);
  };
  const server = await createServer(dispatch);
  const result = await server._registeredTools.list_notes.handler(args);
  return { text: result.content.map((c) => c.text).join('\n'), seen };
};

test('only the named section is walked', async () => {
  const { text, seen } = await callList(GRAPH, { section: 'GPT Melk' });

  assert.match(text, /CL Aufgaben — GPT Melk/);
  assert.doesNotMatch(text, /Kirche Programm/);
  assert.ok(seen.some((u) => u.includes('/sections/melk/pages')));
  assert.ok(
    !seen.some((u) => u.includes('/sections/megeve/pages') || u.includes('/sections/empty/pages')),
    'fetched the pages of a section that was not asked for',
  );
});

test('the match is on the whole name, case-insensitively', async () => {
  const { text } = await callList(GRAPH, { section: '  gpt melk ' });
  assert.match(text, /CL Aufgaben — GPT Melk/);

  // A fragment must not resolve: "BCW" would reach the wrong project's page.
  const partial = await callList(GRAPH, { section: 'Melk' });
  assert.doesNotMatch(partial.text, /CL Aufgaben/);
  assert.match(partial.text, /No section is named "Melk"/);
  assert.match(partial.text, /Closest: GPT Melk/);
});

/** Both found against the live notebook, not invented: see #193. */
test('a doubled space in the real name does not defeat the match', async () => {
  const spaced = {
    '/me/onenote/sections?': {
      value: [
        { id: 'kl', displayName: 'BCW  Klagenfurt Vidala', parentNotebook: { displayName: 'S' } },
        { id: 'mg', displayName: 'BCW Megeve', parentNotebook: { displayName: 'S' } },
      ],
    },
    '/sections/kl/pages': pages(['CL Aufgaben']),
  };
  const { text } = await callList(spaced, { section: 'BCW Klagenfurt Vidala' });
  assert.match(text, /holds 1 page; this is all of them/);
});

test('closest offers the best match, not every section sharing a word', async () => {
  const { text } = await callList(
    {
      ...GRAPH,
      '/me/onenote/sections?': {
        value: [
          ...GRAPH['/me/onenote/sections?'].value,
          { id: 'wig', displayName: 'BCW Wigmore Vidala', parentNotebook: { displayName: 'Season' } },
        ],
      },
    },
    { section: 'BCW Wigmore' },
  );
  assert.match(text, /Closest: BCW Wigmore Vidala\./);
  assert.doesNotMatch(text, /Closest:.*BCW Megeve/);
});

test('the reply states the section is complete, so completeness can be checked', async () => {
  const { text } = await callList(GRAPH, { section: 'GPT Melk' });
  assert.match(text, /Section "GPT Melk" holds 3 pages; this is all of them/);
});

test('a section at the listing cap says it may be incomplete', async () => {
  const full = {
    ...GRAPH,
    '/sections/melk/pages': pages(Array.from({ length: 100 }, (_, i) => `Seite ${i}`)),
  };
  const { text } = await callList(full, { section: 'GPT Melk', limit: 5 });
  assert.match(text, /listing cap: there may be more/);
  assert.doesNotMatch(text, /this is all of them/);
});

test('a miss is not reported as a project with no page', async () => {
  const { text } = await callList(GRAPH, { section: 'Montepulciano' });
  assert.match(text, /No section is named "Montepulciano"/);
  assert.match(text, /do not read this as the project having no page/);
  // With nothing close, every section is offered instead.
  assert.match(text, /GPT Melk/);
  assert.match(text, /BCW Megeve/);
});

test('an empty section says so plainly', async () => {
  const { text } = await callList(GRAPH, { section: 'Leer' });
  assert.match(text, /Section "Leer" holds no pages/);
  assert.doesNotMatch(text, /undefined/);
});

test('the same name in two notebooks is refused, not picked', async () => {
  const twice = {
    '/me/onenote/sections?': {
      value: [
        { id: 'a', displayName: 'Archiv', parentNotebook: { displayName: 'Season' } },
        { id: 'b', displayName: 'Archiv', parentNotebook: { displayName: 'Private' } },
      ],
    },
    '/sections/a/pages': pages(['Eins']),
    '/sections/b/pages': pages(['Zwei']),
  };
  // Straight to list_notes with the section: the notebook question comes first.
  const { text } = await callList(twice, { section: 'Archiv' });
  assert.match(text, /2 notebooks/);
  assert.doesNotMatch(text, /Eins|Zwei/);
});

test('without a section, every section is walked as before', async () => {
  const { seen } = await callList(GRAPH, {});
  for (const id of ['melk', 'megeve', 'empty']) {
    assert.ok(seen.some((u) => u.includes(`/sections/${id}/pages`)), `skipped ${id}`);
  }
});
