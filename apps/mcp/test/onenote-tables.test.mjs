import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEdit,
  editFrom,
  previewEdit,
  renderTable,
  rootTag,
  tableRows,
  validateFragment,
} from '../dist/onenote-patch.js';

/**
 * Tables, which is where a filled-in page actually keeps its content.
 *
 * These are stubs and they are not the verification. `tr` and `td` support no
 * update action at all, the generated ids move after every write, and none of
 * that is observable against a stub that agrees with this file about what Graph
 * sends back. What is checked here is the part that is ours: which ids are
 * offered, what the musician is shown before agreeing, what markup is refused,
 * and the exact shape of the command that goes out. The live run is
 * scripts/spike-onenote-tables.mjs.
 */

const GUID = '33f8a242-7c33-4bb2-90c5-8425a68cc5bf';
const table = `table:{${GUID}}{50}`;
const cell = `p:{${GUID}}{53}`;
const loose = `p:{${GUID}}{40}`;

const pageHtml = () =>
  `<html><body><div id="div:{${GUID}}{32}">` +
  `<p id="${loose}">Programm</p>` +
  `<table id="${table}"><tr>` +
  `<td><p id="${cell}">Honorar</p></td><td><p id="p:{${GUID}}{54}">1200</p></td>` +
  `</tr><tr>` +
  `<td><p id="p:{${GUID}}{55}">Anreise</p></td><td><p id="p:{${GUID}}{56}">UNKNOWN</p></td>` +
  `</tr></table>` +
  `</div></body></html>`;

const server = ({ html = pageHtml(), etag = 'W/"1"' } = {}) => {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      return new Response(html, { status: 200, headers: { etag } });
    }
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
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

const audit = () => {
  const lines = [];
  return { lines, record: async (entry) => void lines.push(entry) };
};

const newTable = (fee) =>
  `<table><tr><td><p>Honorar</p></td><td><p>${fee}</p></td></tr>` +
  `<tr><td><p>Anreise</p></td><td><p>UNKNOWN</p></td></tr></table>`;

const preview = (params) =>
  withFetch(server().fetchImpl, () => previewEdit('t', { page_id: 'p1', ...params }));

test('a table is offered as a target, which is the whole point', async () => {
  const asked = await preview({ action: 'replace' });
  const ids = asked.parts.map((p) => p.element_id);

  assert.ok(ids.includes(table), 'the table itself has to be nameable or it cannot be reached');
  assert.equal(asked.parts.find((p) => p.element_id === table).kind, 'table');
});

test('a paragraph in a cell says which table to replace instead', async () => {
  // It is listed, because it is on the page and hiding it would misdescribe
  // the page. What it carries is the fact that it is not separately editable.
  const asked = await preview({ action: 'replace' });
  const inCell = asked.parts.find((p) => p.element_id === cell);

  assert.equal(inCell.inside_table, table);
  assert.equal(
    asked.parts.find((p) => p.element_id === loose).inside_table,
    null,
    'a paragraph outside every table is still a plain target',
  );
});

test('a table is previewed as rows, not as markup', async () => {
  const asked = await preview({ action: 'replace' });
  const listed = asked.parts.find((p) => p.element_id === table).text;

  assert.match(listed, /\| Honorar \| 1200 +\|/);
  assert.match(listed, /\| Anreise \| UNKNOWN \|/);
  assert.ok(!listed.includes('<td'), 'raw markup in a preview is not a preview');
});

test('the preview of a table replace shows every row that would go', async () => {
  const shown = await preview({ action: 'replace', element_id: table, html: newTable('1400') });

  assert.match(shown.preview, /Replace this:/);
  assert.match(shown.preview, /\| Anreise \| UNKNOWN \|/);
  assert.match(shown.preview, /\| Honorar \| 1400 +\|/);
  // The row that is not changing has to be visible in both halves: a table
  // replace destroys it too, and carrying it forward is the caller's job.
  assert.equal(shown.preview.match(/Anreise/g).length, 2);
  assert.match(shown.note, /the whole table, every row of it/);
});

test('a table takes markup and a paragraph does not, in both directions', () => {
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'replace', element_id: table, text: 'Honorar 1400' }),
    /replaced with markup/,
  );
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'replace', element_id: loose, html: newTable('1400') }),
    /Only a table is replaced with markup/,
  );
  assert.throws(
    () =>
      editFrom({ page_id: 'p1', action: 'replace', element_id: table, text: 'x', html: newTable('1') }),
    /not both/,
  );
});

test('replacing a table has to yield exactly one table', () => {
  for (const html of [
    '<p>Honorar 1400</p>',
    `${newTable('1400')}<p>and a stray line</p>`,
    `${newTable('1400')}${newTable('1500')}`,
  ]) {
    assert.throws(
      () => editFrom({ page_id: 'p1', action: 'replace', element_id: table, html }),
      /exactly one table|whole new table/,
      html,
    );
  }
});

test('an insert names a table and a side of it', () => {
  assert.throws(
    () =>
      editFrom({
        page_id: 'p1',
        action: 'insert',
        element_id: loose,
        position: 'after',
        html: '<p>x</p>',
      }),
    /beside a table/,
  );
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'insert', element_id: table, html: '<p>x</p>' }),
    /needs position/,
  );
  assert.throws(
    () =>
      editFrom({ page_id: 'p1', action: 'replace', element_id: table, position: 'after', html: newTable('1') }),
    /position belongs to an insert/,
  );
});

test('an insert says plainly that it removes nothing', async () => {
  const shown = await preview({
    action: 'insert',
    element_id: table,
    position: 'before',
    html: '<p>Ausfüllkonventionen</p>',
  });

  assert.match(shown.preview, /Put this before the table that currently reads:/);
  assert.match(shown.preview, /\| Honorar \| 1200 +\|/);
  assert.match(shown.note, /Nothing is overwritten/);
});

test('what goes out is one command of the shape Graph documents', async () => {
  const { sent, fetchImpl } = server();
  const { record, lines } = audit();
  const html = newTable('1400');

  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: table, html }),
  );
  await withFetch(fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'replace',
        element_id: table,
        html,
        confirmation_token: shown.confirmation_token,
      },
      record,
    ),
  );

  assert.deepEqual(sent[0].body, [{ target: table, action: 'replace', content: html }]);
  assert.equal(sent[0].headers['if-match'], 'W/"1"');
  // The pre-image is the markup, not the rendering: a restore has to be able to
  // put the table back, and rows cannot.
  assert.match(lines[0].pre_image, /^<table id=/);
  assert.match(lines[0].summary, /Honorar \| 1200/);
});

test('an insert carries its position, and logs no pre-image', async () => {
  const { sent, fetchImpl } = server();
  const { record, lines } = audit();
  const html = '<p>Eigener Probenbedarf</p>';
  const params = { page_id: 'p1', action: 'insert', element_id: table, position: 'after', html };

  const shown = await withFetch(fetchImpl, () => previewEdit('t', params));
  await withFetch(fetchImpl, () =>
    applyEdit('t', { ...params, confirmation_token: shown.confirmation_token }, record),
  );

  assert.deepEqual(sent[0].body, [
    { target: table, action: 'insert', position: 'after', content: html },
  ]);
  // Nothing was destroyed, so nothing is recorded as destroyed. A log that
  // holds content still on the page cannot be read as an undo.
  assert.equal(lines[0].pre_image, null);
  assert.equal(lines[0].operation, 'insert_onenote_element');
});

test('the token binds the markup, not the rendering of it', async () => {
  const { fetchImpl } = server();
  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: table, html: newTable('1400') }),
  );

  await assert.rejects(
    withFetch(fetchImpl, () =>
      applyEdit(
        't',
        {
          page_id: 'p1',
          action: 'replace',
          element_id: table,
          // Renders identically, and is a different table: the borders differ.
          html: newTable('1400').replace('<table>', '<table border="0">'),
          confirmation_token: shown.confirmation_token,
        },
        audit().record,
      ),
    ),
    /not what was previewed/,
  );
});

test('a page changed since the preview stops the write', async () => {
  const { fetchImpl } = server();
  const html = newTable('1400');
  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: table, html }),
  );

  // The musician typed in OneNote in between: the table now says something the
  // preview never showed.
  const moved = server({
    html: pageHtml().replace('UNKNOWN', 'Bahn, 1. Klasse'),
  });

  await assert.rejects(
    withFetch(moved.fetchImpl, () =>
      applyEdit(
        't',
        { page_id: 'p1', action: 'replace', element_id: table, html, confirmation_token: shown.confirmation_token },
        audit().record,
      ),
    ),
    /not what was previewed/,
  );
  assert.equal(moved.sent.length, 0, 'nothing may go out after a failed match');
});

test('markup that could corrupt a page is refused before anything is sent', () => {
  const refused = {
    '<table><tr><td>a</td></tr>': /unclosed/,
    '<table><tr><td>a</td></table></tr>': /closes/,
    '<p>1 < 2</p>': /stray "<"/,
    '<script>alert(1)</script>': /not a tag/,
    '<p onclick="x()">a</p>': /script handler/,
    '<p class="fancy">a</p>': /attribute "class"/,
    '<p style="background:url(x)">a</p>': /style on <p>/,
    '<a href="javascript:x">a</a>': /not an http/,
    '<td>orphan</td>': /has to sit inside/,
    '<table><tr><td/></tr></table>': /cannot be empty/,
    '<p>unfinished <b': /unfinished tag/,
  };

  for (const [html, message] of Object.entries(refused)) {
    assert.throws(() => validateFragment(html), message, html);
  }
});

test('the markup a real OneNote table is made of survives validation', () => {
  // Taken from a page in the notebook: borders and widths as OneNote writes
  // them, which is what a replace has to be able to send back.
  const real =
    '<table border="1" width="100%" style="border-collapse:collapse;border:1pt solid #a3a3a3">' +
    '<tr><td style="border:1pt solid #a3a3a3;background-color:#f2f2f2" colspan="2">' +
    '<p lang="de-DE"><b>Honorar</b></p></td></tr>' +
    '<tr><td><p>Netto<br/>zzgl. USt</p></td><td><p>1200</p></td></tr></table>';

  assert.equal(validateFragment(real), real, 'validation must not rewrite what was previewed');
  assert.equal(rootTag(real), 'table');
  assert.deepEqual(tableRows(real), [['Honorar'], ['Netto / zzgl. USt', '1200']]);
});

test('a long cell is clipped so the shape of the table stays readable', () => {
  const long = `<table><tr><td>${'x'.repeat(120)}</td><td>b</td></tr></table>`;
  const rendered = renderTable(long);

  assert.ok(rendered.includes('…'));
  assert.ok(rendered.split('\n').every((line) => line.length < 100));
});
