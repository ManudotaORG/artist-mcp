import assert from 'node:assert/strict';
import test from 'node:test';

import { tickByKey, undoById } from '../apps/web/src/lib/task-tick-view.ts';

/**
 * The task view's tick and undo (0023), driven with stubs bound the way
 * `task-view.ts` binds them to one user. What matters most here is what is
 * *not* asked for: without the grant, nothing; with a key the snapshot does
 * not hold, no OneNote read; with a write id that is not a tick, no undo.
 */

const G = 'f164914f-307c-40bc-ab6c-c53ac48610c0';
const TABLE_ID = `table:{${G}}{243}`;
const td = (inner) => `<td style="border:1px solid">${inner}</td>`;
const header = `<tr>${['Aufgabe', 'Frist', 'Status'].map((h) => td(`<span style="font-weight:bold">${h}</span>`)).join('')}</tr>`;
const row = (text, done, status) =>
  `<tr>${td(`<span data-tag="${done ? 'to-do:completed' : 'to-do'}">${text}</span>`)}${td('UNKNOWN')}${td(status)}</tr>`;
const page = (rows) =>
  `<html><head><title>CL Aufgaben</title></head><body><table id="${TABLE_ID}">${header}${rows.join('')}</table></body></html>`;
const before = page([row('Hotel buchen', false, 'OFFEN')]);
const after = page([row('Hotel buchen', true, 'ERLEDIGT')]);

const deps = ({ granted = true, task = { page_id: 'p1', text: 'Hotel buchen' }, entries = [], pages = [before, after] } = {}) => {
  const asked = [];
  const stored = [];
  let read = 0;
  const call = async (op, params) => {
    asked.push({ op, params });
    if (op === 'read_note') return { html: pages[Math.min(read++, pages.length - 1)] };
    if (op === 'edit_onenote_page') return { write_ids: ['8a6e0a52-1111-4222-8333-944455556666'] };
    if (op === 'undo_write') return {};
    throw new Error(op);
  };
  return {
    asked,
    stored,
    deps: {
      mayTick: async () => granted,
      findTask: async (key) => (key === 'k' ? task : null),
      hasPage: async (id) => id === 'p1',
      logEntries: async () => entries,
      writer: () => {
        asked.push({ op: 'writer' });
        return call;
      },
      store: async (pageId, tasks) => void stored.push({ pageId, tasks }),
    },
  };
};

test('without onenote-edit, a tick asks OneNote nothing and builds no writer', async () => {
  const d = deps({ granted: false });
  const state = await tickByKey(d.deps, 'k');
  assert.equal(state.status, 'refused');
  assert.match(state.message, /Freigabe/);
  assert.deepEqual(d.asked, []);
});

test('without onenote-edit, an undo asks nothing either', async () => {
  const d = deps({ granted: false });
  assert.equal((await undoById(d.deps, 'p1', 'w')).status, 'refused');
  assert.deepEqual(d.asked, []);
});

test('a key the snapshot does not hold is refused before any read', async () => {
  const d = deps();
  const state = await tickByKey(d.deps, 'not-there');
  assert.equal(state.status, 'refused');
  assert.deepEqual(d.asked, []);
});

test('a tick reads, writes once, re-reads, and stores that one page', async () => {
  const d = deps();
  const state = await tickByKey(d.deps, 'k');
  assert.equal(state.status, 'ticked');
  assert.equal(state.verified, true);
  assert.equal(state.status_before, 'OFFEN');
  assert.deepEqual(d.asked.map((a) => a.op), ['writer', 'read_note', 'edit_onenote_page', 'read_note']);
  assert.deepEqual(d.asked[2].params.set, { Status: 'ERLEDIGT' });
  assert.equal(d.stored.length, 1);
  assert.equal(d.stored[0].pageId, 'p1');
  assert.equal(d.stored[0].tasks.tasks[0].done, true);
});

const tickEntry = {
  operation: 'update_table_row',
  target: 'p1',
  pre_image: '<table/>',
  write_id: 'w',
  status: 'done',
  wrote: JSON.stringify({
    header: ['Aufgabe', 'Frist', 'Status'],
    before: { cells: ['Hotel buchen', 'UNKNOWN', 'OFFEN'], done: false },
    after: { cells: ['Hotel buchen', 'UNKNOWN', 'ERLEDIGT'], done: true },
  }),
};

test('an undo of a tick calls undo_write by id and stores the page again', async () => {
  const d = deps({ entries: [tickEntry], pages: [before] });
  const state = await undoById(d.deps, 'p1', 'w');
  assert.deepEqual(state, { status: 'undone', write_id: 'w' });
  assert.deepEqual(d.asked.map((a) => a.op), ['writer', 'undo_write', 'read_note']);
  assert.equal(d.stored.length, 1);
});

test('an undo is refused for a write that is not a tick, one on another page, and one not in this log', async () => {
  const frist = {
    ...tickEntry,
    wrote: JSON.stringify({
      header: ['Aufgabe', 'Frist', 'Status'],
      before: { cells: ['Hotel buchen', 'UNKNOWN', 'OFFEN'], done: false },
      after: { cells: ['Hotel buchen', '01.12.2026', 'OFFEN'], done: false },
    }),
  };
  for (const [entries, pageId] of [
    [[frist], 'p1'],
    [[{ ...tickEntry, target: 'p2' }], 'p1'],
    [[], 'p1'],
    [[tickEntry], 'p9'],
  ]) {
    const d = deps({ entries });
    const state = await undoById(d.deps, pageId, 'w');
    assert.equal(state.status, 'refused');
    assert.deepEqual(d.asked, [], 'nothing asked of OneNote');
  }
});
