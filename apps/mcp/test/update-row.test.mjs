import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEdit, previewEdit } from '../dist/onenote-patch.js';
import { previewRowUpdate, updateRow } from '../dist/onenote-rows.js';

/**
 * update_row (0018 step 2): one task row changed by the server — its tick or
 * its cells — with every other row carried across as OneNote returned it and
 * checked after the write. Kept behind a preview and token until undo exists.
 *
 * The fixture is OneNote's read-back markup, as for append_row: the tag on a
 * <span> in the cell, a CSS border, element ids. Sent back as read, a table
 * loses every tag, so what goes out has to be the translated form.
 */

const G = 'f164914f-307c-40bc-ab6c-c53ac48610c0';
const TABLE_ID = `table:{${G}}{243}`;

const td = (inner) => `<td style="border:1px solid">${inner}</td>`;
const header =
  `<tr id="tr:{${G}}{244}">` +
  ['Aufgabe', 'Verantwortlich', 'Frist', 'Status']
    .map((h) => `<td style="background-color:#efefef;border:1px solid"><span style="font-weight:bold">${h}</span></td>`)
    .join('') +
  '</tr>';
const task = (text, { done = false, frist = 'UNKNOWN', status = 'UNKNOWN', who = 'Ruben' } = {}) =>
  `<tr>${td(`<span data-tag="${done ? 'to-do:completed' : 'to-do'}">${text}</span>`)}${td(who)}${td(frist)}${td(status)}</tr>`;

const rowsAsRead = [
  task('Arrangements <span style="font-weight:bold">fertig</span>stellen', { frist: 'sp&#228;testens 01.11.2026', status: 'OFFEN' }),
  task('Programm an Cornelia', { done: true, status: 'ERLEDIGT' }),
  task('Vertrag zur&#252;cksenden'),
];

const tableAsRead = (rows = rowsAsRead) =>
  `<table id="${TABLE_ID}" style="border:1px solid;border-collapse:collapse">${header}${rows.join('')}</table>`;
const page = (table) =>
  `<html><head><title>CL Aufgaben</title></head><body><div id="div:{${G}}{1}">${table}</div></body></html>`;

const server = ({ before = page(tableAsRead()), after } = {}) => {
  const sent = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      reads += 1;
      return new Response(reads === 1 || after === undefined ? before : after, { status: 200, headers: { etag: 'W/"7"' } });
    }
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return { sent, fetchImpl, reset: () => (reads = 0) };
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

const tick = { page_id: 'p1', action: 'update_row', element_id: TABLE_ID, row: 'Vertrag zurücksenden', done: true, set: { Status: 'ERLEDIGT' } };

/** Preview, then apply with the token it returned, against `after` as the read-back. */
const previewThenApply = async (params, after) => {
  const s = server({ after });
  const preview = await withFetch(s.fetchImpl, () => previewRowUpdate('t', params));
  s.reset();
  const { lines, record } = audit();
  const result = await withFetch(s.fetchImpl, () =>
    updateRow('t', { ...params, confirmation_token: preview.confirmation_token }, record),
  );
  return { s, preview, result, lines };
};

const ticked = page(tableAsRead([rowsAsRead[0], rowsAsRead[1], task('Vertrag zur&#252;cksenden', { done: true, status: 'ERLEDIGT' })]));

test('the preview shows the row before and after, and carries a token', async () => {
  const s = server();
  const preview = await withFetch(s.fetchImpl, () => previewRowUpdate('t', tick));
  assert.match(preview.preview, /\[ \] Aufgabe: Vertrag zurücksenden · Verantwortlich: Ruben · Frist: UNKNOWN/);
  assert.match(preview.preview, /to:\n\n {2}\[x\] Aufgabe: Vertrag zurücksenden/);
  assert.match(preview.confirmation_token, /^[0-9a-f]{32}$/);
  assert.deepEqual(s.sent, [], 'a preview writes nothing');
});

test('a tick changes that row alone, and the table goes back in the form OneNote accepts', async () => {
  const { s, result, lines } = await previewThenApply(tick, ticked);
  const content = s.sent[0].body[0].content;
  assert.equal(s.sent[0].body[0].target, TABLE_ID);
  assert.equal(s.sent[0].headers['if-match'], 'W/"7"');
  assert.match(content, /<p data-tag="to-do:completed">Vertrag zur&#252;cksenden<\/p>/, 'the tick');
  assert.match(content, /<p data-tag="to-do">Arrangements <span style="font-weight:bold">fertig<\/span>stellen<\/p>/, 'another row, carried');
  assert.match(content, /<p data-tag="to-do:completed">Programm an Cornelia<\/p>/, 'an existing tick, carried');
  assert.doesNotMatch(content, /<span[^>]*data-tag/);
  assert.doesNotMatch(content, /\s(id|data-id)="/);
  assert.match(content, /^<table border="1"/);
  assert.equal(result.verified, true);
  assert.match(result.note, /Every other row was read back unchanged/);
  assert.deepEqual(lines.map((l) => l.status), ['pending', 'done']);
  assert.equal(lines[0].operation, 'update_table_row');
  assert.equal(lines[0].pre_image, tableAsRead());
  const wrote = JSON.parse(lines[0].wrote);
  assert.equal(wrote.before.done, false);
  assert.equal(wrote.after.done, true);
});

test('a cell is changed by its column, even beside an identical cell', async () => {
  // Frist and Status both read UNKNOWN: a string replace would change Frist.
  const params = { page_id: 'p1', action: 'update_row', element_id: TABLE_ID, row: 'Vertrag zurücksenden', set: { Status: 'GESCHICKT' } };
  const after = page(tableAsRead([rowsAsRead[0], rowsAsRead[1], task('Vertrag zur&#252;cksenden', { status: 'GESCHICKT' })]));
  const { s, result } = await previewThenApply(params, after);
  const last = s.sent[0].body[0].content.match(/<tr\b[^>]*>(?:(?!<tr\b)[\s\S])*Vertrag[\s\S]*?<\/tr>/)[0];
  const cells = [...last.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(cells.slice(2), ['UNKNOWN', '<p>GESCHICKT</p>']);
  assert.equal(result.verified, true);
});

test('update_row commits in one call: no token, If-Match on the read just made', async () => {
  // Since undo_write was verified on hosted (0018), a wrong tick is reversed
  // by its write id, so the token is gone. If-Match is what stops it
  // overwriting an edit made between its own read and its write.
  const s = server({ after: ticked });
  const { lines, record } = audit();
  const result = await withFetch(s.fetchImpl, () => updateRow('t', tick, record));
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].headers['if-match'], 'W/"7"');
  assert.equal(result.verified, true);
  assert.deepEqual(lines.map((l) => l.status), ['pending', 'done']);
  assert.match(result.note, /Recorded as write [0-9a-f-]{36}/);
});

test('a row edited since the tool last read it is still found by what it says now', async () => {
  // With no token there is no "as previewed" to be stale against: the change
  // applies to the row as it reads at the moment of writing. A tick asked for
  // on a row whose Frist Ruben just changed ticks it and keeps his Frist.
  const edited = page(tableAsRead([rowsAsRead[0], rowsAsRead[1], task('Vertrag zur&#252;cksenden', { frist: '01.12.2026' })]));
  const after = page(tableAsRead([rowsAsRead[0], rowsAsRead[1], task('Vertrag zur&#252;cksenden', { frist: '01.12.2026', done: true, status: 'ERLEDIGT' })]));
  const s = server({ before: edited, after });
  const { record } = audit();
  const result = await withFetch(s.fetchImpl, () => updateRow('t', tick, record));
  assert.match(s.sent[0].body[0].content, /<p data-tag="to-do:completed">Vertrag zur&#252;cksenden<\/p>[\s\S]*01\.12\.2026/);
  assert.equal(result.verified, true);
});

test('an unclear or impossible change is refused, writing nothing', async () => {
  const refuse = async (params, pattern, before) => {
    const s = server(before ? { before } : {});
    await withFetch(s.fetchImpl, () => assert.rejects(previewRowUpdate('t', params), pattern));
    assert.deepEqual(s.sent, []);
  };
  await refuse({ ...tick, row: 'Hotel buchen' }, /No row of this table has the task "Hotel buchen"/);
  await refuse(tick, /2 rows of this table have the task/, page(tableAsRead([...rowsAsRead, task('Vertrag zur&#252;cksenden')])));
  await refuse({ ...tick, done: undefined, set: { Notiz: 'x' } }, /"Notiz" is not a column/);
  await refuse({ ...tick, done: undefined, set: { Aufgabe: 'anders' } }, /task text itself is not changed/);
  await refuse({ ...tick, done: undefined, set: undefined }, /needs something to change/);
  await refuse(
    { ...tick, row: 'Ruben' },
    /No row of this table has the task "Ruben"/,
  );
});

test('a row that reads back wrong after the write is reported loudly', async () => {
  // The write landed but another row lost its tick.
  const broken = page(tableAsRead([rowsAsRead[0], task('Programm an Cornelia', { status: 'ERLEDIGT' }), task('Vertrag zur&#252;cksenden', { done: true, status: 'ERLEDIGT' })]));
  const { result } = await previewThenApply(tick, broken);
  assert.equal(result.verified, false);
  assert.match(result.note, /WARNING: after the write, row 2 did not read back as expected/);
});

test('both edit tools route update_row', async () => {
  const s = server({ after: ticked });
  const preview = await withFetch(s.fetchImpl, () => previewEdit('t', tick));
  assert.ok(preview.confirmation_token);
  s.reset();
  const { record } = audit();
  const result = await withFetch(s.fetchImpl, () =>
    applyEdit('t', { ...tick, confirmation_token: preview.confirmation_token }, record),
  );
  assert.equal(result.verified, true);
});

test('a tick in a table with a Status column needs the Status, so the cell never says OFFEN beside a tick', async () => {
  const s = server();
  await withFetch(s.fetchImpl, () =>
    assert.rejects(
      previewRowUpdate('t', { page_id: 'p1', action: 'update_row', element_id: TABLE_ID, row: 'Vertrag zurücksenden', done: true }),
      /has a Status column, and it changes with the tick: give Status in set/,
    ),
  );
  assert.deepEqual(s.sent, []);
});
