import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchWith } from '../dist/dispatch.js';
import { updateRow } from '../dist/onenote-rows.js';
import { isTick, planTick, statusWord, tickTask, undoTick } from '../dist/task-tick.js';

/**
 * The task view's tick (0023): find the task on the page as read now, by the
 * text tasks mode gave it, and turn it into an update_row or a replace that
 * the dispatcher already has. The markup is OneNote's read-back form, as in
 * update-row.test.mjs: the tag on a <span> in a cell, on the <p> for a line,
 * element ids, entities. The shapes are the live pages' (measured 2026-11-25);
 * the words are invented.
 */

const G = 'f164914f-307c-40bc-ab6c-c53ac48610c0';
const TABLE_ID = `table:{${G}}{243}`;
const LINE_ID = `p:{${G}}{27}`;

const td = (inner) => `<td style="border:1px solid">${inner}</td>`;
const header = (names = ['Aufgabe', 'Verantwortlich', 'Frist', 'Status']) =>
  `<tr id="tr:{${G}}{244}">` +
  names.map((h) => `<td style="background-color:#efefef;border:1px solid"><span style="font-weight:bold">${h}</span></td>`).join('') +
  '</tr>';
const task = (text, { done = false, status = 'OFFEN', who = 'Ruben' } = {}) =>
  `<tr>${td(`<span data-tag="${done ? 'to-do:completed' : 'to-do'}">${text}</span>`)}${td(who)}${td('UNKNOWN')}${td(status)}</tr>`;
const table = (rows, names) =>
  `<table id="${TABLE_ID}" style="border:1px solid;border-collapse:collapse">${header(names)}${rows.join('')}</table>`;
const line = (text, tag = 'to-do') =>
  `<p id="${LINE_ID}" data-tag="${tag}" style="margin-top:5.5pt;margin-bottom:5.5pt">${text}</p>`;
const page = (...parts) =>
  `<html><head><title>CL Aufgaben — Test</title></head><body><div id="div:{${G}}{1}">${parts.join('')}</div></body></html>`;

const rows = [
  task('Programm an Cornelia', { done: true, status: 'ERLEDIGT — am 28.08.2026 gesendet' }),
  task('Vertrag zur&#252;cksenden', { status: 'OFFEN — warte auf Agnes' }),
  task('Hotel buchen'),
];

test('a table task is planned as update_row, with the Status cell set to the word ticked rows open with', () => {
  const plan = planTick(page(table(rows)), 'Vertrag zurücksenden');
  assert.deepEqual(plan, {
    kind: 'row',
    element_id: TABLE_ID,
    row: 'Vertrag zurücksenden',
    set: { Status: 'ERLEDIGT' },
    status_before: 'OFFEN — warte auf Agnes',
  });
});

test('the done word is the opening word, not the whole cell (the live pages carry a clause after it)', () => {
  assert.equal(statusWord('ERLEDIGT — beantwortet; die Vorprobe ist noch nicht bestätigt'), 'ERLEDIGT');
  assert.equal(statusWord('ERLEDIGT (Entscheidung; Buchung steht aus)'), 'ERLEDIGT');
  assert.equal(statusWord(''), null);
});

test('with no ticked row in the table, the word is ERLEDIGT', () => {
  const plan = planTick(page(table([task('Hotel buchen'), task('Noten kopieren')])), 'Hotel buchen');
  assert.deepEqual(plan.set, { Status: 'ERLEDIGT' });
});

test('two words for done in one table are refused, naming both', () => {
  const plan = planTick(
    page(table([task('A', { done: true, status: 'ERLEDIGT' }), task('B', { done: true, status: 'FERTIG' }), task('Hotel buchen')])),
    'Hotel buchen',
  );
  assert.equal(plan.refused, 'status_words');
  assert.match(plan.message, /„ERLEDIGT“, „FERTIG“/);
});

test('a table with no Status column is ticked with no cell set', () => {
  const plan = planTick(page(table([task('Hotel buchen').replace(/<td[^>]*>OFFEN<\/td>/, '')], ['Aufgabe', 'Verantwortlich', 'Frist'])), 'Hotel buchen');
  assert.equal(plan.kind, 'row');
  assert.deepEqual(plan.set, {});
});

test('a line is planned as a replace that changes only its tag, with its ids removed and its text as expect', () => {
  const plan = planTick(page(table(rows), line('Status mit Intendant kl&#228;ren')), 'Status mit Intendant klären');
  assert.equal(plan.kind, 'line');
  assert.equal(plan.element_id, LINE_ID);
  assert.equal(
    plan.html,
    '<p data-tag="to-do:completed" style="margin-top:5.5pt;margin-bottom:5.5pt">Status mit Intendant kl&#228;ren</p>',
  );
  assert.equal(plan.expect, 'Status mit Intendant klären');
});

test('nothing found, twice found, and already done are each refused', () => {
  const html = page(table(rows), line('Hotel buchen'));
  assert.equal(planTick(html, 'Gibt es nicht').refused, 'not_found');
  assert.equal(planTick(html, 'Hotel buchen').refused, 'several');
  assert.equal(planTick(page(table(rows)), 'Programm an Cornelia').refused, 'done');
});

test('a line carrying another tag beside to-do, or a list item, is left for OneNote', () => {
  assert.equal(planTick(page(line('Hotel buchen', 'to-do,important')), 'Hotel buchen').refused, 'formatting');
  assert.equal(
    planTick(page(`<ul><li id="li:{${G}}{9}" data-tag="to-do">Hotel buchen</li></ul>`), 'Hotel buchen').refused,
    'formatting',
  );
});

test('a cell holding two tasks is refused rather than ticking the wrong one', () => {
  const two = `<tr>${td('<span data-tag="to-do">Hotel buchen</span><br/><span data-tag="to-do">Zug buchen</span>')}${td('Ruben')}${td('UNKNOWN')}${td('OFFEN')}</tr>`;
  assert.equal(planTick(page(table([two])), 'Hotel buchen').refused, 'several');
});

test('update_row finds a row by the task text tasks mode gives it, when a note sits under the task in its cell', async () => {
  // The old match compared the whole cell, so "Hotel buchen" with a second,
  // untagged line under it matched under neither name a reader was shown.
  const noted = `<tr>${td('<span data-tag="to-do">Hotel buchen</span><br/>(Agnes fragen)')}${td('Ruben')}${td('UNKNOWN')}${td('OFFEN')}</tr>`;
  const before = page(table([noted]));
  const after = before.replace('data-tag="to-do"', 'data-tag="to-do:completed"').replace('>OFFEN<', '>ERLEDIGT<');
  let reads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) =>
    (init.method ?? 'GET') === 'GET'
      ? new Response((reads += 1) === 1 ? before : after, { status: 200, headers: { etag: 'W/"1"' } })
      : new Response(null, { status: 204 });
  try {
    const plan = planTick(before, 'Hotel buchen');
    assert.equal(plan.kind, 'row');
    const result = await updateRow('t', { page_id: 'p1', action: 'update_row', element_id: TABLE_ID, row: plan.row, done: true, set: plan.set }, async () => {});
    assert.equal(result.changed, true);
  } finally {
    globalThis.fetch = original;
  }
});

/** A dispatcher stand-in: records what was asked, answers from a script. */
const fakeCall = (pages, { edit = async () => ({ write_ids: ['w-1'] }), undo = async () => ({}) } = {}) => {
  const calls = [];
  let read = 0;
  const call = async (op, params) => {
    calls.push({ op, params });
    if (op === 'read_note') return { html: pages[Math.min(read++, pages.length - 1)] };
    if (op === 'edit_onenote_page') return edit(params);
    if (op === 'undo_write') return undo(params);
    throw new Error(`unexpected ${op}`);
  };
  return { call, calls };
};

test('tickTask reads, writes through update_row, reads again, and reports the write id', async () => {
  const before = page(table(rows));
  const after = page(table([rows[0], task('Vertrag zur&#252;cksenden', { done: true, status: 'ERLEDIGT' }), rows[2]]));
  const { call, calls } = fakeCall([before, after]);
  const out = await tickTask(call, 'p1', 'Vertrag zurücksenden');
  assert.equal(out.ticked, true);
  assert.equal(out.write_id, 'w-1');
  assert.equal(out.verified, true);
  assert.equal(out.status_before, 'OFFEN — warte auf Agnes');
  assert.deepEqual(calls.map((c) => c.op), ['read_note', 'edit_onenote_page', 'read_note']);
  assert.deepEqual(calls[1].params, {
    page_id: 'p1',
    action: 'update_row',
    element_id: TABLE_ID,
    row: 'Vertrag zurücksenden',
    done: true,
    set: { Status: 'ERLEDIGT' },
  });
  assert.equal(calls[0].params.include_html, true);
});

test('tickTask sends a line as a replace carrying expect', async () => {
  const { call, calls } = fakeCall([page(line('Hotel buchen'))]);
  await tickTask(call, 'p1', 'Hotel buchen');
  assert.equal(calls[1].params.action, 'replace');
  assert.equal(calls[1].params.expect, 'Hotel buchen');
});

test('a refused tick writes nothing and hands back the page just read', async () => {
  const { call, calls } = fakeCall([page(table(rows))]);
  const out = await tickTask(call, 'p1', 'Gibt es nicht');
  assert.equal(out.ticked, false);
  assert.equal(out.reason, 'not_found');
  assert.ok(out.tasks.tasks.length > 0);
  assert.deepEqual(calls.map((c) => c.op), ['read_note']);
});

test('a write Graph refuses is reported, not retried', async () => {
  const { call, calls } = fakeCall([page(table(rows))], {
    edit: async () => {
      throw new Error('Graph 401');
    },
  });
  const out = await tickTask(call, 'p1', 'Hotel buchen');
  assert.equal(out.ticked, false);
  assert.equal(out.reason, 'failed');
  assert.equal(calls.filter((c) => c.op === 'edit_onenote_page').length, 1);
});

test('isTick accepts a tick and its Status cell, and nothing else', () => {
  const wrote = (before, after) =>
    JSON.stringify({ header: ['Aufgabe', 'Frist', 'Status'], before, after });
  const row = { operation: 'update_table_row', target: 'p1', pre_image: '<table/>' };
  assert.equal(isTick({ ...row, wrote: wrote({ cells: ['A', 'x', 'OFFEN'], done: false }, { cells: ['A', 'x', 'ERLEDIGT'], done: true }) }), true);
  assert.equal(isTick({ ...row, wrote: wrote({ cells: ['A', 'x', 'OFFEN'], done: false }, { cells: ['A', 'y', 'ERLEDIGT'], done: true }) }), false, 'a Frist change');
  assert.equal(isTick({ ...row, wrote: wrote({ cells: ['A', 'x', 'ERLEDIGT'], done: true }, { cells: ['A', 'x', 'OFFEN'], done: false }) }), false, 'a reopening');
  const p = { operation: 'replace_onenote_element', target: 'p1' };
  assert.equal(isTick({ ...p, pre_image: line('Hotel buchen'), wrote: '<p data-tag="to-do:completed">Hotel buchen</p>' }), true);
  assert.equal(isTick({ ...p, pre_image: line('Hotel buchen'), wrote: '<p data-tag="to-do:completed">Zug buchen</p>' }), false, 'a rewording');
  assert.equal(isTick({ operation: 'append_table_row', target: 'p1', pre_image: null, wrote: '{}' }), false);
});

test('undoTick calls undo_write by id and reads the page again', async () => {
  const { call, calls } = fakeCall([page(table(rows))]);
  const out = await undoTick(call, 'p1', 'w-1');
  assert.equal(out.undone, true);
  assert.deepEqual(calls.map((c) => c.op), ['undo_write', 'read_note']);
  assert.deepEqual(calls[0].params, { write_id: 'w-1' });
});

test('read_note returns the raw page only when its dispatcher caller asks', async () => {
  const html = page(line('Hotel buchen'));
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { status: 200 });
  try {
    const call = dispatchWith(async () => 't');
    assert.equal((await call('read_note', { note_id: '0-abc!1-def' })).html, undefined);
    assert.equal((await call('read_note', { note_id: '0-abc!1-def', include_html: true })).html, html);
  } finally {
    globalThis.fetch = original;
  }
});
