import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEdit,
  editablePartsFrom,
  editFrom,
  inherit,
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

/** What the caller read: the fixture's table as rows. */
const ROWS = [
  ['Honorar', '1200'],
  ['Anreise', 'UNKNOWN'],
];

/** Apply one change in one call, against `html` (the fixture by default). */
const applied = async (params, html) => {
  const s = server(html === undefined ? {} : { html });
  const { lines, record } = audit();
  const result = await withFetch(s.fetchImpl, () => applyEdit('t', { page_id: 'p1', ...params }, record));
  return { ...result, sent: s.sent, lines };
};

test('a table is offered as a target, which is the whole point', () => {
  const parts = editablePartsFrom(pageHtml());
  assert.ok(parts.some((p) => p.element_id === table), 'the table itself has to be nameable or it cannot be reached');
  assert.equal(parts.find((p) => p.element_id === table).kind, 'table');
});

test('a paragraph in a cell says which table to replace instead', () => {
  // It is listed, because it is on the page and hiding it would misdescribe
  // the page. What it carries is the fact that it is not separately editable.
  const parts = editablePartsFrom(pageHtml());
  assert.equal(parts.find((p) => p.element_id === cell).inside_table, table);
  assert.equal(
    parts.find((p) => p.element_id === loose).inside_table,
    null,
    'a paragraph outside every table is still a plain target',
  );
});

test('a table is listed as rows, not as markup', () => {
  const listed = editablePartsFrom(pageHtml()).find((p) => p.element_id === table).text;
  assert.match(listed, /\| Honorar \| 1200 +\|/);
  assert.match(listed, /\| Anreise \| UNKNOWN \|/);
  assert.ok(!listed.includes('<td'), 'raw markup is not something a musician reads');
});

test('the result of a table replace shows every row that went', async () => {
  const { note } = await applied({ action: 'replace', element_id: table, html: newTable('1400'), expect: ROWS });
  assert.match(note, /Replaced this:/);
  assert.match(note, /\| Anreise \| UNKNOWN \|/);
  assert.match(note, /\| Honorar \| 1400 +\|/);
  // The row that is not changing is visible in both halves: a table replace
  // rewrites it too, and carrying it forward was the caller's job.
  assert.equal(note.match(/Anreise/g).length, 2);
  assert.match(note, /a table is replaced whole/);
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

test('an insert says what it sits beside and what it added', async () => {
  const { note } = await applied({
    action: 'insert',
    element_id: table,
    position: 'before',
    html: '<p>Ausfüllkonventionen</p>',
    expect: ROWS,
  });
  assert.match(note, /Put before the table that reads:/);
  assert.match(note, /\| Honorar \| 1200 +\|/);
  assert.match(note, /This new block:\n\nAusfüllkonventionen/);
  assert.doesNotMatch(note, /Replaced/);
});

test('what goes out is one command of the shape Graph documents', async () => {
  const html = newTable('1400');
  const { sent, lines } = await applied({ action: 'replace', element_id: table, html, expect: ROWS });

  // The border ATTRIBUTE is added, the one mechanical fix applied rather than
  // refused (0019 step 4); otherwise it is the markup as given.
  assert.deepEqual(sent[0].body, [
    { target: table, action: 'replace', content: html.replace('<table>', '<table border="1">') },
  ]);
  assert.equal(sent[0].headers['if-match'], 'W/"1"');
  // The pre-image is the markup, not the rendering: a restore has to be able to
  // put the table back, and rows cannot.
  assert.match(lines[0].pre_image, /^<table id=/);
  assert.match(lines[0].summary, /Honorar \| 1200/);
});

test('an insert carries its position, and logs no pre-image', async () => {
  const html = '<p>Eigener Probenbedarf</p>';
  const { sent, lines } = await applied({ action: 'insert', element_id: table, position: 'after', html, expect: ROWS });
  assert.deepEqual(sent[0].body, [{ target: table, action: 'insert', position: 'after', content: html }]);
  // Nothing was destroyed, so nothing is recorded as destroyed. A log that
  // holds content still on the page cannot be read as an undo.
  assert.equal(lines[0].pre_image, null);
  assert.equal(lines[0].operation, 'insert_onenote_element');
});

test('a table without the border attribute is given one, and one with it is left alone', async () => {
  // OneNote acts on the attribute and returns a CSS border alone as border:0px
  // (0017). Found by the round trip, and applied rather than refused.
  const plain = await applied({ action: 'append', html: '<table><tr><td><p>a</p></td></tr></table>' });
  assert.match(plain.sent[0].body[0].content, /^<table border="1">/);
  const own = await applied({ action: 'append', html: '<table border="0"><tr><td><p>a</p></td></tr></table>' });
  assert.match(own.sent[0].body[0].content, /^<table border="0">/);
});

test('a page changed since it was read stops the write', async () => {
  // The musician typed in OneNote in between: the table now says something the
  // caller never read.
  const moved = pageHtml().replace('UNKNOWN', 'Bahn, 1. Klasse');
  await assert.rejects(
    applied({ action: 'replace', element_id: table, html: newTable('1400'), expect: ROWS }, moved),
    /changed since it was read/,
  );
});

/** A page whose table has a header row, in the house shape: bold, shaded. */
const headed = () =>
  `<html><body><table id="${table}">` +
  '<tr><td style="background-color:#EFEFEF"><p><b>Feld</b></p></td><td style="background-color:#EFEFEF"><p><b>Wert</b></p></td></tr>' +
  '<tr><td><p>Honorar</p></td><td><p>1200</p></td></tr></table></body></html>';
const HEADED = [['Feld', 'Wert'], ['Honorar', '1200']];
const withHeader = (first, fee) =>
  `<table><tr><td><p><b>${first}</b></p></td><td><p><b>Wert</b></p></td></tr><tr><td><p>Honorar</p></td><td><p>${fee}</p></td></tr></table>`;

test('a table replace that keeps its header row goes through', async () => {
  const { sent } = await applied({ action: 'replace', element_id: table, html: withHeader('Feld', '1450'), expect: HEADED }, headed());
  assert.equal(sent.length, 1);
});

test('a table replace that rewrites the header row is refused, with the house shape', async () => {
  // What is not mechanical is refused, and the refusal carries the shape
  // (0019 step 4): a header names what every row below it means.
  await assert.rejects(
    applied({ action: 'replace', element_id: table, html: withHeader('Posten', '1450'), expect: HEADED }, headed()),
    (err) => {
      assert.match(err.message, /headed "Feld \| Wert" on the page, and the replacement's first row reads "Posten \| Wert"/);
      assert.match(err.message, /nothing was written/);
      assert.match(err.message, /<p data-tag="to-do">/, 'the house shape rides with the refusal');
      return true;
    },
  );
});

test('a table with no header row is rewritten freely, its first row included', async () => {
  // The fixture's table has no bold or shaded first row, and a free-text
  // section is a single-cell table: checking its first row would refuse every edit.
  const { sent } = await applied({
    action: 'replace',
    element_id: table,
    html: '<table><tr><td><p>Gage</p></td><td><p>1450</p></td></tr><tr><td><p>Anreise</p></td><td><p>UNKNOWN</p></td></tr></table>',
    expect: ROWS,
  });
  assert.equal(sent.length, 1);
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

test('a change past the fortieth character is visible in the result', async () => {
  // The defect this exists for, found in use: cells were clipped at forty
  // characters, so a single-cell table holding a paragraph — which is what
  // these pages use for a free-text section — rendered before and after as the
  // same truncated line, and a destructive change read as a no-op.
  const sentence =
    'Musik aus Lateinamerika (Vidala-Programm), zusammengestellt mit dem Veranstalter';
  const html = `<html><body><table id="${table}"><tr><td><p>${sentence} im Mai.</p></td></tr></table></body></html>`;
  const { note } = await applied(
    {
      action: 'replace',
      element_id: table,
      html: `<table><tr><td><p>${sentence} im Juni.</p></td></tr></table>`,
      expect: [[`${sentence} im Mai.`]],
    },
    html,
  );

  const [was, willBe] = note.split('With this:');
  assert.notEqual(was, willBe, 'the two halves must not be identical');
  assert.match(was, /im Mai\./);
  assert.match(willBe, /im Juni\./);
  assert.ok(!note.includes('…'), 'nothing may be cut out of what was changed');
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
  const same = pageHtml()
    .slice(pageHtml().indexOf('<table'), pageHtml().indexOf('</table>') + 8)
    .replace(/ id="[^"]*"/g, '')
    .replace('<table', '<table border="1"');
  const { note } = await applied({ action: 'replace', element_id: table, html: same, expect: ROWS });
  assert.match(note, /Every row reads exactly as it did/);
  assert.match(note, /only the markup differs/);
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

test('a table keeps its borders, which takes the attribute and not the style', () => {
  // Learned twice. A replacement carrying the original's exact
  // style="border:1px solid" still came back as border:0px on a real page:
  // OneNote honours the border ATTRIBUTE on a patch, and the CSS border alone
  // is ignored. scripts/copy-onenote-page.mjs already encoded this.
  const original =
    '<table id="t" style="border:1px solid;border-collapse:collapse">' +
    '<tr><td style="border:1px solid"><p>Honorar</p></td></tr></table>';

  const kept = inherit(original, '<table><tr><td><p>Honorar</p></td></tr></table>');

  assert.match(kept.html, /<table[^>]*border="1"/, 'the attribute is what OneNote acts on');
  assert.match(kept.html, /<td style="border:1px solid">/, 'and every cell carries its own');
  // The cell note is separate from the border one, and named in terms of
  // cells: "keeping the style of the table it replaces" is what the preview
  // said while it was shading every cell of a task table, and that reads as a
  // promise that nothing changed.
  assert.deepEqual(kept.notes, [
    'style of the table it replaces',
    'each cell keeps the styling of the cell it replaces, in order',
    'the borders of the table it replaces',
  ]);

  // A caller that styled a cell has decided about all of them.
  const own = inherit(original, '<table><tr><td style="border:0"><p>x</p></td></tr></table>');
  assert.ok(!own.html.includes('border:1px solid"><p>x'));
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

test('what is inherited is said, not slipped in', async () => {
  const html =
    `<html><body><p id="${loose}" style="margin-top:0pt">` +
    '<span style="font-size:16pt;font-weight:bold">Programm</span></p></body></html>';
  const { note } = await applied(
    { action: 'replace', element_id: loose, html: '<p>Programm 2026</p>', expect: 'Programm' },
    html,
  );
  assert.match(note, /Kept from what was there, since the change did not specify it: .*character styling inside the p it replaces/s);
});

test('the result keeps the paragraph breaks the markup has', async () => {
  // asText stripped every tag and left the text run together, so a replacement
  // made of three paragraphs read as one line, and as a different change.
  const { note } = await applied({
    action: 'replace',
    element_id: loose,
    html: '<p>Programm</p><p>Ausfüllkonventionen</p><p>UNKNOWN heißt ungeklärt</p>',
    expect: 'Programm',
  });
  const after = note.slice(note.indexOf('With this:'));
  assert.match(after, /Programm\nAusfüllkonventionen\nUNKNOWN heißt ungeklärt/);
});

test('several changes ride in one write, all or none', async () => {
  const { sent, fetchImpl } = server();
  const { record, lines } = audit();

  const changes = [
    { action: 'replace', element_id: table, html: newTable('1450'), expect: ROWS },
    { action: 'insert', element_id: loose, position: 'after', html: '<p>Mitschnitt: UNKNOWN</p>', expect: 'Programm' },
    { action: 'replace', element_id: loose2, text: 'Signatur, CL', expect: 'Signatur' },
  ];

  const result = await withFetch(fetchImpl, () => applyEdit('t', { page_id: 'p1', changes }, record));
  assert.match(result.note, /3 changes, applied together in one write/);

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

  // One log line per change, pending then done: a restore is per element, and
  // a summary of three changes is not something anybody can put back.
  assert.equal(lines.length, 6);
  assert.deepEqual(lines.map((l) => l.status), ['pending', 'pending', 'pending', 'done', 'done', 'done']);
  assert.match(lines[0].summary, /^\[1\/3\]/);
  assert.equal(lines[1].pre_image, null, 'an insert destroys nothing');
  assert.ok(lines[0].pre_image.startsWith('<table id='));
  assert.equal(new Set(lines.slice(0, 3).map((l) => l.write_id)).size, 3, 'a write id per change');
});

test('a batch fails closed as a whole, not change by change', async () => {
  const changes = [
    { action: 'replace', element_id: table, html: newTable('1450'), expect: ROWS },
    { action: 'replace', element_id: loose, text: 'Programm 2026', expect: 'Programm' },
  ];
  // The musician edited the SECOND element in OneNote after it was read. The
  // first change still matches, and it must not go anyway: the batch is one
  // decision about one state of the page.
  const moved = server({ html: pageHtml().replace('Programm', 'Programmheft') });
  await assert.rejects(
    withFetch(moved.fetchImpl, () => applyEdit('t', { page_id: 'p1', changes }, audit().record)),
    /changed since it was read/,
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

test('an index of the page is one line per part, and the full listing is not', () => {
  const long = 'Musik aus Lateinamerika, zusammengestellt mit dem Veranstalter und dem Orchester';
  const html =
    `<html><body><p id="${loose}">${long}</p>` +
    `<table id="${table}"><tr><td><p>Honorar</p></td><td><p>1200</p></td></tr></table>` +
    `<p id="${loose2}">Signatur</p></body></html>`;

  const full = editablePartsFrom(html, { full: true });
  assert.match(full.find((x) => x.element_id === loose).text, /dem Orchester$/);
  assert.match(full.find((x) => x.kind === 'table').text, /\| Honorar \| 1200 \|/);

  // The index read_note returns: shorter, one line per part.
  const index = editablePartsFrom(html, { full: false });
  assert.ok(index.find((x) => x.element_id === loose).text.endsWith('…'));
  // A table in an index is described by its shape. Its cells run together on
  // one line read as a single row of four, which is a worse description of the
  // page than none.
  assert.match(index.find((x) => x.kind === 'table').text, /^1 row × 2 columns, starting "Honorar \| 1200"$/);
  assert.ok(index.every((part) => !part.text.includes('\n')), 'an index is one line per part');
});
