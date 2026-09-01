import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEdit,
  editFrom,
  inherit,
  previewEdit,
  markRows,
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
const loose2 = `p:{${GUID}}{70}`;

const pageHtml = () =>
  `<html><body><div id="div:{${GUID}}{32}">` +
  `<p id="${loose}">Programm</p>` +
  `<table id="${table}"><tr>` +
  `<td><p id="${cell}">Honorar</p></td><td><p id="p:{${GUID}}{54}">1200</p></td>` +
  `</tr><tr>` +
  `<td><p id="p:{${GUID}}{55}">Anreise</p></td><td><p id="p:{${GUID}}{56}">UNKNOWN</p></td>` +
  `</tr></table>` +
  `<p id="${loose2}">Signatur</p>` +
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
  assert.match(shown.note, /a table is replaced whole, every row of it/);
});

test('a table takes markup, and a paragraph takes either', () => {
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'replace', element_id: table, text: 'Honorar 1400' }),
    /replaced with markup/,
  );
  assert.throws(
    () =>
      editFrom({ page_id: 'p1', action: 'replace', element_id: table, text: 'x', html: newTable('1') }),
    /not both/,
  );

  // A paragraph replaced by several elements at once: the intro becomes itself
  // plus a heading plus a table, which is how a section is added mid-page.
  // Verified against a real page before it was allowed here.
  const draft = editFrom({
    page_id: 'p1',
    action: 'replace',
    element_id: loose,
    html: `<p>Programm</p><p>Ausfüllkonventionen</p>${newTable('1400')}`,
  });
  assert.equal(draft.changes[0].action, 'replace');
  assert.match(draft.changes[0].html, /Ausfüllkonventionen/);
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

test('an insert anchors on a paragraph as well as a table', () => {
  // Graph supports a sibling insert on a p, verified against a real page. On
  // these pages that is the case that matters: a new section belongs between an
  // intro paragraph and the heading under it, and both neighbours are
  // paragraphs.
  const draft = editFrom({
    page_id: 'p1',
    action: 'insert',
    element_id: loose,
    position: 'after',
    html: '<p>x</p>',
  });
  assert.equal(draft.changes[0].position, 'after');

  assert.throws(
    () =>
      editFrom({
        page_id: 'p1',
        action: 'insert',
        element_id: `li:{33f8a242-7c33-4bb2-90c5-8425a68cc5bf}{60}`,
        position: 'after',
        html: '<p>x</p>',
      }),
    /paragraph, a heading or a table/,
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
  assert.match(shown.note, /Nothing on the page is overwritten or removed/);
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

test('a change past the fortieth character is visible in the preview', async () => {
  // The defect this exists for, found in use: cells were clipped at forty
  // characters, so a single-cell table holding a paragraph — which is what
  // these pages use for a free-text section — rendered before and after as the
  // same truncated line. The preview showed a destructive change as a no-op.
  const sentence =
    'Musik aus Lateinamerika (Vidala-Programm), zusammengestellt mit dem Veranstalter';
  const html = `<html><body><table id="${table}"><tr><td><p>${sentence} im Mai.</p></td></tr></table></body></html>`;
  const { fetchImpl } = server({ html });

  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', {
      page_id: 'p1',
      action: 'replace',
      element_id: table,
      html: `<table><tr><td><p>${sentence} im Juni.</p></td></tr></table></table>`.replace(
        '</table></table>',
        '</table>',
      ),
    }),
  );

  const [was, willBe] = shown.preview.split('With this:');
  assert.notEqual(was, willBe, 'the two halves of a preview must not be identical');
  assert.match(was, /im Mai\./);
  assert.match(willBe, /im Juni\./);
  assert.ok(!shown.preview.includes('…'), 'nothing may be cut out of a preview');
});

test('a rendered table keeps every character, wrapped inside its column', () => {
  const long = `<table><tr><td>${'x '.repeat(80)}</td><td>b</td></tr></table>`;
  const rendered = renderTable(long);

  assert.equal((rendered.match(/x/g) ?? []).length, 80, 'no character may be dropped');
  assert.ok(
    rendered.split('\n').every((line) => line.length <= 100),
    'and it still has to fit on a line',
  );
  // One row, wrapped: the second column is empty on the continuation lines
  // rather than repeated, so the row still reads as one row.
  assert.equal((rendered.match(/\| b /g) ?? []).length, 1);
});

test('only the rows that differ are marked, however they moved', () => {
  const before = [['Honorar', '1200'], ['Anreise', 'UNKNOWN'], ['Signatur', 'CL']];
  const after = [
    ['Ausfüllkonventionen', 'UNKNOWN heißt ungeklärt'],
    ['Honorar', '1450'],
    ['Anreise', 'UNKNOWN'],
    ['Signatur', 'CL'],
  ];

  const marks = markRows(before, after);

  // A row added at the top must not mark everything under it as changed: a
  // preview where every row is flagged says as little as one where none is.
  assert.deepEqual(marks.after, ['+', '+', ' ', ' ']);
  assert.deepEqual(marks.before, ['-', ' ', ' ']);
});

test('a replace that changes no words says so instead of implying an edit', async () => {
  const { fetchImpl } = server();
  const same = pageHtml()
    .slice(pageHtml().indexOf('<table'), pageHtml().indexOf('</table>') + 8)
    .replace(/ id="[^"]*"/g, '')
    .replace('<table', '<table border="1"');

  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: table, html: same }),
  );

  assert.match(shown.preview, /Every row reads exactly as it does now/);
  assert.match(shown.preview, /What differs is the markup/);
});

test('a replacement keeps the formatting it does not specify', () => {
  // Both halves observed on a real page: a bordered table replaced by a bare
  // <table> comes back as border:0px, and a heading replaced by a bare <p>
  // comes back with no span at all — and on these pages the span is the whole
  // of what made it a heading.
  const heading =
    '<p id="x" style="margin-top:0pt"><span style="font-size:16pt;font-weight:bold">Projektzustand</span></p>';
  const kept = inherit(heading, '<p>Projektzustand 2026</p>');

  assert.match(kept.html, /font-weight:bold/);
  assert.match(kept.html, /margin-top:0pt/);
  assert.match(kept.html, /Projektzustand 2026/);
  assert.ok(!kept.html.includes('id="x"'), 'an id is never copied onto the replacement');
  assert.equal(kept.notes.length, 2);

  const borders = inherit(
    '<table id="t" border="1" style="border:1pt solid #a3a3a3"><tr><td>a</td></tr></table>',
    '<table><tr><td>b</td></tr></table>',
  );
  assert.match(borders.html, /border="1"/);
  assert.match(borders.html, /1pt solid/);
});

test('a caller that specifies formatting has decided, and inherits nothing', () => {
  const heading =
    '<p style="margin-top:0pt"><span style="font-size:16pt;font-weight:bold">Projektzustand</span></p>';

  const own = inherit(heading, '<p style="margin-top:9pt"><span style="color:red">Neu</span></p>');
  assert.match(own.html, /margin-top:9pt/);
  assert.ok(!own.html.includes('font-weight:bold'), 'their styling is not merged with ours');
  assert.deepEqual(own.notes, []);

  // A different kind of element inherits nothing either: a paragraph becoming a
  // table has nothing to carry across.
  assert.deepEqual(inherit(heading, '<table><tr><td>a</td></tr></table>').notes, []);
});

test('what is inherited is shown, not slipped in', async () => {
  const html =
    `<html><body><p id="${loose}" style="margin-top:0pt">` +
    '<span style="font-size:16pt;font-weight:bold">Programm</span></p></body></html>';
  const { fetchImpl } = server({ html });

  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', {
      page_id: 'p1',
      action: 'replace',
      element_id: loose,
      html: '<p>Programm 2026</p>',
    }),
  );

  assert.match(shown.preview, /Keeping .*character styling inside the p it replaces/s);
  assert.match(shown.preview, /would land as ordinary body text/);
});

test('a preview keeps the paragraph breaks the markup has', async () => {
  // asText stripped every tag and left the text run together, so a replacement
  // made of three paragraphs previewed as one line and read as a different
  // change from the one being made.
  const { fetchImpl } = server();
  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', {
      page_id: 'p1',
      action: 'replace',
      element_id: loose,
      html: '<p>Programm</p><p>Ausfüllkonventionen</p><p>UNKNOWN heißt ungeklärt</p>',
    }),
  );

  const after = shown.preview.slice(shown.preview.indexOf('With this:'));
  assert.match(after, /Programm\nAusfüllkonventionen\nUNKNOWN heißt ungeklärt/);
});

test('several changes ride in one write, and are approved as one', async () => {
  const { sent, fetchImpl } = server();
  const { record, lines } = audit();

  const changes = [
    { action: 'replace', element_id: table, html: newTable('1450') },
    { action: 'insert', element_id: loose, position: 'after', html: '<p>Mitschnitt: UNKNOWN</p>' },
    { action: 'replace', element_id: loose2, text: 'Signatur, CL' },
  ];

  const shown = await withFetch(fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', changes }),
  );

  assert.match(shown.preview, /3 changes, applied together in one write/);
  assert.match(shown.note, /if any one of them cannot be applied then none of them is/);

  await withFetch(fetchImpl, () =>
    applyEdit('t', { page_id: 'p1', changes, confirmation_token: shown.confirmation_token }, record),
  );

  // One PATCH, three commands, in the order they were given. That is the whole
  // point: the ids move once the write happens, so three writes would need
  // three reads.
  assert.equal(sent.length, 1, 'a batch is one request');
  assert.deepEqual(
    sent[0].body.map((c) => [c.target, c.action, c.position ?? null]),
    [
      [table, 'replace', null],
      [loose, 'insert', 'after'],
      [loose2, 'replace', null],
    ],
  );

  // One log line per change: a restore is per element, and a summary of three
  // changes is not something anybody can put back.
  assert.equal(lines.length, 3);
  assert.match(lines[0].summary, /^\[1\/3\]/);
  assert.equal(lines[1].pre_image, null, 'an insert destroys nothing');
  assert.ok(lines[0].pre_image.startsWith('<table id='));
});

test('a batch fails closed as a whole, not change by change', async () => {
  const { fetchImpl } = server();
  const changes = [
    { action: 'replace', element_id: table, html: newTable('1450') },
    { action: 'replace', element_id: loose, text: 'Programm 2026' },
  ];
  const shown = await withFetch(fetchImpl, () => previewEdit('t', { page_id: 'p1', changes }));

  // The musician edited the SECOND element in OneNote after the preview. The
  // first change is still exactly what was shown, and it must not go anyway:
  // they approved the pair.
  const moved = server({ html: pageHtml().replace('Programm', 'Programmheft') });

  await assert.rejects(
    withFetch(moved.fetchImpl, () =>
      applyEdit(
        't',
        { page_id: 'p1', changes, confirmation_token: shown.confirmation_token },
        audit().record,
      ),
    ),
    /not what was previewed/,
  );
  assert.equal(moved.sent.length, 0, 'nothing may go out when any part of a batch has moved');
});

test('two changes aimed at one element are refused rather than ordered', () => {
  assert.throws(
    () =>
      editFrom({
        page_id: 'p1',
        changes: [
          { action: 'replace', element_id: table, html: newTable('1450') },
          { action: 'replace', element_id: table, html: newTable('1500') },
        ],
      }),
    /only the last one survives/,
  );
});

test('a batch and a single change cannot be given at once', () => {
  assert.throws(
    () =>
      editFrom({
        page_id: 'p1',
        action: 'replace',
        element_id: loose,
        text: 'x',
        changes: [{ action: 'replace', element_id: table, html: newTable('1') }],
      }),
    /not both/,
  );
});

test('a named change gets an index of the page, not the page', async () => {
  const long = 'Musik aus Lateinamerika, zusammengestellt mit dem Veranstalter und dem Orchester';
  const html =
    `<html><body><p id="${loose}">${long}</p>` +
    `<table id="${table}"><tr><td><p>Honorar</p></td><td><p>1200</p></td></tr></table>` +
    `<p id="${loose2}">Signatur</p></body></html>`;

  const probe = await withFetch(server({ html }).fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace' }),
  );
  const named = await withFetch(server({ html }).fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: loose2, text: 'Signatur, CL' }),
  );

  // The probe is the call whose whole purpose is showing the page.
  assert.equal(probe.abbreviated, false);
  assert.match(probe.parts.find((x) => x.element_id === loose).text, /dem Orchester$/);
  assert.match(probe.parts.find((x) => x.kind === 'table').text, /\| Honorar \| 1200 \|/);

  // Naming one gets an index: shorter, and saying that it is shorter.
  assert.equal(named.abbreviated, true);
  assert.ok(named.parts.find((x) => x.element_id === loose).text.endsWith('…'));
  // A table in an index is described by its shape. Its cells run together on
  // one line read as a single row of four, which is a worse description of the
  // page than none.
  assert.match(
    named.parts.find((x) => x.kind === 'table').text,
    /^1 row × 2 columns, starting "Honorar \| 1200"$/,
  );
  assert.ok(
    named.parts.every((part) => !part.text.includes('\n')),
    'an index is one line per part',
  );

  // What is being decided is never abbreviated.
  assert.match(named.preview, /Replace this:\n\nSignatur\n\nWith this:\n\nSignatur, CL/);
});
