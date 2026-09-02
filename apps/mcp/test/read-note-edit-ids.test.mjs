import assert from 'node:assert/strict';
import test from 'node:test';

import { readNote } from '../dist/notes.js';
import { editablePartsFrom } from '../dist/onenote-patch.js';
import { createServer } from '../dist/server.js';

/**
 * An edit used to need a discovery call of its own: preview_onenote_edit with
 * no change, to learn the element ids, then preview again with the change.
 *
 * Both that call and read_note fetch the same page from the same Graph
 * endpoint, differing only in `includeIDs=true`. So the reader asks for the ids
 * and the discovery call goes away. These guard the two halves of that: that
 * the ids are actually requested and returned, and that nothing changes for an
 * install with no edit grant.
 */

const stubGraph = (routes) => {
  const seen = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    seen.push(path);
    const match = Object.keys(routes).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    const value = routes[match];
    return typeof value === 'string'
      ? new Response(value, { status: 200 })
      : new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
  };
  return seen;
};

test.afterEach(() => {
  delete globalThis.fetch;
});

// Real Graph shape: `<kind>:{guid}{n}`. A shorter id is refused by design,
// because an invented one decides what gets destroyed.
const P_ID = 'p:{6f1d1a2e-1c4b-4a9e-9d3f-2b8c7e5a1f04}{10}';
const T_ID = 'table:{9a2c4b7e-5d61-4f38-8c0a-1e7b3d9f6c25}{11}';
const PAGE =
  `<p id="${P_ID}">Fee agreed at 1450</p>` +
  `<table id="${T_ID}" border="1"><tr><td><p>Honorar</p></td><td><p>1450</p></td></tr></table>`;

const page = () => ({
  '/pages/p1?': { title: 'Reiter wedding' },
  '/pages/p1/content': PAGE,
});

test('the read asks Graph for element ids', async () => {
  const seen = stubGraph(page());
  await readNote('token', 'p1');
  const content = seen.find((p) => p.includes('/content'));
  assert.match(
    content,
    /includeIDs=true/,
    'without this the ids are absent and the discovery call comes back',
  );
});

test('ids are returned only when the install can act on them', async () => {
  stubGraph(page());
  const without = await readNote('token', 'p1');
  assert.equal(without.editable, null);

  stubGraph(page());
  const with_ = await readNote('token', 'p1', 1, { withEditIds: true });
  assert.ok(Array.isArray(with_.editable));
  assert.deepEqual(
    with_.editable.map((p) => p.element_id).sort(),
    [P_ID, T_ID].sort(),
  );
  assert.equal(with_.editable.find((p) => p.element_id.startsWith('table:')).kind, 'table');
});

test('the ids never leak into the page text', async () => {
  stubGraph(page());
  const note = await readNote('token', 'p1', 1, { withEditIds: true });
  assert.doesNotMatch(note.text, /includeIDs|data-id|6f1d1a2e/);
  assert.match(note.text, /Fee agreed at 1450/);

  // And asking for them changes nothing about what the page reads as.
  stubGraph(page());
  const plain = await readNote('token', 'p1');
  assert.equal(plain.text, note.text);
  assert.equal(plain.chars_total, note.chars_total);
});

test('the index is derived from html, not from a second fetch', () => {
  // editablePartsFrom is the half of readEditableParts that does no I/O; both
  // paths must agree, or the ids a reader gets would differ from the ones a
  // preview accepts.
  const parts = editablePartsFrom(PAGE, { full: false });
  assert.deepEqual(parts.map((p) => p.element_id).sort(), [P_ID, T_ID].sort());
});

const readVia = async (grants) => {
  const server = await createServer(async (op, params) => {
    assert.equal(op, 'read_note');
    return {
      title: 'Reiter wedding',
      text: 'Fee agreed at 1450',
      attachments: [],
      chars_total: 18,
      parts_total: 1,
      part: 1,
      next_from_part: null,
      editable: params.with_edit_ids
        ? [{ element_id: T_ID, kind: 'table', text: 'Honorar | 1450' }]
        : null,
    };
  }, grants);
  return (await server._registeredTools.read_note.handler({ note_id: 'p1' })).content
    .map((c) => c.text)
    .join('');
};

test('read_note shows the editable parts to an install granted onenote-edit', async () => {
  const text = await readVia(['onenote-edit']);
  assert.match(text, /Editable parts of this page/);
  assert.match(text, /9a2c4b7e/);
  assert.match(text, /replace it whole/);
});

test('read_note says nothing about ids without the grant', async () => {
  const text = await readVia([]);
  assert.doesNotMatch(text, /Editable parts/);
  assert.doesNotMatch(text, /element id/i);
  assert.match(text, /Fee agreed at 1450/, 'the page itself still reads the same');
});
