import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotebooks, listNotes } from '../dist/notes.js';
import { withGraphBatch } from './support/graph-batch.mjs';

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
  globalThis.fetch = withGraphBatch(async (url) => {
    const path = String(url);
    seen.push(path);
    const match = Object.keys(routes).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
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
  assert.match(text, /do not read this as the project having no page/i);
  // With nothing close, every section is offered instead.
  assert.match(text, /GPT Melk/);
  assert.match(text, /BCW Megeve/);
});

test('an empty section says so plainly', async () => {
  const { text } = await callList(GRAPH, { section: 'Leer' });
  assert.match(text, /Section "Leer" holds no pages/);
  assert.doesNotMatch(text, /undefined/);
});

/**
 * Several notebooks, one per season, and an update that names only a project.
 * Section names are searched across all of them; pages come back only for a
 * single match, and the notebook they came from is named.
 */
const SEASONS = {
  '/me/onenote/notebooks': {
    value: [{ displayName: '2026-27' }, { displayName: '2027-28' }],
  },
  '/me/onenote/sections?': {
    value: [
      { id: 'melk', displayName: 'BCW Melk Gansch', parentNotebook: { displayName: '2026-27' } },
      { id: 'mv26', displayName: 'MV 2', parentNotebook: { displayName: '2026-27' } },
      { id: 'mv27', displayName: 'MV 2', parentNotebook: { displayName: '2027-28' } },
    ],
  },
  '/sections/melk/pages': pages(['CL Aufgaben', 'Programm']),
  '/sections/mv26/pages': pages(['Eins']),
  '/sections/mv27/pages': pages(['Zwei']),
};

test('without a notebook, a section in one season is found and its season named', async () => {
  const { text } = await callList(SEASONS, { section: 'BCW Melk Gansch' });
  assert.match(text, /CL Aufgaben/);
  assert.match(text, /Found in notebook "2026-27"/);
  assert.match(text, /holds 2 pages; this is all of them/);
});

test('a unique match still names a similarly titled section in another season', async () => {
  const graph = {
    ...SEASONS,
    '/me/onenote/sections?': {
      value: [
        { id: 'mp', displayName: 'Montepulciano', parentNotebook: { displayName: '2026-27' } },
        { id: 'mp28', displayName: 'Montepulciano 2028', parentNotebook: { displayName: '2027-28' } },
      ],
    },
    '/sections/mp/pages': pages(['CL Aufgaben — Montepulciano']),
  };
  const { text } = await callList(graph, { section: 'Montepulciano' });
  assert.match(text, /Found in notebook "2026-27"/);
  assert.match(text, /Montepulciano 2028 \(notebook: 2027-28\)/);
  assert.match(text, /ask before using this section/);
});

test('the same name in two seasons is refused, with the key to choose', async () => {
  const { text } = await callList(SEASONS, { section: 'MV 2' });
  assert.match(text, /2 sections are named "MV 2"/);
  assert.match(text, /notebook: 2026-27/);
  assert.match(text, /notebook: 2027-28/);
  assert.match(text, /notebook_key: \S+/);
  assert.doesNotMatch(text, /Eins|Zwei/, 'pages from an unchosen season were shown');
});

test('a project name alone is offered its section and season, not resolved', async () => {
  const { text } = await callList(SEASONS, { section: 'Melk' });
  assert.match(text, /Closest: BCW Melk Gansch \(notebook: 2026-27\)/);
  assert.doesNotMatch(text, /CL Aufgaben/);
});

test('the key offered in a refusal is accepted on the follow-up call', async () => {
  const first = await callList(SEASONS, { section: 'MV 2' });
  const key = first.text.match(/notebook_key: (\S+)/)[1];
  const { text } = await callList(SEASONS, { section: 'MV 2', notebook: '2027-28', notebook_key: key });
  assert.match(text, /Zwei/);
  assert.doesNotMatch(text, /Eins/);
});

test('without a section, every section is walked as before', async () => {
  const { seen } = await callList(GRAPH, {});
  for (const id of ['melk', 'megeve', 'empty']) {
    assert.ok(seen.some((u) => u.includes(`/sections/${id}/pages`)), `skipped ${id}`);
  }
});

/** The page an update goes to, named in the reply. Title shapes are the live notebook's. */
test('the one CL Aufgaben page is named as the update target, whatever follows the prefix', async () => {
  for (const title of ['CL Aufgaben', 'CL Aufgaben — Melk BCW (Barocktage 2027)']) {
    const graph = { ...GRAPH, '/sections/melk/pages': pages([title, 'Programm']) };
    const { text } = await callList(graph, { section: 'GPT Melk' });
    assert.match(text, /An update to this project belongs on this page/, title);
  }
});

test('the target is found even when limit cuts it from the list', async () => {
  const graph = {
    ...GRAPH,
    '/sections/melk/pages': {
      value: [
        { id: 'new', title: 'Neu', lastModifiedDateTime: '2026-09-10T00:00:00Z' },
        { id: 'cl', title: 'CL Aufgaben', lastModifiedDateTime: '2026-01-01T00:00:00Z' },
      ],
    },
  };
  const { text } = await callList(graph, { section: 'GPT Melk', limit: 1 });
  assert.match(text, /CL Aufgaben page in this section: "CL Aufgaben" \(id: cl\)/);
});

test('a section without a CL Aufgaben page says the update has nowhere to go', async () => {
  const { text } = await callList(GRAPH, { section: 'BCW Megeve' });
  assert.match(text, /no CL Aufgaben page/);
  assert.match(text, /do not write it onto another page/);
});

test('two CL Aufgaben pages are refused, not picked', async () => {
  const graph = { ...GRAPH, '/sections/melk/pages': pages(['CL Aufgaben', 'CL Aufgaben alt']) };
  const { text } = await callList(graph, { section: 'GPT Melk' });
  assert.match(text, /2 CL Aufgaben pages/);
  assert.match(text, /Do not pick one/);
});

test('other CL pages are not mistaken for the task page', async () => {
  const graph = { ...GRAPH, '/sections/melk/pages': pages(['CL Status & Termine', 'CL Konditionen']) };
  const { text } = await callList(graph, { section: 'GPT Melk' });
  assert.match(text, /no CL Aufgaben page/);
});

/**
 * A chosen notebook narrows the walk before any page is fetched. Filtering after
 * the fact is what made a map of one season pay for all 56 sections on a real
 * account, and time out on hosted every time.
 */
test('a chosen notebook walks only its own sections', async () => {
  const first = await callList(SEASONS, {});
  const key = first.text.match(/notebook_key: (\S+)/)[1];
  const { text, seen } = await callList(SEASONS, { notebook: '2027-28', notebook_key: key });

  assert.match(text, /Zwei/);
  assert.ok(seen.some((u) => u.includes('/sections/mv27/pages')));
  assert.ok(
    !seen.some((u) => u.includes('/sections/melk/pages') || u.includes('/sections/mv26/pages')),
    'fetched pages of a notebook that was not chosen',
  );
});

/** list_notebooks and list_notes used to fetch the same sections list twice per call. */
test('one call fetches the sections list once', async () => {
  const first = await callList(SEASONS, {});
  const key = first.text.match(/notebook_key: (\S+)/)[1];
  const { seen } = await callList(SEASONS, { notebook: '2027-28', notebook_key: key });
  assert.equal(seen.filter((u) => u.includes('/me/onenote/sections?')).length, 1);
});
