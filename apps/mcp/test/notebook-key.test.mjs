import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotes, mapNotes, notebookKeyFor, listNotebooks } from '../dist/notes.js';
import { withGraphBatch } from './support/graph-batch.mjs';

/**
 * The gate that decides whether a notebook name was actually chosen.
 *
 * It used to be a module-level boolean — "has anything listed the notebooks
 * yet" — which is a fair reading of one CLI session and meaningless hosted,
 * where each request may land on a different instance and the flag is shared by
 * every user on the one it lands on. A cold instance refused selections the
 * user had genuinely confirmed; a warm one admitted names nobody had seen.
 *
 * Nothing tested it, which is how it shipped. These exist so the replacement
 * cannot regress to process state without something going red: the last test
 * fails outright against the old flag.
 */

const TWO_NOTEBOOKS = {
  '/me/onenote/sections?': {
    value: [
      {
        id: 'sec1',
        displayName: 'Leipzig Cosi',
        lastModifiedDateTime: '2026-08-28T15:13:02Z',
        parentNotebook: { displayName: 'Season' },
      },
      {
        id: 'sec2',
        displayName: 'Admin',
        lastModifiedDateTime: '2026-08-27T09:00:00Z',
        parentNotebook: { displayName: 'Personal' },
      },
    ],
  },
  '/sections/sec1/pages': {
    value: [{ id: 'p1', title: 'Rehearsals', lastModifiedDateTime: '2026-08-28T15:13:02Z' }],
  },
  '/sections/sec2/pages': {
    value: [{ id: 'p2', title: 'Invoices', lastModifiedDateTime: '2026-08-27T09:00:00Z' }],
  },
  '/preview': { previewText: 'x'.repeat(80) },
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const stub = () => {
  globalThis.fetch = withGraphBatch(async (url) => {
    const path = String(url);
    const match = Object.keys(TWO_NOTEBOOKS).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(TWO_NOTEBOOKS[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
};

const freshServer = async () => {
  stub();
  const dispatch = async (op, args) => {
    if (op === 'list_notebooks') return listNotebooks('token');
    if (op === 'list_notes') return listNotes('token');
    if (op === 'map_notes') return mapNotes('token', args.pages);
    throw new Error(`unexpected operation ${op}`);
  };
  return createServer(dispatch);
};

const textOf = (result) => result.content.map((c) => c.text).join('\n');

const KEY = notebookKeyFor(['Season', 'Personal']);

test('a name with no key is refused, and the refusal hands over the key', async () => {
  const server = await freshServer();
  const text = textOf(
    await server._registeredTools.map_notes.handler({ notebook: 'Season' }),
  );

  assert.match(text, /notebook_key: [0-9a-f]{8}/, 'the refusal did not print a key');
  assert.match(text, new RegExp(`notebook_key: ${KEY}`), 'the key is not the one for this account');
  assert.match(text, /Season/);
  assert.match(text, /Personal/, 'the other notebook was not offered');
});

test('a name with the right key is accepted', async () => {
  const server = await freshServer();
  const text = textOf(
    await server._registeredTools.map_notes.handler({ notebook: 'Season', notebook_key: KEY }),
  );

  assert.equal(text.includes('notebook_key:'), false, `still refused: ${text.slice(0, 200)}`);
  assert.match(text, /Rehearsals/, 'the chosen notebook was not surveyed');
  assert.equal(text.includes('Invoices'), false, 'a page from the other notebook leaked in');
});

test('a wrong key is refused like no key at all', async () => {
  const server = await freshServer();
  const text = textOf(
    await server._registeredTools.map_notes.handler({
      notebook: 'Season',
      notebook_key: 'deadbeef',
    }),
  );

  assert.match(text, /notebook_key: /, 'a bogus key was accepted');
});

test('the key is the account, not the session — a fresh server accepts it cold', async () => {
  // The old flag started false in every new process, so a hosted cold start
  // refused a selection the user had really made. Nothing is listed here first.
  const server = await freshServer();
  const text = textOf(
    await server._registeredTools.map_notes.handler({ notebook: 'Season', notebook_key: KEY }),
  );

  assert.match(text, /Rehearsals/, 'a cold server refused a proven selection');
});

test('one caller listing does not admit another caller unproven name', async () => {
  // The regression test for the leak: under the old flag, the first call set
  // process state that satisfied the gate for the second, whoever it belonged
  // to. Two separate servers, one process — as two hosted requests on one warm
  // instance.
  const first = await freshServer();
  await first._registeredTools.list_notes.handler({});

  const second = await freshServer();
  const text = textOf(
    await second._registeredTools.map_notes.handler({ notebook: 'Season' }),
  );

  assert.match(
    text,
    /notebook_key: /,
    'an unproven name was admitted because something else had listed first',
  );
});
