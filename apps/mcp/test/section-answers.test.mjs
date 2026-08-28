import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotes } from '../dist/notes.js';

/**
 * The whole path, from what Graph returns to what the musician is told.
 *
 * The unit tests cover the detector; these cover the decision it drives, which
 * is where the honesty actually lives. A correct detector feeding a response
 * that still names pages as changed would be the original bug with extra steps.
 */

const stubGraph = (routes) => {
  globalThis.fetch = async (url) => {
    const path = String(url);
    const match = Object.keys(routes).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A section that changed today, holding pages that all claim 17 August. */
const BROKEN = {
  '/me/onenote/sections?': {
    value: [
      {
        id: 'sec1',
        displayName: 'Leipzig Cosi',
        lastModifiedDateTime: '2026-08-28T15:13:02Z',
        parentNotebook: { displayName: 'Season' },
      },
    ],
  },
  '/sections/sec1/pages': {
    value: [
      {
        id: 'p1',
        title: 'Rehearsal schedule',
        createdDateTime: '2026-08-17T11:04:42Z',
        lastModifiedDateTime: '2026-08-17T11:04:42Z',
      },
      {
        id: 'p2',
        title: 'Contacts',
        createdDateTime: '2026-08-17T11:00:00Z',
        lastModifiedDateTime: '2026-08-17T11:00:00Z',
      },
    ],
  },
};

/** The same notebook on an account where the field works. */
const HEALTHY = {
  '/me/onenote/sections?': {
    value: [
      {
        id: 'sec1',
        displayName: 'Leipzig Cosi',
        lastModifiedDateTime: '2026-08-28T15:13:02Z',
        parentNotebook: { displayName: 'Season' },
      },
    ],
  },
  '/sections/sec1/pages': {
    value: [
      {
        id: 'p1',
        title: 'Rehearsal schedule',
        createdDateTime: '2026-08-17T11:04:42Z',
        lastModifiedDateTime: '2026-08-28T15:13:02Z',
      },
      {
        id: 'p2',
        title: 'Contacts',
        createdDateTime: '2026-08-17T11:00:00Z',
        lastModifiedDateTime: '2026-08-17T11:00:00Z',
      },
    ],
  },
};

const callList = async (graph, args) => {
  stubGraph(graph);
  const dispatch = async (op) => {
    if (op !== 'list_notes') throw new Error(`unexpected operation ${op}`);
    return listNotes('token');
  };
  const server = await createServer(dispatch);
  // Two calls: the first settles the notebook choice, as it does in a session.
  await server._registeredTools.list_notes.handler({});
  const result = await server._registeredTools.list_notes.handler(args);
  return result.content.map((c) => c.text).join('\n');
};

test('a since window on a broken account answers with sections, not pages', async () => {
  const text = await callList(BROKEN, { notebook: 'Season', since: '2026-08-20' });

  assert.match(text, /Leipzig Cosi/, 'the changed section is named');
  assert.match(text, /not reporting page modification times/, 'the limitation leads');

  // The point of the whole change: page titles must not appear, because naming
  // them under "changed since" asserts something unknown about each of them.
  assert.doesNotMatch(text, /Rehearsal schedule/, 'a page was named as changed');
  assert.doesNotMatch(text, /Contacts/, 'a page was named as changed');
});

test('the section answer says which page is unknowable, and how to look', async () => {
  const text = await callList(BROKEN, { notebook: 'Season', since: '2026-08-20' });
  assert.match(text, /cannot say which page/i);
  assert.match(text, /list_notes with that notebook and no `since`/);
});

test('"changed" is not overclaimed as "edited"', async () => {
  const text = await callList(BROKEN, { notebook: 'Season', since: '2026-08-20' });
  assert.match(text, /added, removed or moved/, 'a section can change without an edit');
});

test('an empty window on a broken account still says nothing changed, truthfully', async () => {
  const text = await callList(BROKEN, { notebook: 'Season', since: '2026-09-01' });
  assert.match(text, /No section in .* changed on or after 2026-09-01/);
  assert.match(text, /Nothing in the notebook was edited in that window/);
});

/**
 * The other half. A working account must not be degraded — the detector exists
 * so that the honest answer is given only where the precise one is unavailable.
 */
test('a healthy account still answers with pages', async () => {
  const text = await callList(HEALTHY, { notebook: 'Season', since: '2026-08-20' });
  assert.match(text, /Rehearsal schedule/, 'the changed page is named');
  assert.doesNotMatch(text, /not reporting page modification times/);
  // And the page that did not change stays out of the window.
  assert.doesNotMatch(text, /Contacts/);
});

test('without a since window, a broken account still lists its pages', async () => {
  const text = await callList(BROKEN, { notebook: 'Season' });
  assert.match(text, /Rehearsal schedule/);
  assert.match(text, /Contacts/);
});

/**
 * `map_notes` sketches page content, so there is no coarser version of its
 * answer — a section is not a smaller sketch, it is a different thing. Refusing
 * is the honest move, and it is also the cheap one: every sketch is a request,
 * so silently sketching the wrong set costs as well as misleads.
 */
const callMap = async (graph, args) => {
  stubGraph(graph);
  const dispatch = async (op) => {
    if (op === 'list_notes') return listNotes('token');
    throw new Error(`unexpected operation ${op}`);
  };
  const server = await createServer(dispatch);
  await server._registeredTools.list_notes.handler({});
  const result = await server._registeredTools.map_notes.handler(args);
  return result.content.map((c) => c.text).join('\n');
};

test('map_notes refuses a since window it cannot honour, and says where to go', async () => {
  const text = await callMap(BROKEN, { notebook: 'Season', since: '2026-08-20' });
  assert.match(text, /Cannot map by change on this account/);
  assert.match(text, /list_notes with `since` instead/);
  // It must not quietly sketch the pages created in that window.
  assert.doesNotMatch(text, /Rehearsal schedule/);
});
