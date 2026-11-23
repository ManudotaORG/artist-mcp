import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTimeline,
  byDue,
  byResponsible,
  dueByToday,
  lanes,
  readFrist,
} from '../apps/web/src/lib/task-timeline.ts';

/**
 * The Zeitplan (0021): which Frist cells are read as dates, and how an overdue
 * task is drawn. Nothing here writes; sliding is display only.
 */

const page = { page_id: 'p1', notebook: '2026-27', section: 'Tosca Graz', title: 'CL Aufgaben — Tosca Graz' };
const shown = (text, frist, extra = {}) => ({
  key: text,
  text,
  details: null,
  cells: frist === undefined ? { Verantwortlich: 'Ruben' } : { Verantwortlich: 'Ruben', Frist: frist },
  unsettled: null,
  stale_status: null,
  page,
  ...extra,
});

test('a single date, written or from a rule', () => {
  assert.deepEqual(readFrist('01.09.2026'), { start: '2026-09-01', end: '2026-09-01', latest: null, rule: false });
  assert.deepEqual(readFrist('01.09.2026 (Regel: 2 Mon. vor Konzert)'), {
    start: '2026-09-01',
    end: '2026-09-01',
    latest: null,
    rule: true,
  });
  assert.equal(readFrist('1.9.2026')?.end, '2026-09-01');
  assert.equal(readFrist('25.12.2026 (gerechnet)')?.rule, true);
  assert.equal(readFrist('bis zum 11.11.2026')?.end, '2026-11-11');
  assert.equal(readFrist('vor 05.01.2027')?.end, '2027-01-05');
  assert.equal(readFrist('21.09.2026 — gerechnet: mind. 2 Wochen vor dem 05.10.2026')?.rule, true);
});

test('an ideal date with a latest one after it', () => {
  assert.deepEqual(readFrist('29.09.2026, spät. 13.10.2026 (Regel: vor Probenbeginn)'), {
    start: '2026-09-29',
    end: '2026-09-29',
    latest: '2026-10-13',
    rule: true,
  });
  assert.equal(readFrist('idealerweise 29.09.2026, spätestens 13.10.2026')?.latest, '2026-10-13');
});

test('a span, in each way it is written', () => {
  for (const cell of ['15.–29.09.2026', '15.09.–29.09.2026', '15.09.2026–29.09.2026', '15.09.2026 - 29.09.2026']) {
    const f = readFrist(cell);
    assert.equal(f?.start, '2026-09-15', cell);
    assert.equal(f?.end, '2026-09-29', cell);
  }
  assert.equal(readFrist('28.12.2026–08.01.2027')?.start, '2026-12-28');
});

test('anything else is not guessed into a date', () => {
  for (const cell of ['UNKNOWN', 'laufend', 'Ende Jänner', 'mit dem Vertragsrücklauf', 'bis 15.12.', '31.02.2026', 'KW 12 2026']) {
    assert.equal(readFrist(cell), null, cell);
  }
});

test('an overdue open task is drawn from tomorrow, keeping its length, and marked', () => {
  const t = buildTimeline([shown('Partitur', '10.11.–16.11.2026'), shown('Stimmen', '30.11.2026')], '2026-11-23');
  const [late, ahead] = t.placed;
  assert.equal(late.start, '2026-11-24');
  assert.equal(late.end, '2026-11-30');
  assert.equal(late.overdueSince, '2026-11-16');
  assert.equal(late.cell, '10.11.–16.11.2026', 'the page keeps its date');
  assert.equal(ahead.overdueSince, null);
});

test('a task due today is not overdue', () => {
  const [item] = buildTimeline([shown('Heute', '23.11.2026')], '2026-11-23').placed;
  assert.equal(item.overdueSince, null);
});

test('undated work is kept beside the timeline: urgent first, words in their own list', () => {
  const t = buildTimeline(
    [
      shown('Vertrag SOFORT schicken', 'UNKNOWN'),
      shown('Dispo', 'PRIORITÄT 1 — SEHR DRINGEND; kein Datum'),
      shown('Hotel', undefined),
      shown('Laufend', 'laufend'),
      shown('Datiert', '01.12.2026'),
    ],
    '2026-11-23',
  );
  assert.deepEqual(t.urgent.map((x) => x.text), ['Vertrag SOFORT schicken', 'Dispo']);
  assert.deepEqual(t.undated.map((x) => x.text), ['Hotel']);
  assert.deepEqual(t.unclear.map((x) => x.cell), ['laufend']);
  assert.deepEqual(t.placed.map((x) => x.task.text), ['Datiert']);
});

test('without cells from the parser, nothing is placed and the view says it cannot', () => {
  const t = buildTimeline([shown('Alt', '01.12.2026', { cells: null })], '2026-11-23');
  assert.equal(t.available, false);
  assert.equal(t.placed.length, 0);
});

test('overlapping tasks of one project get their own lanes', () => {
  const t = buildTimeline([shown('A', '01.–10.12.2026'), shown('B', '05.12.2026'), shown('C', '11.12.2026')], '2026-11-23');
  assert.deepEqual(lanes(t.rows[0].items).map((l) => l.map((i) => i.task.text)), [['A', 'C'], ['B']]);
});

test('Fristen orders by the date the page gives, and Heute keeps what is due by today', () => {
  const t = buildTimeline(
    [shown('Später', '10.12.2026'), shown('Heute', '23.11.2026'), shown('Lange her', '01.10.2026')],
    '2026-11-23',
  );
  assert.deepEqual(byDue(t).map((x) => x.task.text), ['Lange her', 'Heute', 'Später']);
  assert.deepEqual(dueByToday(t).map((x) => x.task.text), ['Lange her', 'Heute']);
});

test('Menschen groups by the Verantwortlich cell as written, and never splits or merges it', () => {
  const who = (text, v) => shown(text, '01.12.2026', { cells: v === null ? { Frist: 'x' } : { Verantwortlich: v } });
  const { groups, without } = byResponsible([
    who('a', 'Ruben'),
    who('b', 'Ruben'),
    who('c', 'Ruben, Büro'),
    who('d', ''),
    who('e', null),
    shown('f', undefined, { cells: null }),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.who, g.tasks.length]),
    [['Ruben', 2], ['(leer)', 1], ['Ruben, Büro', 1]],
  );
  assert.equal(without, 2);
});
