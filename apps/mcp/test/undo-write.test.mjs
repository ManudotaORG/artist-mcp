import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { appendRows, previewRowUpdate, undoWrite, updateRow } from '../dist/onenote-patch.js';

/**
 * undo_write (0018 step 3). Each kind of write is made with the real code, so
 * the log entries are the ones production records, and then undone against a
 * page that either still reads as written — undone — or has been touched since
 * — refused, with nothing sent. That second half is the whole safety of it: an
 * undo must never destroy an edit Ruben made after the tool wrote.
 */

const G = 'f164914f-307c-40bc-ab6c-c53ac48610c0';
const TABLE_ID = `table:{${G}}{243}`;
const td = (inner) => `<td style="border:1px solid">${inner}</td>`;
const header =
  '<tr>' +
  ['Aufgabe', 'Verantwortlich', 'Frist', 'Status']
    .map((h) => `<td style="background-color:#efefef;border:1px solid"><span style="font-weight:bold">${h}</span></td>`)
    .join('') +
  '</tr>';
const task = (text, { done = false, frist = 'UNKNOWN', status = 'UNKNOWN', who = 'Ruben' } = {}) =>
  `<tr>${td(`<span data-tag="${done ? 'to-do:completed' : 'to-do'}">${text}</span>`)}${td(who)}${td(frist)}${td(status)}</tr>`;
const base = [task('Arrangements fertigstellen', { status: 'OFFEN' }), task('Programm an Cornelia', { done: true, status: 'ERLEDIGT' })];
const table = (rows) => `<table id="${TABLE_ID}" style="border:1px solid;border-collapse:collapse">${header}${rows.join('')}</table>`;
const page = (body) => `<html><head><title>CL</title></head><body><div id="div:{${G}}{1}">${body}</div></body></html>`;

/** A page that answers GETs from a queue of states, and records every write. */
const notebook = (...states) => {
  const sent = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      const html = states[Math.min(reads, states.length - 1)];
      reads += 1;
      return new Response(html, { status: 200, headers: { etag: 'W/"3"' } });
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

/** An in-memory write log with the reader undo_write is given. */
const log = () => {
  const lines = [];
  let clock = 0;
  const record = async (entry) => {
    clock += 1;
    lines.push({ at: new Date(Date.UTC(2026, 10, 23, 7, 0, clock)).toISOString(), ...entry });
  };
  const readLog = async ({ writeId, since, limit = 200 } = {}) =>
    lines
      .filter((l) => (writeId === undefined || l.write_id === writeId) && (since === undefined || l.at >= since))
      .slice()
      .reverse()
      .slice(0, limit);
  return { lines, record, readLog };
};

const NEW = 'Probenplan schicken — aus Mail „Re: Probenplan" (Agentur), 21.11.2026';
// As append_row writes it: no Verantwortlich was given, so that cell is UNKNOWN.
const added = task(NEW.replace('„', '&#8222;'), { frist: '15.12.2026', who: 'UNKNOWN' });

/** Make a real append_row, and return its write id. */
const addRow = async (l) => {
  const n = notebook(page(table(base)), page(table([...base, added])));
  const r = await withFetch(n.fetchImpl, () =>
    appendRows('t', { page_id: 'p1', action: 'append_row', element_id: TABLE_ID, rows: [{ Aufgabe: NEW, Frist: '15.12.2026' }] }, l.record),
  );
  return r.write_ids[0];
};

test('an added row that still reads as written is removed, and every other row kept', async () => {
  const l = log();
  const id = await addRow(l);
  const n = notebook(page(table([...base, added])), page(table(base)));
  const result = await withFetch(n.fetchImpl, () => undoWrite('t', { write_id: id }, l.record, l.readLog));

  const content = n.sent[0].body[0].content;
  assert.equal(n.sent[0].headers['if-match'], 'W/"3"');
  assert.doesNotMatch(content, /Probenplan/, 'the added row is gone');
  assert.match(content, /<p data-tag="to-do">Arrangements fertigstellen<\/p>/);
  assert.match(content, /<p data-tag="to-do:completed">Programm an Cornelia<\/p>/, 'an existing tick, carried');
  assert.equal(result.verified, true);
  assert.match(result.note, /Removed the row this tool added/);
  const undo = l.lines.filter((x) => x.operation === 'undo_append_table_row');
  assert.deepEqual(undo.map((x) => x.status), ['pending', 'done']);
  assert.equal(JSON.parse(undo[0].wrote).undoes, id);
});

test('an added row Ruben has since ticked or edited is not removed', async () => {
  for (const touched of [
    task(NEW.replace('„', '&#8222;'), { frist: '15.12.2026', who: 'UNKNOWN', done: true }),
    task(NEW.replace('„', '&#8222;'), { frist: '20.12.2026', who: 'UNKNOWN' }),
  ]) {
    const l = log();
    const id = await addRow(l);
    const n = notebook(page(table([...base, touched])));
    await withFetch(n.fetchImpl, () =>
      assert.rejects(undoWrite('t', { write_id: id }, l.record, l.readLog), /no longer reads as this tool left it/),
    );
    assert.deepEqual(n.sent, [], 'an edit made after the write must survive the undo');
  }
});

test('an added row that appears twice is not removed', async () => {
  const l = log();
  const id = await addRow(l);
  const n = notebook(page(table([...base, added, added])));
  await withFetch(n.fetchImpl, () =>
    assert.rejects(undoWrite('t', { write_id: id }, l.record, l.readLog), /appears 2 times/),
  );
  assert.deepEqual(n.sent, []);
});

/** Make a real update_row tick, and return its write id. */
const tickRow = async (l) => {
  const before = page(table([...base, task('Vertrag zur&#252;cksenden')]));
  const after = page(table([...base, task('Vertrag zur&#252;cksenden', { done: true })]));
  const params = { page_id: 'p1', action: 'update_row', element_id: TABLE_ID, row: 'Vertrag zurücksenden', done: true };
  const shown = await withFetch(notebook(before).fetchImpl, () => previewRowUpdate('t', params));
  const r = await withFetch(notebook(before, after).fetchImpl, () =>
    updateRow('t', { ...params, confirmation_token: shown.confirmation_token }, l.record),
  );
  return r.write_ids[0];
};

test('a changed row that still reads as the change left it is put back', async () => {
  const l = log();
  const id = await tickRow(l);
  const ticked = page(table([...base, task('Vertrag zur&#252;cksenden', { done: true })]));
  const restored = page(table([...base, task('Vertrag zur&#252;cksenden')]));
  const n = notebook(ticked, restored);
  const result = await withFetch(n.fetchImpl, () => undoWrite('t', { write_id: id }, l.record, l.readLog));
  const content = n.sent[0].body[0].content;
  assert.match(content, /<p data-tag="to-do">Vertrag zur&#252;cksenden<\/p>/, 'the tick taken back');
  assert.match(content, /<p data-tag="to-do:completed">Programm an Cornelia<\/p>/, 'another tick, kept');
  assert.equal(result.verified, true);
  assert.match(result.note, /Put the row back as it was/);
});

test('a changed row Ruben has edited since is not put back', async () => {
  const l = log();
  const id = await tickRow(l);
  const edited = page(table([...base, task('Vertrag zur&#252;cksenden', { done: true, status: 'ERLEDIGT' })]));
  const n = notebook(edited);
  await withFetch(n.fetchImpl, () =>
    assert.rejects(undoWrite('t', { write_id: id }, l.record, l.readLog), /The row this tool changed no longer reads/),
  );
  assert.deepEqual(n.sent, []);
});

test('an appended line that still reads as written is removed; a changed or doubled one is not', async () => {
  const l = log();
  const id = '11111111-2222-3333-4444-555555555555';
  for (const status of ['pending', 'done']) {
    await l.record({ operation: 'append_onenote_page', summary: 's', target: 'p1', pre_image: null, write_id: id, status, wrote: '<p data-tag="to-do">Curfew 23:00</p>' });
  }
  const line = (n) => `<p id="p:{${G}}{${n}}" data-tag="to-do">Curfew 23:00</p>`;

  const ok = notebook(page(`<p id="p:{${G}}{8}">Intro</p>${line(9)}`), page(`<p id="p:{${G}}{8}">Intro</p>`));
  const result = await withFetch(ok.fetchImpl, () => undoWrite('t', { write_id: id }, l.record, l.readLog));
  assert.deepEqual(ok.sent[0].body, [{ target: `p:{${G}}{9}`, action: 'replace', content: '<p></p>' }]);
  assert.equal(result.verified, true);

  const l2 = log();
  for (const status of ['pending', 'done']) {
    await l2.record({ operation: 'append_onenote_page', summary: 's', target: 'p1', pre_image: null, write_id: id, status, wrote: '<p data-tag="to-do">Curfew 23:00</p>' });
  }
  for (const [state, pattern] of [
    [page(`<p id="p:{${G}}{9}" data-tag="to-do:completed">Curfew 23:00</p>`), /no longer reads as written/],
    [page(`${line(9)}${line(10)}`), /appears 2 times/],
  ]) {
    const n = notebook(state);
    await withFetch(n.fetchImpl, () => assert.rejects(undoWrite('t', { write_id: id }, l2.record, l2.readLog), pattern));
    assert.deepEqual(n.sent, []);
  }
});

test('an unknown id, an undo, an already-undone write, or an unsupported kind is refused', async () => {
  const l = log();
  const id = await addRow(l);
  await assert.rejects(undoWrite('t', { write_id: '00000000-0000-0000-0000-000000000000' }, l.record, l.readLog), /no write/);
  await assert.rejects(undoWrite('t', { write_id: 'not-an-id' }, l.record, l.readLog), /write_id is required/);

  const n = notebook(page(table([...base, added])), page(table(base)));
  const first = await withFetch(n.fetchImpl, () => undoWrite('t', { write_id: id }, l.record, l.readLog));
  await assert.rejects(undoWrite('t', { write_id: id }, l.record, l.readLog), /already undone/);
  await assert.rejects(undoWrite('t', { write_id: first.write_ids[0] }, l.record, l.readLog), /itself an undo/);

  const other = '99999999-2222-3333-4444-555555555555';
  await l.record({ operation: 'replace_onenote_element', summary: 's', target: 'p1', pre_image: '<p>x</p>', write_id: other, status: 'done' });
  const none = notebook(page(''));
  await withFetch(none.fetchImpl, () =>
    assert.rejects(undoWrite('t', { write_id: other }, l.record, l.readLog), /cannot be undone by this tool yet/),
  );
  assert.deepEqual(none.sent, []);
});

test('undo is recorded as pending before it writes, and refused if that fails', async () => {
  const l = log();
  const id = await addRow(l);
  const n = notebook(page(table([...base, added])));
  const failing = async (entry) => {
    if (entry.status === 'pending') throw new Error('disk full');
  };
  await withFetch(n.fetchImpl, () => assert.rejects(undoWrite('t', { write_id: id }, failing, l.readLog), /disk full/));
  assert.deepEqual(n.sent, []);
});

test('undo_write is registered only with onenote-edit', async () => {
  const none = await createServer(async () => ({}), []);
  const edit = await createServer(async () => ({}), ['onenote-edit']);
  assert.equal('undo_write' in none._registeredTools, false);
  assert.equal('undo_write' in edit._registeredTools, true);
});
