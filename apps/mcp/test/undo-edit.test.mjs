import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEdit, previewEdit } from '../dist/onenote-patch.js';
import { undoWrite } from '../dist/onenote-undo.js';

/**
 * undo_write for inserts and replaces (0019 step 3). Each write is made with
 * the real edit path, so the log entries are the ones production records, and
 * then undone against the page as OneNote would return it afterwards — with new
 * generated ids, since those move after every write and an undo cannot rely on
 * them. The refusals are the safety of it: an undo never overwrites something
 * the musician changed after the tool wrote.
 */

const G = '33f8a242-7c33-4bb2-90c5-8425a68cc5bf';
const id = (tag, n) => `${tag}:{${G}}{${n}}`;
const page = (body) => `<html><body><div id="div:{${G}}{1}">${body}</div></body></html>`;
const p = (n, text, attrs = '') => `<p id="${id('p', n)}"${attrs}>${text}</p>`;
const tbl = (n, rows) =>
  `<table id="${id('table', n)}" border="1">` +
  rows.map((r, i) => `<tr>${r.map((c, j) => `<td><p id="${id('p', n * 100 + i * 10 + j)}">${c}</p></td>`).join('')}</tr>`).join('') +
  '</table>';

/** A page that answers GETs from a queue of states, and records every write. */
const notebook = (...states) => {
  const sent = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      const html = states[Math.min(reads, states.length - 1)];
      reads += 1;
      return new Response(html, { status: 200, headers: { etag: 'W/"5"' } });
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

const log = () => {
  const lines = [];
  let clock = 0;
  const record = async (entry) => {
    clock += 1;
    lines.push({ at: new Date(Date.UTC(2026, 10, 25, 9, 0, clock)).toISOString(), ...entry });
  };
  const readLog = async ({ writeId, since, limit = 200 } = {}) =>
    lines
      .filter((l) => (writeId === undefined || l.write_id === writeId) && (since === undefined || l.at >= since))
      .slice()
      .reverse()
      .slice(0, limit);
  return { lines, record, readLog };
};

/** Preview and apply one change against `before`, through the real edit path; returns its write id. */
const edit = async (l, before, change) => {
  const n = notebook(before);
  const preview = await withFetch(n.fetchImpl, () => previewEdit('t', { page_id: 'p1', ...change }));
  const result = await withFetch(n.fetchImpl, () =>
    applyEdit('t', { page_id: 'p1', ...change, confirmation_token: preview.confirmation_token }, l.record),
  );
  return result.write_ids[0];
};

const undo = (l, n, writeId) => withFetch(n.fetchImpl, () => undoWrite('t', { write_id: writeId }, l.record, l.readLog));

const BEFORE = page(p(40, 'Fee: 1200', ' style="font-size:11pt"') + p(45, 'Load-in 18:00'));

test('a replaced paragraph is put back from its pre-image, found by what was written', async () => {
  const l = log();
  const writeId = await edit(l, BEFORE, { action: 'replace', element_id: id('p', 40), text: 'Fee: 1400' });

  // After the write OneNote gave the paragraph a new id; after the undo, another.
  const written = page(p(60, 'Fee: 1400', ' style="font-size:11pt"') + p(45, 'Load-in 18:00'));
  const restored = page(p(70, 'Fee: 1200', ' style="font-size:11pt"') + p(45, 'Load-in 18:00'));
  const n = notebook(written, restored);
  const result = await undo(l, n, writeId);

  assert.equal(n.sent.length, 1);
  assert.equal(n.sent[0].headers['if-match'], 'W/"5"');
  // Aimed at the element as it is now, with the pre-image's own id stripped.
  assert.deepEqual(n.sent[0].body, [
    { target: id('p', 60), action: 'replace', content: '<p style="font-size:11pt">Fee: 1200</p>' },
  ]);
  assert.equal(result.verified, true);
  assert.match(result.note, /Put back what this tool replaced:\n\n {2}Fee: 1200/);
  assert.match(result.note, /it reads as it did before/);

  const undoLines = l.lines.filter((x) => x.operation === 'undo_replace_onenote_element');
  assert.deepEqual(undoLines.map((x) => x.status), ['pending', 'done']);
  assert.equal(JSON.parse(undoLines[0].wrote).undoes, writeId);
  // What the undo overwrites is itself kept, so it can be seen afterwards.
  assert.equal(undoLines[0].pre_image, p(60, 'Fee: 1400', ' style="font-size:11pt"'));
});

test('a replaced paragraph edited since is not put back, and nothing is sent', async () => {
  const l = log();
  const writeId = await edit(l, BEFORE, { action: 'replace', element_id: id('p', 40), text: 'Fee: 1400' });
  const n = notebook(page(p(60, 'Fee: 1450') + p(45, 'Load-in 18:00')));
  await assert.rejects(undo(l, n, writeId), /no longer reads as written[\s\S]*It read: Fee: 1400/);
  assert.deepEqual(n.sent, []);
  assert.equal(l.lines.filter((x) => x.operation.startsWith('undo_')).length, 0, 'a refusal records nothing');
});

test('text the replace wrote that now appears twice is refused, not guessed at', async () => {
  const l = log();
  const writeId = await edit(l, BEFORE, { action: 'replace', element_id: id('p', 40), text: 'Fee: 1400' });
  const n = notebook(page(p(60, 'Fee: 1400') + p(61, 'Fee: 1400')));
  await assert.rejects(undo(l, n, writeId), /appears 2 times/);
  assert.deepEqual(n.sent, []);
});

const ROWS = [
  ['Honorar', '1200'],
  ['Anreise', 'Zug'],
];
const NEW_ROWS = [
  ['Honorar', '1450'],
  ['Anreise', 'Zug'],
];
const markup = (rows) =>
  '<table border="1">' + rows.map((r) => `<tr>${r.map((c) => `<td><p>${c}</p></td>`).join('')}</tr>`).join('') + '</table>';

test('a replaced table goes back whole while every row reads as the replace left it', async () => {
  const l = log();
  const writeId = await edit(l, page(p(40, 'Programm') + tbl(5, ROWS)), {
    action: 'replace',
    element_id: id('table', 5),
    html: markup(NEW_ROWS),
  });

  const n = notebook(page(p(40, 'Programm') + tbl(6, NEW_ROWS)), page(p(40, 'Programm') + tbl(7, ROWS)));
  const result = await undo(l, n, writeId);

  assert.equal(n.sent.length, 1);
  const [command] = n.sent[0].body;
  assert.equal(command.target, id('table', 6));
  assert.doesNotMatch(command.content, /\sid=/, 'no id of the table as it was goes back out');
  assert.match(command.content, /1200/);
  assert.equal(result.verified, true);
  assert.match(result.note, /the table reads as it did before/);
});

test('a replaced table with one cell edited since is refused whole', async () => {
  const l = log();
  const writeId = await edit(l, page(tbl(5, ROWS)), { action: 'replace', element_id: id('table', 5), html: markup(NEW_ROWS) });
  const n = notebook(page(tbl(6, [['Honorar', '1450'], ['Anreise', 'Auto']])));
  await assert.rejects(undo(l, n, writeId), /no longer reads as this tool left it[\s\S]*1450/);
  assert.deepEqual(n.sent, []);
});

test('an inserted paragraph is removed, found by what was written', async () => {
  const l = log();
  const writeId = await edit(l, BEFORE, {
    action: 'insert',
    element_id: id('p', 40),
    position: 'after',
    html: '<p>Mitschnitt: ja</p>',
  });
  const n = notebook(
    page(p(40, 'Fee: 1200') + p(62, 'Mitschnitt: ja') + p(45, 'Load-in 18:00')),
    page(p(40, 'Fee: 1200') + p(45, 'Load-in 18:00')),
  );
  const result = await undo(l, n, writeId);
  assert.deepEqual(n.sent[0].body, [{ target: id('p', 62), action: 'replace', content: '<p></p>' }]);
  assert.equal(result.verified, true);
  assert.match(result.note, /Removed the line this tool inserted:\n\n {2}Mitschnitt: ja/);
});

test('an inserted table is removed by hand until that has been tried on a real page', async () => {
  const l = log();
  const writeId = await edit(l, BEFORE, { action: 'insert', element_id: id('p', 40), position: 'after', html: markup(ROWS) });
  const n = notebook(page(tbl(8, ROWS)));
  await assert.rejects(undo(l, n, writeId), /not a single paragraph or heading, so it is removed by hand/);
  assert.deepEqual(n.sent, []);
});

test('a replace whose pre-image this tool would not write is shown, not restored', async () => {
  const l = log();
  const writeId = '11111111-2222-3333-4444-555555555555';
  await l.record({
    operation: 'replace_onenote_element',
    summary: 's',
    target: 'p1',
    pre_image: `<p id="${id('p', 40)}">Siehe <object data="x.pdf"></object> Vertrag</p>`,
    wrote: '<p>Fee: 1400</p>',
    write_id: writeId,
    status: 'pending',
  });
  const n = notebook(page(p(60, 'Fee: 1400')));
  await assert.rejects(undo(l, n, writeId), /cannot be put back automatically[\s\S]*Siehe/);
  assert.deepEqual(n.sent, []);
});

test('a replace undone once is not undone again', async () => {
  const l = log();
  const writeId = await edit(l, BEFORE, { action: 'replace', element_id: id('p', 40), text: 'Fee: 1400' });
  await undo(l, notebook(page(p(60, 'Fee: 1400')), page(p(70, 'Fee: 1200'))), writeId);
  const n = notebook(page(p(70, 'Fee: 1200')));
  await assert.rejects(undo(l, n, writeId), /already undone/);
  assert.deepEqual(n.sent, []);
});
