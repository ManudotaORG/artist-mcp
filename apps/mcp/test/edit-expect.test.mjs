import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEdit, editFrom, previewEdit } from '../dist/onenote-patch.js';

/**
 * 0019 step 2: the stale-state guard without a person. A replace or insert
 * names what it read in the element it overwrites or sits beside, and the
 * server re-reads the page and refuses if that is no longer what it says.
 *
 * The token still binds the pre-image until step 4 removes it, so most tests
 * here hold the token fixed and vary only `expect`: a test that let the token
 * catch the change would pass with this guard deleted.
 */

const GUID = '33f8a242-7c33-4bb2-90c5-8425a68cc5bf';
const table = `table:{${GUID}}{50}`;
const loose = `p:{${GUID}}{40}`;

const pageHtml = ({ programm = 'Programm', fee = '1200' } = {}) =>
  `<html><body><div id="div:{${GUID}}{32}">` +
  `<p id="${loose}">${programm}</p>` +
  `<table id="${table}"><tr>` +
  `<td><p id="p:{${GUID}}{53}">Honorar</p></td><td><p id="p:{${GUID}}{54}">${fee}</p></td>` +
  `</tr><tr>` +
  `<td><p id="p:{${GUID}}{55}">Anreise</p></td><td><p id="p:{${GUID}}{56}">Zug,<br/>ab Basel</p></td>` +
  `</tr></table>` +
  `</div></body></html>`;

const server = (html = pageHtml()) => {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      return new Response(html, { status: 200, headers: { etag: 'W/"1"' } });
    }
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  };
  return { sent, fetchImpl };
};

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const record = async () => {};

const newTable = (fee) =>
  `<table><tr><td><p>Honorar</p></td><td><p>${fee}</p></td></tr>` +
  `<tr><td><p>Anreise</p></td><td><p>Zug, ab Basel</p></td></tr></table>`;

const ROWS = [
  ['Honorar', '1200'],
  ['Anreise', 'Zug, / ab Basel'],
];

/** Preview without `expect` (the preview tool's schema has none), then apply with it. */
const previewThenApply = async (s, change, expect) => {
  const preview = await withFetch(s.fetchImpl, () => previewEdit('t', { page_id: 'p1', ...change }));
  return withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      { page_id: 'p1', ...change, expect, confirmation_token: preview.confirmation_token },
      record,
    ),
  );
};

const paragraphReplace = { action: 'replace', element_id: loose, text: 'Programm 2027' };
const tableReplace = { action: 'replace', element_id: table, html: newTable('1450') };

test('a replace whose expect matches is written', async () => {
  const s = server();
  await previewThenApply(s, paragraphReplace, '  Programm ');
  assert.equal(s.sent.length, 1);
});

test('a replace whose expect no longer matches writes nothing, and says what it reads now', async () => {
  const s = server(pageHtml({ programm: 'Programmheft' }));
  await assert.rejects(previewThenApply(s, paragraphReplace, 'Programm'), (err) => {
    assert.match(err.message, /changed since it was read, so nothing was written/);
    assert.match(err.message, /now reads:\n\nProgrammheft/);
    assert.match(err.message, /their change stands/);
    return true;
  });
  assert.deepEqual(s.sent, []);
});

test('a whole table is compared cell by cell, a line break in a cell as a space', async () => {
  const s = server();
  await previewThenApply(s, tableReplace, ROWS);
  assert.equal(s.sent.length, 1);
});

test('one cell changed since the table was read refuses the whole replace', async () => {
  const s = server(pageHtml({ fee: '1300' }));
  await assert.rejects(previewThenApply(s, tableReplace, ROWS), /now reads:[\s\S]*1300/);
  assert.deepEqual(s.sent, []);
});

test('a row missing from expect is a difference, not a match on the rows given', async () => {
  const s = server();
  await assert.rejects(previewThenApply(s, tableReplace, [ROWS[0]]), /changed since it was read/);
  assert.deepEqual(s.sent, []);
});

test('an insert checks its anchor, so it cannot land beside the wrong element', async () => {
  const s = server(pageHtml({ programm: 'Ablauf' }));
  const insert = { action: 'insert', element_id: loose, position: 'after', html: '<p>Mitschnitt: ja</p>' };
  await assert.rejects(previewThenApply(s, insert, 'Programm'), /now reads:\n\nAblauf/);
  assert.deepEqual(s.sent, []);
});

test('a batch is refused whole when one change no longer matches', async () => {
  const s = server(pageHtml({ fee: '1300' }));
  const changes = [
    { ...paragraphReplace, expect: 'Programm' },
    { ...tableReplace, expect: ROWS },
  ];
  const preview = await withFetch(s.fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', changes: changes.map(({ expect, ...c }) => c) }),
  );
  await assert.rejects(
    withFetch(s.fetchImpl, () =>
      applyEdit('t', { page_id: 'p1', changes, confirmation_token: preview.confirmation_token }, record),
    ),
    (err) => {
      assert.match(err.message, /Change 2's element/);
      assert.doesNotMatch(err.message, /Change 1's element/, 'only the change that moved is named');
      return true;
    },
  );
  assert.deepEqual(s.sent, []);
});

test('expect is refused on an append, and in the wrong shape for its target', () => {
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'append', text: 'x', expect: 'y' }),
    /an append takes no expect/,
  );
  assert.throws(() => editFrom({ page_id: 'p1', ...tableReplace, expect: 'Honorar 1200' }), /for a table, expect is its rows/);
  assert.throws(() => editFrom({ page_id: 'p1', ...paragraphReplace, expect: [['Programm']] }), /as one string/);
});

test('expect does not change the token, so a preview without it still confirms', async () => {
  const s = server();
  const preview = await withFetch(s.fetchImpl, () => previewEdit('t', { page_id: 'p1', ...paragraphReplace }));
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      { page_id: 'p1', ...paragraphReplace, expect: 'Programm', confirmation_token: preview.confirmation_token },
      record,
    ),
  );
  assert.equal(s.sent.length, 1);
});
