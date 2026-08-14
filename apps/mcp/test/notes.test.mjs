import assert from 'node:assert/strict';
import test from 'node:test';

import { htmlToText, listNotes, readNote } from '../dist/notes.js';

/** Serves canned responses by URL substring, recording every path requested. */
const stubGraph = (routes) => {
  const seen = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    seen.push(path);
    const match = Object.keys(routes).find((key) => path.includes(key));
    if (match === undefined) {
      return new Response('{}', { status: 404 });
    }
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

test('entities are decoded, with &amp; last so &amp;lt; does not become <', () => {
  assert.equal(htmlToText('<p>M&#252;ller</p>'), 'Müller');
  assert.equal(htmlToText('<p>&amp;lt;</p>'), '&lt;');
});

test('list items become bullets and nesting is flattened', () => {
  assert.equal(htmlToText('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
  assert.equal(htmlToText('<div>\t\t  spaced   out  </div>'), 'spaced out');
});

test('head, script and style content is dropped entirely', () => {
  assert.equal(htmlToText('<head><title>x</title></head><p>kept</p>'), 'kept');
  assert.equal(htmlToText('<style>p{color:red}</style><p>kept</p>'), 'kept');
});

/**
 * `/me/onenote/pages` fails the whole request with error 20266 once an account
 * has many sections. Enumerating sections is not an optimisation — it is the
 * only shape that works on organised notebooks.
 */
test('pages are fetched per section, never through /me/onenote/pages', async () => {
  const seen = stubGraph({
    '/me/onenote/sections?': {
      value: [{ id: 'sec1', displayName: 'Gigs', parentNotebook: { displayName: 'Work' } }],
    },
    '/sections/sec1/pages': {
      value: [{ id: 'p1', title: 'Soundcheck', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
    },
  });

  const { notes } = await listNotes('token');

  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0], {
    id: 'p1',
    title: 'Soundcheck',
    section: 'Gigs',
    notebook: 'Work',
    last_modified: '2026-08-01T00:00:00Z',
  });
  assert.ok(!seen.some((url) => /\/me\/onenote\/pages(\?|$)/.test(url)), 'used the failing call');
});

test('notes are newest first, and undated pages sort last rather than first', async () => {
  stubGraph({
    '/me/onenote/sections?': { value: [{ id: 'sec1', displayName: 'S' }] },
    '/sections/sec1/pages': {
      value: [
        { id: 'old', title: 'old', lastModifiedDateTime: '2026-01-01T00:00:00Z' },
        { id: 'undated', title: 'undated' },
        { id: 'new', title: 'new', lastModifiedDateTime: '2026-08-01T00:00:00Z' },
      ],
    },
  });

  const { notes } = await listNotes('token');
  assert.deepEqual(
    notes.map((n) => n.id),
    ['new', 'old', 'undated'],
  );
});

test('a section id of the wrong shape is skipped rather than put in a URL', async () => {
  const seen = stubGraph({
    '/me/onenote/sections?': { value: [{ id: '../../evil', displayName: 'bad' }] },
  });

  const { notes } = await listNotes('token');

  assert.deepEqual(notes, []);
  assert.equal(seen.length, 1, 'only the sections call should have been made');
});

test('a missing title reads as untitled rather than empty', async () => {
  stubGraph({
    '/me/onenote/sections?': { value: [{ id: 'sec1' }] },
    '/sections/sec1/pages': { value: [{ id: 'p1' }] },
  });

  const { notes } = await listNotes('token');
  assert.equal(notes[0].title, '(untitled)');
  assert.equal(notes[0].section, null);
});

test('a malformed note id is refused before any request is made', async () => {
  const seen = stubGraph({});

  for (const bad of ['', '../secret', 'a'.repeat(301), 42, undefined]) {
    await assert.rejects(() => readNote('token', bad), /note_id is missing or malformed/);
  }
  assert.equal(seen.length, 0);
});

test('a note is returned as text, not markup', async () => {
  stubGraph({
    '/pages/p1?': { title: 'Soundcheck' },
    '/pages/p1/content': '<p>Line one</p><p>Line two</p>',
  });

  assert.deepEqual(await readNote('token', 'p1'), {
    title: 'Soundcheck',
    text: 'Line one\nLine two',
  });
});
