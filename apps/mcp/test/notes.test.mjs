import assert from 'node:assert/strict';
import test from 'node:test';

import { htmlToText, listNotes, mapNotes, narrowNotes, readNote } from '../dist/notes.js';

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
    // Carried on every page so a caller cannot read the date without also
    // being told whether it means anything. False here: the stub gives the
    // section no timestamp, so nothing contradicts the page.
    date_is_creation: false,
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

  // A normal page is unaffected, byte for byte, and reports itself as whole.
  assert.deepEqual(await readNote('token', 'p1'), {
    title: 'Soundcheck',
    text: 'Line one\nLine two',
    chars_total: 17,
    parts_total: 1,
    part: 1,
    next_from_part: null,
  });
});

/**
 * A disorganised notebook is exactly where one enormous page lives — a year of
 * gig notes under a single heading. Returning it whole swallowed the context
 * the analysis needed, and said nothing about having done so.
 */
const longPage = (chars) => ({
  '/pages/big?': { title: 'Gig notes' },
  '/pages/big/content': `<p>${'x'.repeat(chars)}</p>`,
});

test('an oversized page is split into parts rather than returned whole', async () => {
  stubGraph(longPage(100_000));

  const first = await readNote('token', 'big');
  assert.equal(first.part, 1);
  assert.equal(first.parts_total, 3);
  assert.equal(first.chars_total, 100_000);
  assert.equal(first.text.length, 40_000);
  // Never truncated silently: the way to read the rest comes back with it.
  assert.equal(first.next_from_part, 2);
});

test('the parts cover the page exactly, with nothing dropped or repeated', async () => {
  stubGraph(longPage(90_000));

  const parts = [];
  for (let part = 1; part !== null; ) {
    const read = await readNote('token', 'big', part);
    parts.push(read.text);
    part = read.next_from_part;
  }

  assert.equal(parts.length, 3);
  assert.equal(parts.join('').length, 90_000);
});

test('the last part says it is the last rather than pointing nowhere', async () => {
  stubGraph(longPage(50_000));

  const last = await readNote('token', 'big', 2);
  assert.equal(last.part, 2);
  assert.equal(last.next_from_part, null);
  assert.equal(last.text.length, 10_000);
});

test('a part beyond the end is clamped to the last, not answered as empty', async () => {
  stubGraph(longPage(50_000));

  const read = await readNote('token', 'big', 99);
  assert.equal(read.part, 2);
  assert.ok(read.text.length > 0);
});

test('a nonsense part reads as the first rather than failing the read', async () => {
  stubGraph(longPage(50_000));

  for (const asked of [0, -3, 1.7, undefined, 'first']) {
    const read = await readNote('token', 'big', asked);
    assert.equal(read.part, 1, `from_part ${asked}`);
  }
});

/**
 * `since` and `limit` narrow a list that has already been fetched in full. The
 * saving is context, not Graph calls, so these are pure and stubless.
 */
const page = (id, last_modified) => ({
  id,
  title: id,
  section: null,
  notebook: null,
  last_modified,
});

const dated = [
  page('new', '2026-08-14T09:00:00Z'),
  page('boundary', '2026-08-10T00:00:00Z'),
  page('old', '2026-01-01T00:00:00Z'),
];

test('omitting since and limit is exactly the list that went in', () => {
  const result = narrowNotes(dated);
  assert.deepEqual(result.notes, dated);
  assert.equal(result.matched, 3);
  assert.equal(result.undated, 0);
});

test('since is inclusive of the day it names, so "since the 10th" includes the 10th', () => {
  const result = narrowNotes(dated, { since: '2026-08-10' });
  assert.deepEqual(
    result.notes.map((n) => n.id),
    ['new', 'boundary'],
  );
});

test('an undated page is excluded from a since window rather than assumed recent', () => {
  const result = narrowNotes([...dated, page('undated', null)], { since: '2026-08-10' });
  assert.deepEqual(
    result.notes.map((n) => n.id),
    ['new', 'boundary'],
  );
  // Counted, so the caller can say it rather than silently dropping the page.
  assert.equal(result.undated, 1);
});

test('an unparseable timestamp is treated as undated, not as matching', () => {
  const result = narrowNotes([page('junk', 'last Tuesday')], { since: '2026-08-10' });
  assert.equal(result.notes.length, 0);
  assert.equal(result.undated, 1);
});

test('limit truncates and still reports how many matched', () => {
  const result = narrowNotes(dated, { limit: 2 });
  assert.deepEqual(
    result.notes.map((n) => n.id),
    ['new', 'boundary'],
  );
  assert.equal(result.matched, 3);
});

test('limit counts what since matched, not what was fetched', () => {
  const result = narrowNotes(dated, { since: '2026-08-10', limit: 1 });
  assert.deepEqual(
    result.notes.map((n) => n.id),
    ['new'],
  );
  assert.equal(result.matched, 2);
});

/**
 * A filter that quietly does nothing returns the whole notebook, and nothing
 * distinguishes that from a notebook where everything really did move.
 */
test('an unreadable since is refused rather than ignored', () => {
  assert.throws(() => narrowNotes(dated, { since: 'whenever' }), /Could not read "whenever"/);
});

test('a limit that is not a whole page count is refused', () => {
  assert.throws(() => narrowNotes(dated, { limit: 0 }), /at least 1/);
  assert.throws(() => narrowNotes(dated, { limit: 1.5 }), /whole number/);
});

/**
 * The cheap route is /preview, but a preview that cannot do the job must not be
 * passed off as though it had. Graph caps it near 300 characters and never says
 * so, which is exactly the kind of quiet shortfall that makes a survey read as
 * complete when it is not.
 */
test('a notebook is sketched from previews, one call per page', async () => {
  const seen = stubGraph({
    '/pages/p1/preview': { previewText: 'Concert Name  Classical Horizons\nVenue  Staatsoper Wien' },
    '/pages/p2/preview': { previewText: 'Venue list, updated after the Graz run in October' },
  });

  const { sketches, read_in_full } = await mapNotes('token', [
    page('p1', '2026-08-01T00:00:00Z'),
    page('p2', '2026-07-01T00:00:00Z'),
  ]);

  assert.deepEqual(sketches.map((s) => s.source), ['preview', 'preview']);
  assert.equal(read_in_full, 0);
  // The cheap route only. No page content was fetched.
  assert.equal(seen.filter((p) => p.includes('/content')).length, 0);
});

test('an empty preview falls back to reading that page, and says why', async () => {
  const seen = stubGraph({
    '/pages/p1/preview': { previewText: '' },
    '/pages/p1?': { title: 'Gig notes' },
    '/pages/p1/content': '<p>Everything that matters is further down the page</p>',
  });

  const { sketches, read_in_full } = await mapNotes('token', [page('p1', null)]);

  assert.equal(sketches[0].source, 'page');
  assert.match(sketches[0].sketch, /Everything that matters/);
  assert.match(sketches[0].fell_back, /no preview text/);
  assert.equal(read_in_full, 1);
  assert.equal(seen.filter((p) => p.includes('/content')).length, 1);
});

/**
 * The floor buys a confirming read on a tiny page, which is cheap: a preview of
 * 37 characters means a page of 37 characters, so the fallback costs one small
 * fetch and removes the doubt. Passing the stub off as a sketch would not.
 */
test('the floor is exact, so a page just over it is not read again', async () => {
  const seen = stubGraph({ '/pages/p1/preview': { previewText: 'x'.repeat(40) } });

  const [sketch] = (await mapNotes('token', [page('p1', null)])).sketches;
  assert.equal(sketch.source, 'preview');
  assert.equal(seen.filter((p) => p.includes('/content')).length, 0);
});

test('a preview too thin to triage on is not accepted as a sketch', async () => {
  stubGraph({
    '/pages/p1/preview': { previewText: 'notes' },
    '/pages/p1?': { title: 'Gig notes' },
    '/pages/p1/content': `<p>${'detail '.repeat(200)}</p>`,
  });

  const [sketch] = (await mapNotes('token', [page('p1', null)])).sketches;
  assert.equal(sketch.source, 'page');
  assert.match(sketch.fell_back, /only 5 characters/);
});

/** Case by case: one bad preview must not turn the whole map into full reads. */
test('only the pages that need it are read in full', async () => {
  const seen = stubGraph({
    '/pages/p1/preview': { previewText: 'x'.repeat(300) },
    '/pages/p2/preview': { previewText: '' },
    '/pages/p2?': { title: 'Thin' },
    '/pages/p2/content': '<p>read instead</p>',
  });

  const { sketches, read_in_full } = await mapNotes('token', [
    page('p1', null),
    page('p2', null),
  ]);

  assert.deepEqual(sketches.map((s) => s.source), ['preview', 'page']);
  assert.equal(read_in_full, 1);
  assert.equal(seen.filter((p) => p.includes('/content')).length, 1);
});

test('a page neither route can sketch is reported, never dropped from the map', async () => {
  stubGraph({ '/pages/p1/preview': { previewText: '' } });

  const [sketch] = (await mapNotes('token', [page('p1', null)])).sketches;
  assert.equal(sketch.source, 'none');
  assert.equal(sketch.sketch, null);
  assert.ok(sketch.error);
  // Present in the map: a page missing from a survey reads as a page that is
  // not there at all.
  assert.equal(sketch.id, 'p1');
});

/**
 * Graph does not say it truncated, so a preview that arrived at full length is
 * the only evidence the page continues. A short one is a short page.
 */
test('a full-length preview reports more to come, a short one does not', async () => {
  stubGraph({
    '/pages/p1/preview': { previewText: 'x'.repeat(300) },
    '/pages/p2/preview': { previewText: 'thurs 8pm, bring the good mics' },
  });

  const { sketches } = await mapNotes('token', [page('p1', null), page('p2', null)]);
  assert.equal(sketches[0].more, true);
  assert.equal(sketches[1].more, false);
});

/**
 * A to-do tag lives in an attribute, and the tag stripper discards attributes.
 * Without the markers a ticked task and an open one arrive as the same line,
 * so the notebook's own record of what is done becomes invisible to the tool.
 */
test('a to-do tag survives as a marker, ticked apart from open', () => {
  const text = htmlToText(
    '<p data-tag="to-do:completed">Vertrag zurückgeschickt</p>' +
      '<p data-tag="to-do">Kurzbio nachreichen</p>',
  );

  assert.equal(text, '[x] Vertrag zurückgeschickt\n[ ] Kurzbio nachreichen');
});

test('a to-do on a list item keeps both the bullet and the marker', () => {
  assert.equal(htmlToText('<ul><li data-tag="to-do">Flüge buchen</li></ul>'), '- [ ] Flüge buchen');
});

/**
 * OneNote allows several tags on one paragraph, so the to-do can arrive beside
 * others. A paragraph tagged only `important` is not a task and gets no marker.
 */
test('a to-do among other tags is still a to-do, and a non-to-do tag is not', () => {
  const text = htmlToText(
    '<p data-tag="important,to-do:completed">Foto geschickt</p>' +
      '<p data-tag="important">Gage 10.000 €</p>',
  );

  assert.equal(text, '[x] Foto geschickt\nGage 10.000 €');
});
