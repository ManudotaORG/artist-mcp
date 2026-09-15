import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { createSection } from '../dist/onenote-write.js';
import { notebookKeyFor } from '../dist/notes.js';

/**
 * create_onenote_section: one section per call, under Notes.Create.
 * See docs/decisions/0011-creating-sections.md.
 */

const NOTEBOOKS = {
  value: [
    { id: 'nb-messy', displayName: 'ARTIST-MCP TEST (MESSY)', sections: [{ displayName: 'Alt' }] },
    { id: 'nb-season', displayName: '2026-27', sections: [] },
  ],
};

const stub = () => {
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    sent.push({ path, method: init.method ?? 'GET', body: init.body });
    if (path.includes('/me/onenote/notebooks?')) {
      return new Response(JSON.stringify(NOTEBOOKS), { status: 200 });
    }
    if (init.method === 'POST' && path.endsWith('/sections')) {
      const { displayName } = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'sec-new', displayName }), { status: 201 });
    }
    return new Response('{}', { status: 404 });
  };
  return sent;
};

const original = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = original;
});

const noRecord = async () => {};

test('creates one section in the named notebook, and records it', async () => {
  const sent = stub();
  const records = [];
  const result = await createSection(
    'token',
    { notebook: 'ARTIST-MCP TEST (MESSY)', name: 'Test 01' },
    async (entry) => records.push(entry),
  );

  const posts = sent.filter((r) => r.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].path, /\/me\/onenote\/notebooks\/nb-messy\/sections$/);
  assert.deepEqual(JSON.parse(posts[0].body), { displayName: 'Test 01' });
  assert.equal(result.name, 'Test 01');
  assert.equal(records.length, 1);
  assert.equal(records[0].operation, 'create_onenote_section');
});

test('a name already in that notebook is refused, and nothing is written', async () => {
  const sent = stub();
  await assert.rejects(
    createSection('token', { notebook: 'ARTIST-MCP TEST (MESSY)', name: '  alt ' }, noRecord),
    /already has a section named/,
  );
  assert.ok(!sent.some((r) => r.method === 'POST'));
});

test('names OneNote would reject are refused before sending', async () => {
  const sent = stub();
  for (const name of ['a/b', 'what?', 'x'.repeat(51), '', 'TBC']) {
    await assert.rejects(createSection('token', { notebook: '2026-27', name }, noRecord));
  }
  assert.ok(!sent.some((r) => r.method === 'POST'));
});

test('an unknown notebook is refused, and nothing is written', async () => {
  const sent = stub();
  await assert.rejects(
    createSection('token', { notebook: 'Nope', name: 'Test' }, noRecord),
    /No notebook named "Nope"/,
  );
  assert.ok(!sent.some((r) => r.method === 'POST'));
});

const toolServer = async (calls) => {
  const names = ['ARTIST-MCP TEST (MESSY)', '2026-27'];
  const dispatch = async (op, params) => {
    calls.push(op);
    if (op === 'list_notebooks') {
      return { notebooks: names.map((name) => ({ name, sections: 1 })), section_list: [] };
    }
    if (op === 'create_onenote_section') {
      return { name: params.name, notebook: params.notebook, section_id: 'sec-new' };
    }
    throw new Error(`unexpected ${op}`);
  };
  return { server: await createServer(dispatch, ['onenote-create-section']), key: notebookKeyFor(names) };
};

test('the tool refuses a notebook named without its notebook_key', async () => {
  const calls = [];
  const { server } = await toolServer(calls);
  const result = await server._registeredTools.create_onenote_section.handler({
    notebook: '2026-27',
    name: 'Test',
  });
  assert.ok(!calls.includes('create_onenote_section'), 'a guessed notebook was written to');
  assert.match(result.content[0].text, /notebook_key/);
});

test('the tool creates the section when the notebook comes with its key', async () => {
  const calls = [];
  const { server, key } = await toolServer(calls);
  const result = await server._registeredTools.create_onenote_section.handler({
    notebook: 'ARTIST-MCP TEST (MESSY)',
    notebook_key: key,
    name: 'Test 01',
  });
  assert.ok(calls.includes('create_onenote_section'));
  assert.match(result.content[0].text, /Created the section "Test 01" in ARTIST-MCP TEST \(MESSY\)/);
});

test('the tool is absent without the grant', async () => {
  const server = await createServer(async () => ({}), ['onenote-create']);
  assert.equal(server._registeredTools.create_onenote_section, undefined);
});
