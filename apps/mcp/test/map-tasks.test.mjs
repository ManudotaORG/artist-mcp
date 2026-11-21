import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../dist/server.js';
import { listNotebooks, listNotes } from '../dist/notes.js';
import { LEAD_CHARS, mapTasks, pageTasks } from '../dist/tasks.js';
import { withGraphBatch } from './support/graph-batch.mjs';

/**
 * `map_notes` with `tasks: true` (0014): one CL Aufgaben page per section.
 *
 * A full read of the three season notebooks measured about 270 OneNote
 * requests, against 400 an hour. The point of this mode is that the digest
 * reads a section's task record and nothing else, so the URLs are asserted and
 * not only the text — a mode that read every page and printed only the tasks
 * would pass every text assertion and save nothing.
 */

/** Shaped as Graph returns it: the tag sits on a span in the cell. */
const VIDALA =
  '<html><head><title>CL Aufgaben — Vidala</title></head><body><div>' +
  '<p>Die Reise- und Hotelbuchungen warten auf Vertragsabschluss und Gagenbestätigung.</p>' +
  '<table><tr><td><p>Aufgabe</p></td><td><p>Verantwortlich</p></td><td><p>Frist</p></td><td><p>Status</p></td></tr>' +
  '<tr><td><span data-tag="to-do">Arrangements fertigstellen</span></td><td><p>Ruben</p></td>' +
  '<td><p>spätestens 01.11.2026</p></td><td><p>OFFEN</p></td></tr>' +
  '<tr><td><span data-tag="to-do:completed">Programm an Cornelia</span></td><td><p>Ruben</p></td>' +
  '<td><p>UNKNOWN</p></td><td><p>ERLEDIGT</p></td></tr>' +
  '</table>' +
  '<p>Neu, automatisch ergänzt</p>' +
  '<p data-tag="to-do">Probenplan an die Agentur schicken — aus Mail „Re: Probenplan", 21.11.</p>' +
  '</div></body></html>';

test('a table task carries its row, labelled by the header row', () => {
  const { tasks } = pageTasks(VIDALA);
  assert.deepEqual(tasks[0], {
    text: 'Arrangements fertigstellen',
    done: false,
    details: 'Verantwortlich: Ruben · Frist: spätestens 01.11.2026 · Status: OFFEN',
  });
  assert.equal(tasks[1].done, true);
});

test('an appended line is a task, after the table, with its source in its words', () => {
  const { tasks } = pageTasks(VIDALA);
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks[2], {
    text: 'Probenplan an die Agentur schicken — aus Mail „Re: Probenplan", 21.11.',
    done: false,
    details: null,
  });
});

test('the lead is the opening prose up to the first task, and nothing after it', () => {
  const { lead, lead_cut } = pageTasks(VIDALA);
  assert.equal(lead, 'Die Reise- und Hotelbuchungen warten auf Vertragsabschluss und Gagenbestätigung.');
  assert.equal(lead_cut, false);
  assert.doesNotMatch(lead, /CL Aufgaben/, 'the title is in <head>, not the lead');
  assert.doesNotMatch(lead, /automatisch/);
});

test('a long lead is cut, and says it was', () => {
  const long = 'Frist für alles: 15.12.2026. '.repeat(40);
  const { lead, lead_cut } = pageTasks(`<body><p>${long}</p><p data-tag="to-do">x</p></body>`);
  assert.equal(lead_cut, true);
  assert.ok(lead.length <= LEAD_CHARS + 1);
});

test('a task table nobody tagged is reported, not read as no work', () => {
  const html =
    '<body><table><tr><td>Aufgabe</td><td>Frist</td></tr>' +
    '<tr><td>Hotel buchen</td><td>01.12.</td></tr></table></body>';
  const { tasks, problems } = pageTasks(html);
  assert.deepEqual(tasks, []);
  assert.ok(problems.some((p) => /headed "Aufgabe · Frist"\) has no to-do tags, so none of its 1 row is read/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /no to-do tags, so no task on it can be read/.test(p)));
});

test('a box or a key-value table that mentions Aufgaben is not a task table', () => {
  // Both shapes are on the live pages, and both were flagged by the first
  // version, which matched a word anywhere in the header row.
  const html =
    '<body><table><tr><td>Offen sind die Aufgaben zur Einstudierung.</td></tr></table>' +
    '<table><tr><td>Aufgaben zu Strichen</td><td>siehe Seite Noten</td></tr></table>' +
    '<p data-tag="to-do">Gage klären</p></body>';
  assert.deepEqual(pageTasks(html).problems, []);
});

test('a table of facts with no tags is not a problem', () => {
  const html =
    '<body><table><tr><td>Ort</td><td>Saal</td></tr><tr><td>Wien</td><td>Brahms</td></tr></table>' +
    '<p data-tag="to-do">Gage klären</p></body>';
  assert.deepEqual(pageTasks(html).problems, []);
});

test('a tagged first row means no header, and the labels say so', () => {
  const html =
    '<body><table><tr><td><span data-tag="to-do">Noten kaufen</span></td><td>Ruben</td></tr></table></body>';
  const { tasks, problems } = pageTasks(html);
  assert.equal(tasks[0].details, 'Column 2: Ruben');
  assert.ok(problems.some((p) => /no header row/.test(p)));
});

test('a table nested in a cell does not end the outer table early', () => {
  const html =
    '<body><table><tr><td>Aufgabe</td><td>Notiz</td></tr>' +
    '<tr><td><span data-tag="to-do">Saal klären</span></td>' +
    '<td><table><tr><td>a</td></tr></table></td></tr>' +
    '<tr><td><span data-tag="to-do">Hotel buchen</span></td><td>später</td></tr></table></body>';
  const { tasks } = pageTasks(html);
  assert.deepEqual(tasks.map((t) => t.text), ['Saal klären', 'Hotel buchen']);
  assert.equal(tasks[1].details, 'Notiz: später');
});

// ---------------------------------------------------------------------------
// Through the tool: which pages are fetched, and what the answer admits to.

const page = (id, title) => ({ id, title, lastModifiedDateTime: '2026-11-20T10:00:00Z' });
const section = (id, name, date = '2026-11-20T10:00:00Z') => ({
  id,
  displayName: name,
  lastModifiedDateTime: date,
  parentNotebook: { displayName: 'S' },
});

const GRAPH = {
  '/me/onenote/sections?': {
    value: [
      section('s-vid', 'Vidala-Tournee'),
      section('s-none', 'Köln Orfeo'),
      section('s-two', 'Melk'),
      section('s-old', 'Archiv', '2026-01-01T00:00:00Z'),
    ],
  },
  '/sections/s-vid/pages': { value: [page('p-vid', 'CL Aufgaben — Vidala'), page('p-mitt', 'Mittersill')] },
  '/sections/s-none/pages': {
    value: [page('p-status', 'CL Status & Termine'), page('p-kat', 'CL Aufgaben-Kategorien')],
  },
  '/sections/s-two/pages': { value: [page('p-m1', 'CL Aufgaben — Melk'), page('p-m2', 'CL Aufgaben')] },
  '/sections/s-old/pages': { value: [page('p-old', 'CL Aufgaben — Archiv')] },
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const run = async (args, { content = () => VIDALA } = {}) => {
  const seen = [];
  globalThis.fetch = withGraphBatch(async (url) => {
    const path = String(url);
    seen.push(path);
    const read = path.match(/\/pages\/([^/?]+)\/content/);
    if (read) return content(decodeURIComponent(read[1]));
    const match = Object.keys(GRAPH).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(GRAPH[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const server = await createServer(async (op, params) => {
    if (op === 'list_notebooks') return listNotebooks('token');
    if (op === 'list_notes') return listNotes('token', params);
    if (op === 'map_notes' && params.tasks === true) {
      return mapTasks('token', params.pages, { deadlineMs: params.deadline_ms });
    }
    throw new Error(`unexpected operation ${op}`);
  });
  const result = await server._registeredTools.map_notes.handler(args);
  const contents = seen
    .map((u) => u.match(/\/pages\/([^/?]+)\/content/)?.[1])
    .filter(Boolean)
    .map(decodeURIComponent);
  return { text: result.content.map((c) => c.text).join('\n'), seen, contents };
};

const asHtml = (html) => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

test('tasks mode reads the one CL Aufgaben page per section, and no other page', async () => {
  const { contents, seen } = await run({ tasks: true }, { content: () => asHtml(VIDALA) });
  // Melk has two and reads neither; Köln Orfeo has none, and its
  // CL Aufgaben-Kategorien is a reference page, not a task record.
  assert.deepEqual(contents.sort(), ['p-old', 'p-vid']);
  assert.equal(seen.filter((u) => u.includes('/preview')).length, 0, 'tasks mode sketches nothing');
  assert.ok(seen.every((u) => !u.includes('includeIDs')), 'a read for tasks needs no edit ids');
});

test('the answer lists open tasks with their rows, and counts the done ones', async () => {
  const { text } = await run({ tasks: true, section: 'Vidala-Tournee' }, { content: () => asHtml(VIDALA) });
  assert.match(text, /## CL Aufgaben — Vidala \(S \/ Vidala-Tournee\)/);
  assert.match(text, /\[ \] Arrangements fertigstellen\n {4}Verantwortlich: Ruben · Frist: spätestens 01\.11\.2026 · Status: OFFEN/);
  assert.match(text, /\[ \] Probenplan an die Agentur schicken/);
  assert.doesNotMatch(text, /Programm an Cornelia/);
  assert.match(text, /2 open, 1 done\./);
  assert.match(text, /Lead: Die Reise- und Hotelbuchungen/);
});

test('include_done lists the finished tasks too', async () => {
  const { text } = await run(
    { tasks: true, section: 'Vidala-Tournee', include_done: true },
    { content: () => asHtml(VIDALA) },
  );
  assert.match(text, /\[x\] Programm an Cornelia/);
});

test('sections with no page, and with two, are named and read nothing', async () => {
  const { text } = await run({ tasks: true }, { content: () => asHtml(VIDALA) });
  assert.match(text, /No CL Aufgaben page, so nothing in these sections was read: S \/ Köln Orfeo\. Their tasks are unknown, not absent/);
  assert.match(text, /S \/ Melk has 2 CL Aufgaben pages, so none was read: "CL Aufgaben — Melk" \(id: p-m1\), "CL Aufgaben" \(id: p-m2\)/);
  assert.match(text, /prose elsewhere on it and every other page in the section were not/);
});

test('with since, unchanged sections are skipped before any page, and the answer says what that hides', async () => {
  const { contents, text } = await run({ tasks: true, since: '2026-11-14' }, { content: () => asHtml(VIDALA) });
  assert.deepEqual(contents, ['p-vid'], 'the Archiv section is older than the cutoff');
  assert.match(text, /1 section unchanged since 2026-11-14 was not read\. Their tasks are not in this answer, including any coming due/);
});

test('a page that cannot be read is named as unknown, not shown as empty', async () => {
  const { text } = await run(
    { tasks: true, section: 'Vidala-Tournee' },
    { content: () => new Response('{"error":{"code":"20102","message":"gone"}}', { status: 404 }) },
  );
  assert.match(text, /COULD NOT BE READ .* its tasks are unknown, not absent/);
});

test('a page read that outlives the deadline is reported as not reached', async () => {
  // A request that never answers. Without the race the map would wait forever.
  globalThis.fetch = () => new Promise(() => {});
  const result = await mapTasks('token', [{ id: 'p-vid', title: 'CL Aufgaben — Vidala', section: 'V', notebook: 'S', last_modified: null }], {
    deadlineMs: 50,
  });
  assert.deepEqual(result.read, []);
  assert.deepEqual(result.not_reached.map((p) => p.id), ['p-vid']);
});

// ---------------------------------------------------------------------------
// Delegation: a task handed on counts as done, with who it went to.

const row = (...cells) => `<tr>${cells.map((c) => `<td><p>${c}</p></td>`).join('')}</tr>`;
const DELEGATION_HEADER = row('Aufgabe', '&#220;bergeben an', '&#220;bergeben am', 'R&#252;ckmeldung erhalten');

/** As on CL Aufgaben — Mittersill: four real handovers, entities as Graph sends them. */
const MITTERSILL =
  '<body><p data-tag="to-do">Musikerliste fertigstellen</p><table>' +
  DELEGATION_HEADER +
  row('Musikermanagement', 'Katharina W&#252;rgau', '&#252;bernommen — 10.09.2026', '&#220;bernommen; die Musikerliste fehlt noch') +
  row('Bogenstriche in die Noten eintragen', 'Katja (Konzertmeisterin)', 'UNKNOWN', 'UNKNOWN') +
  '</table></body>';

/** As on CL Aufgaben — Montepulciano: the template's rows, never filled in. */
const PLACEHOLDERS =
  '<body><p data-tag="to-do">Ausgabe 2027 planen</p><table>' +
  DELEGATION_HEADER +
  row('UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN') +
  row('UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN') +
  '</table></body>';

test('a delegation table row is a handover, with who, when and what came back', () => {
  const { tasks, delegated, problems } = pageTasks(MITTERSILL);
  assert.deepEqual(delegated, [
    {
      text: 'Musikermanagement',
      to: 'Katharina Würgau',
      on: 'übernommen — 10.09.2026',
      reply: 'Übernommen; die Musikerliste fehlt noch',
      from: 'table',
    },
    { text: 'Bogenstriche in die Noten eintragen', to: 'Katja (Konzertmeisterin)', on: null, reply: null, from: 'table' },
  ]);
  assert.deepEqual(tasks.map((t) => t.text), ['Musikerliste fertigstellen'], 'handovers are not open tasks');
  assert.deepEqual(problems, [], 'an untagged delegation table is not an untagged task table');
});

test('template placeholder rows are not handovers', () => {
  const { delegated, problems } = pageTasks(PLACEHOLDERS);
  assert.deepEqual(delegated, []);
  assert.deepEqual(problems, []);
});

test('a task listed for handover with no recipient is said, and counted neither way', () => {
  const html = `<body><table>${DELEGATION_HEADER}${row('Hotel buchen', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN')}</table></body>`;
  const { delegated, tasks, problems } = pageTasks(html);
  assert.deepEqual(delegated, []);
  assert.deepEqual(tasks, []);
  assert.ok(problems.some((p) => /"Hotel buchen" is listed for handover in Table 1 with no recipient recorded/.test(p)), problems.join('\n'));
});

test('a ticked task that names a handover is delegated, not merely done', () => {
  const html =
    '<body><p data-tag="to-do:completed">Musikerliste schicken → übergeben an Katharina Würgau, 12.10.2026</p>' +
    '<p data-tag="to-do:completed">Programm geschickt</p></body>';
  const { tasks, delegated } = pageTasks(html);
  assert.deepEqual(delegated, [
    {
      text: 'Musikerliste schicken → übergeben an Katharina Würgau, 12.10.2026',
      to: 'Katharina Würgau',
      on: '12.10.2026',
      reply: null,
      from: 'tick',
    },
  ]);
  assert.deepEqual(tasks.map((t) => t.text), ['Programm geschickt']);
});

test('an open task that mentions a handover stays open, because the tag is the record', () => {
  const { tasks, delegated } = pageTasks('<body><p data-tag="to-do">Noten → übergeben an Daria</p></body>');
  assert.deepEqual(delegated, []);
  assert.equal(tasks[0].done, false);
});

test('the answer lists handovers under Delegiert, and counts them apart', async () => {
  const { text } = await run({ tasks: true, section: 'Vidala-Tournee' }, { content: () => asHtml(MITTERSILL) });
  assert.match(text, /Delegiert \(counted as done\):\n→ Musikermanagement — an Katharina Würgau, übernommen — 10\.09\.2026 · Rückmeldung: Übernommen; die Musikerliste fehlt noch/);
  assert.match(text, /→ Bogenstriche in die Noten eintragen — an Katja \(Konzertmeisterin\) · no reply recorded/);
  assert.match(text, /1 open, 0 done, 2 delegated\./);
});
