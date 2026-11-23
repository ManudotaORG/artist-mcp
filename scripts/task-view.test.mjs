import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTaskView, standLine, taskKey } from '../apps/web/src/lib/task-view-model.ts';
import { listNotebookTasks, readTaskPages } from '../apps/web/src/lib/task-refresh.ts';

/**
 * The hosted task view (0020): what a stored snapshot shows, and how one
 * notebook is read for it. The refresh is driven with a stub dispatcher, so
 * what it asks for is asserted rather than inferred from what it returns.
 */

const page = (id, section, tasks, extra = {}) => ({
  page_id: id,
  notebook: '2026-27',
  section,
  title: `CL Aufgaben — ${section}`,
  web_url: `https://onenote.example/${id}`,
  client_url: `onenote:https://onenote.example/${id}`,
  read_at: '2026-11-23T08:00:00Z',
  error: null,
  tasks,
  ...extra,
});

const task = (text, overrides = {}) => ({
  text,
  done: false,
  details: 'Verantwortlich: Ruben · Frist: 01.12.2026 · Status: OFFEN',
  unsettled: null,
  stale_status: null,
  ...overrides,
});

const notebook = (overrides = {}) => ({
  notebook: '2026-27',
  position: 0,
  listed_at: '2026-11-23T08:00:00Z',
  full_at: '2026-11-23T08:00:00Z',
  sections_without: [],
  sections_several: [],
  pending: [],
  error: null,
  error_at: null,
  ...overrides,
});

const snapshot = (pages, user = null, notebooks = [notebook()]) => ({ user, notebooks, pages });

const vidala = page('v', 'Vidala', {
  lead: '',
  lead_cut: false,
  tasks: [
    task('Gage Soulier abschließen'),
    task('Hotel buchen', { done: true }),
    task('Programm an Agnes', { unsettled: 'an Agnes weitergeleitet' }),
    task('Probenplan', { stale_status: 'ERLEDIGT' }),
  ],
  delegated: [{ text: 'Plakat', to: 'Büro', on: '20.11.2026', reply: null, from: 'table' }],
  problems: ['A task table has no header row.'],
});

test('open, unsettled, done and delegated are kept apart', () => {
  const view = buildTaskView(snapshot([vidala]));
  assert.deepEqual(view.open.map((t) => t.text), ['Gage Soulier abschließen', 'Probenplan']);
  assert.deepEqual(view.unsettled.map((t) => t.text), ['Programm an Agnes']);
  assert.equal(view.projects[0].done, 1);
  assert.deepEqual(view.delegated.map((d) => d.to), ['Büro']);
  // An unsettled task is in Zu klären and nowhere that counts it as open.
  assert.equal(view.counts.projekte, 2);
  assert.equal(view.counts.klaeren, 1);
  assert.deepEqual(view.projects[0].problems, ['A task table has no header row.']);
});

test('a page that could not be read is unread, never a project with nothing open', () => {
  const view = buildTaskView(snapshot([vidala, page('e', 'Essen', null, { error: 'Graph 500' })]));
  assert.deepEqual(view.unread.map((p) => p.section), ['Essen']);
  assert.deepEqual(view.projects.map((p) => p.page.section), ['Vidala']);
});

test('views that need structured cells say so rather than showing nothing', () => {
  const view = buildTaskView(snapshot([vidala]));
  for (const id of ['heute', 'fristen', 'menschen', 'taetigkeiten']) assert.equal(view.counts[id], null);
});

test('Neu compares against what was seen, and before that compares nothing', () => {
  assert.equal(buildTaskView(snapshot([vidala])).fresh, null, 'everything was called new before the first Gesehen');

  const seenView = buildTaskView(snapshot([vidala]));
  const user = { refresh_started_at: null, refresh_full: false, full_started_at: null, seen_at: '2026-11-23T09:00:00Z', seen_keys: seenView.keys };
  assert.equal(buildTaskView(snapshot([vidala], user)).counts.neu, 0);

  const changed = page('v', 'Vidala', {
    ...vidala.tasks,
    tasks: [
      // Reworded: new. Ticked: not new. Whitespace and case: not new.
      task('Gage Soulier (Wien) abschließen'),
      task('Hotel buchen', { done: false }),
      task('  PROBENPLAN '),
      task('Programm an Agnes', { unsettled: 'an Agnes weitergeleitet' }),
    ],
  });
  const fresh = buildTaskView(snapshot([changed], user)).fresh;
  assert.deepEqual(fresh.tasks.map((t) => t.text), ['Gage Soulier (Wien) abschließen']);
});

test('a task key is its page and its text, and holds no text', () => {
  assert.equal(taskKey('p', 'Gage  bestätigen'), taskKey('p', 'gage bestätigen'));
  assert.notEqual(taskKey('p', 'Gage bestätigen'), taskKey('q', 'Gage bestätigen'));
  assert.doesNotMatch(taskKey('p', 'Gage'), /gage/i);
});

test('the age is stated as a span when pages were read at different times', () => {
  const view = buildTaskView(snapshot([vidala, page('e', 'Essen', vidala.tasks, { read_at: '2026-11-22T06:00:00Z' })]));
  assert.match(standLine(view), /^Stand: .* bis .*/);
  assert.equal(standLine(buildTaskView(snapshot([]))), null);
});

// --- the refresh -----------------------------------------------------------

const sections = [
  { id: 's1', displayName: 'Vidala', parentNotebook: { displayName: '2026-27' } },
  { id: 's2', displayName: 'Köln Orfeo', parentNotebook: { displayName: '2026-27' } },
  { id: 's3', displayName: 'Essen', parentNotebook: { displayName: '2026-27' } },
];

const stubCall = ({ changed = ['Vidala', 'Köln Orfeo', 'Essen'], notReached = [] } = {}) => {
  const calls = [];
  const call = async (op, params = {}) => {
    calls.push({ op, params });
    if (op === 'list_notebooks') return { notebooks: [{ name: '2026-27' }, { name: '2027-28' }], section_list: sections };
    if (op === 'list_notes') {
      const notes = [
        { id: 'pv', title: 'CL Aufgaben — Vidala', section: 'Vidala', notebook: '2026-27', web_url: 'https://w/pv' },
        { id: 'pk', title: 'CL Status & Termine', section: 'Köln Orfeo', notebook: '2026-27' },
        { id: 'pe1', title: 'CL Aufgaben — Essen', section: 'Essen', notebook: '2026-27' },
        { id: 'pe2', title: 'CL Aufgaben', section: 'Essen', notebook: '2026-27' },
      ].filter((n) => changed.includes(n.section));
      return { notes, sections: changed.map((name) => ({ name, notebook: '2026-27' })) };
    }
    if (op === 'map_notes') {
      const reached = params.pages.filter((p) => !notReached.includes(p.id));
      return {
        read: reached.map((p) => ({ page: p, tasks: { lead: '', lead_cut: false, tasks: [], delegated: [], problems: [] }, error: null })),
        not_reached: params.pages.filter((p) => notReached.includes(p.id)),
      };
    }
    throw new Error(`the refresh asked for ${op}`);
  };
  return { call, calls };
};

test('a listing asks for sections and pages only, and reads no page', async () => {
  const { call, calls } = stubCall();
  const listing = await listNotebookTasks(call, '2026-27');
  assert.deepEqual(calls.map((c) => c.op), ['list_notebooks', 'list_notes']);
  // Narrowed to the one notebook, with the section listing handed on rather than fetched twice.
  assert.equal(calls[0].params.notebook, '2026-27');
  assert.equal(calls[1].params.sections, sections);
  assert.equal('since' in calls[1].params, false);
  assert.deepEqual(listing.pending, [
    { page_id: 'pv', section: 'Vidala', title: 'CL Aufgaben — Vidala', web_url: 'https://w/pv', client_url: null },
  ]);
  assert.deepEqual(listing.without, ['Köln Orfeo']);
  assert.deepEqual(listing.several, ['Essen']);
  assert.deepEqual(listing.sections, ['Vidala', 'Köln Orfeo', 'Essen']);
});

test('since is handed to the listing, and only listed sections count as changed', async () => {
  const { call, calls } = stubCall({ changed: ['Vidala'] });
  const listing = await listNotebookTasks(call, '2026-27', { since: '2026-11-23T07:50:00.000Z' });
  assert.equal(calls[1].params.since, '2026-11-23T07:50:00.000Z');
  assert.deepEqual(listing.changed, ['Vidala']);
  // Every section is still named, so a vanished one can be told from an unchanged one.
  assert.deepEqual(listing.sections, ['Vidala', 'Köln Orfeo', 'Essen']);
  assert.deepEqual(listing.without, []);
});

const pendingPage = (id, section) => ({ page_id: id, section, title: `CL Aufgaben — ${section}`, web_url: null, client_url: null });

test('pending pages are read in tasks mode, and what the deadline cut off is left, not dropped', async () => {
  const { call, calls } = stubCall({ notReached: ['pe'] });
  const read = await readTaskPages(call, '2026-27', [pendingPage('pv', 'Vidala'), pendingPage('pe', 'Essen')], {
    deadlineMs: 40_000,
  });
  assert.deepEqual(calls.map((c) => c.op), ['map_notes']);
  assert.equal(calls[0].params.tasks, true);
  assert.equal(calls[0].params.deadline_ms, 40_000);
  assert.deepEqual(read.pages.map((p) => p.page_id), ['pv']);
  assert.equal(read.left, 1);
});

test('nothing pending reads nothing', async () => {
  const { call, calls } = stubCall();
  assert.deepEqual(await readTaskPages(call, '2026-27', [], { deadlineMs: 40_000 }), { pages: [], left: 0 });
  assert.equal(calls.length, 0);
});

test('a notebook that no longer exists is an error, not an empty notebook', async () => {
  const { call } = stubCall();
  await assert.rejects(listNotebookTasks(call, 'Saison 2030'), /gibt es in OneNote nicht/);
});

test('a page found but not yet read, with no older copy, is said rather than missing', () => {
  const view = buildTaskView(
    snapshot([vidala], null, [notebook({ pending: [pendingPage('v', 'Vidala'), pendingPage('k', 'Köln')] })]),
  );
  assert.deepEqual(view.waiting.map((p) => p.section), ['Köln']);
  assert.equal(view.projects[0].notReached, true, 'an older copy still pending is not labelled as older');
});
