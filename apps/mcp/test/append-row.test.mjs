import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEdit } from '../dist/onenote-patch.js';
import { appendRows } from '../dist/onenote-rows.js';

/**
 * append_row (0017): the server adds task rows to a table and carries every
 * existing row across, so the model writes no existing cell.
 *
 * The fixture is the markup OneNote returned in the round trip on 2026-11-22,
 * not markup composed by hand, because the whole design rests on how it differs
 * from what OneNote accepts: the tag comes back on a <span> in the cell and is
 * accepted only on a <p>, the border comes back as CSS and is honoured only as
 * the attribute, and ids sent back return as data-ids. Sent as read, the table
 * lost every to-do tag, the tick included, and reported success.
 */

const G = 'f164914f-307c-40bc-ab6c-c53ac48610c0';
const TABLE_ID = `table:{${G}}{243}`;
const id = (kind, n) => ` id="${kind}:{${G}}{${n}}"`;

const headerRow =
  `<tr${id('tr', 244)}>` +
  `<td${id('td', 249)} style="background-color:#efefef;border:1px solid"><span style="font-weight:bold">Aufgabe</span></td>` +
  `<td${id('td', 250)} style="background-color:#efefef;border:1px solid"><span style="font-weight:bold">Verantwortlich</span></td>` +
  `<td${id('td', 251)} style="background-color:#efefef;border:1px solid"><span style="font-weight:bold">Frist</span></td>` +
  `<td${id('td', 252)} style="background-color:#efefef;border:1px solid"><span style="font-weight:bold">Status</span></td>` +
  '</tr>';

const bodyRows = [
  `<tr${id('tr', 245)}><td style="border:1px solid"><span data-tag="to-do">Arrangements <span style="font-weight:bold">fertig</span>stellen</span></td>` +
    '<td style="border:1px solid">Ruben</td><td style="border:1px solid">sp&#228;testens <span style="font-style:italic">01.11.2026</span></td>' +
    '<td style="border:1px solid">OFFEN — <span style="color:#c00000">dringend</span></td></tr>',
  `<tr${id('tr', 246)}><td style="border:1px solid"><span data-tag="to-do:completed">Programm an Cornelia</span></td>` +
    '<td style="border:1px solid">Ruben</td><td style="border:1px solid">UNKNOWN</td><td style="border:1px solid">ERLEDIGT</td></tr>',
  `<tr${id('tr', 247)}><td style="border:1px solid"><span data-tag="to-do">Gage kl&#228;ren</span></td>` +
    '<td style="border:1px solid"><p style="margin-top:0pt;margin-bottom:0pt">Ruben</p><p style="margin-top:0pt;margin-bottom:0pt">und Agnes</p></td>' +
    '<td style="border:1px solid"><br /></td><td style="border:1px solid">siehe <a href="https://example.org/vertrag">Vertrag</a></td></tr>',
];

const tableAsRead = (rows = bodyRows, extra = '') =>
  `<table id="${TABLE_ID}" style="border:1px solid;border-collapse:collapse">${headerRow}${rows.join('')}${extra}</table>`;

const page = (table) =>
  `<html><head><title>CL Aufgaben — Test</title></head><body><div id="div:{${G}}{1}">` +
  `<p id="p:{${G}}{2}">Einleitung</p>${table}</div></body></html>`;

/** A new row as OneNote would read it back. */
const readBack = (task) =>
  `<tr><td style="border:1px solid"><span data-tag="to-do">${task}</span></td>` +
  '<td style="border:1px solid">UNKNOWN</td><td style="border:1px solid">15.12.2026</td><td style="border:1px solid">UNKNOWN</td></tr>';

/** One read before, the write, one read after — the after as given. */
const server = ({ before = page(tableAsRead()), after } = {}) => {
  const sent = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      reads += 1;
      const html = reads === 1 ? before : (after ?? before);
      return new Response(html, { status: 200, headers: { etag: 'W/"9"' } });
    }
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return { sent, fetchImpl, reads: () => reads };
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

const call = (extra = {}) => ({
  page_id: 'p1',
  action: 'append_row',
  element_id: TABLE_ID,
  rows: [{ Aufgabe: 'Probenplan schicken — aus Mail „Re: Probenplan" (Agentur), 21.11.2026', Frist: '15.12.2026' }],
  ...extra,
});

const goodAfter = page(tableAsRead([...bodyRows, readBack('Probenplan schicken — aus Mail „Re: Probenplan" (Agentur), 21.11.2026')]));

test('the table goes back in the form OneNote accepts: tags on <p>, the border attribute, no ids', async () => {
  const s = server({ after: goodAfter });
  const { record } = audit();
  await withFetch(s.fetchImpl, () => appendRows('t', call(), record));

  assert.equal(s.sent.length, 1);
  const [command] = s.sent[0].body;
  assert.equal(command.action, 'replace');
  assert.equal(command.target, TABLE_ID);
  const content = command.content;
  assert.doesNotMatch(content, /<span[^>]*data-tag/, 'a tag sent on a span is dropped by OneNote');
  assert.match(content, /<p data-tag="to-do">Arrangements <span style="font-weight:bold">fertig<\/span>stellen<\/p>/, 'bold inside a task stays inside its paragraph');
  assert.match(content, /<p data-tag="to-do:completed">Programm an Cornelia<\/p>/, 'the tick survives');
  assert.match(content, /<p data-tag="to-do">Gage kl&#228;ren<\/p>/);
  assert.match(content, /^<table border="1"/);
  assert.doesNotMatch(content, /\s(id|data-id)="/, 'ids sent back come back as data-ids and pile up');
  assert.match(content, /siehe <a href="https:\/\/example.org\/vertrag">Vertrag<\/a>/);
  assert.equal(s.sent[0].headers['if-match'], 'W/"9"');
});

test('the new row is built by the server: house cells, the tag on the task column, UNKNOWN where nothing was given', async () => {
  const s = server({ after: goodAfter });
  const { record } = audit();
  await withFetch(s.fetchImpl, () => appendRows('t', call(), record));

  const content = s.sent[0].body[0].content;
  const last = content.slice(content.lastIndexOf('<tr>'));
  assert.equal(
    last,
    '<tr>' +
      '<td style="border:1px solid #A3A3A3;padding:4px"><p data-tag="to-do">Probenplan schicken — aus Mail „Re: Probenplan&quot; (Agentur), 21.11.2026</p></td>' +
      '<td style="border:1px solid #A3A3A3;padding:4px"><p>UNKNOWN</p></td>' +
      '<td style="border:1px solid #A3A3A3;padding:4px"><p>15.12.2026</p></td>' +
      '<td style="border:1px solid #A3A3A3;padding:4px"><p>UNKNOWN</p></td>' +
      '</tr></table>',
  );
});

test('a write whose existing rows read back unchanged says so, and records the table as it was', async () => {
  const s = server({ after: goodAfter });
  const { lines, record } = audit();
  const result = await withFetch(s.fetchImpl, () => appendRows('t', call(), record));

  assert.equal(result.verified, true);
  assert.match(result.note, /The 3 rows already in it were read back unchanged/);
  assert.equal(s.reads(), 2, 'one read before, one after');
  assert.deepEqual(lines.map((l) => l.status), ['pending', 'done']);
  assert.equal(lines[0].write_id, lines[1].write_id);
  assert.equal(lines[0].operation, 'append_table_row');
  assert.equal(lines[0].pre_image, tableAsRead());
  assert.deepEqual(JSON.parse(lines[0].wrote).cells, [
    'Probenplan schicken — aus Mail „Re: Probenplan" (Agentur), 21.11.2026',
    'UNKNOWN',
    '15.12.2026',
    'UNKNOWN',
  ]);
  assert.match(result.note, new RegExp(`Recorded as write ${lines[0].write_id}`));
});

test('a row that reads back differently after the write is reported loudly, by number', async () => {
  // As the naive round trip did: the tags gone from every existing row.
  const untagged = bodyRows.map((row) => row.replace(/<span data-tag="[^"]*">([\s\S]*?)<\/span>(?=<\/td>)/, '$1'));
  const s = server({ after: page(tableAsRead([...untagged, readBack('x')])) });
  const { record } = audit();
  const result = await withFetch(s.fetchImpl, () => appendRows('t', call(), record));

  assert.equal(result.verified, false);
  assert.match(result.note, /WARNING: rows 1, 2, 3 of the table read back differently after the write/);
  assert.match(result.note, /Tell the musician now/);
});

test('several rows go in one write', async () => {
  const after = page(tableAsRead([...bodyRows, readBack('a'), readBack('b')]));
  const s = server({ after });
  const { lines, record } = audit();
  const result = await withFetch(s.fetchImpl, () =>
    appendRows('t', call({ rows: [{ Aufgabe: 'a' }, { Aufgabe: 'b' }] }), record),
  );
  assert.equal(s.sent.length, 1);
  assert.equal((s.sent[0].body[0].content.match(/<p data-tag="to-do">[ab]<\/p>/g) ?? []).length, 2);
  assert.equal(lines.filter((l) => l.status === 'done').length, 2);
  assert.equal(result.verified, true);
});

const refused = async (before, params, pattern) => {
  const s = server({ before });
  const { lines, record } = audit();
  await withFetch(s.fetchImpl, () => assert.rejects(appendRows('t', params, record), pattern));
  assert.deepEqual(s.sent, [], 'nothing may be written');
  assert.deepEqual(lines, []);
};

test('a table holding anything but text and tags is refused, writing nothing', async () => {
  const cell = (inner) => `<tr><td style="border:1px solid"><span data-tag="to-do">x</span></td><td>${inner}</td><td>a</td><td>b</td></tr>`;
  await refused(page(tableAsRead(bodyRows, cell('<img src="https://graph/x" />'))), call(), /holds a <img>.*text and tags only/s);
  await refused(page(tableAsRead(bodyRows, cell('<ul><li>a</li></ul>'))), call(), /holds a <ul>/);
  await refused(page(tableAsRead(bodyRows, cell('<table><tr><td>a</td></tr></table>'))), call(), /table inside a cell/);
  await refused(
    page(tableAsRead(bodyRows, '<tr><td colspan="2">x</td><td>a</td></tr>')),
    call(),
    /merged cells/,
  );
  await refused(
    page(tableAsRead(bodyRows, cell('<span data-tag="important">!</span>'))),
    call(),
    /OneNote tag "important"/,
  );
});

test('a table that is not a task table is refused, writing nothing', async () => {
  const facts =
    `<table id="${TABLE_ID}"><tr><td>Ort</td><td>Saal</td></tr><tr><td>Wien</td><td>Brahms</td></tr></table>`;
  await refused(page(facts), call(), /has no task column/);
  const headless = `<table id="${TABLE_ID}">${bodyRows.join('')}</table>`;
  await refused(page(headless), call(), /no header row/);
});

test('a cell named for a column the table does not have, or a row with no task, writes nothing', async () => {
  await refused(page(tableAsRead()), call({ rows: [{ Aufgabe: 'x', Notiz: 'y' }] }), /"Notiz" is not a column/);
  await refused(page(tableAsRead()), call({ rows: [{ Frist: '15.12.2026' }] }), /has no task/);
});

test('append_row commits through applyEdit with no token', async () => {
  const s = server({ after: goodAfter });
  const { record } = audit();
  await withFetch(s.fetchImpl, () => applyEdit('t', call(), record));
  assert.equal(s.sent.length, 1);
});

test('the pending record goes in before the write, and a failed one means nothing is written', async () => {
  const order = [];
  const s = server({ after: goodAfter });
  const tracked = async (url, init = {}) => {
    if ((init.method ?? 'GET') !== 'GET') order.push('PATCH');
    return s.fetchImpl(url, init);
  };
  await withFetch(tracked, () =>
    appendRows('t', call(), async (entry) => void order.push(entry.status)),
  );
  assert.deepEqual(order, ['pending', 'PATCH', 'done']);

  const failing = server({ after: goodAfter });
  await withFetch(failing.fetchImpl, () =>
    assert.rejects(
      appendRows('t', call(), async (entry) => {
        if (entry.status === 'pending') throw new Error('disk full');
      }),
      /disk full/,
    ),
  );
  assert.deepEqual(failing.sent, [], 'a write whose undo could not be recorded must not happen');
});
