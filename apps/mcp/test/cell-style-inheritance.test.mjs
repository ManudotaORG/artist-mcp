import assert from 'node:assert/strict';
import test from 'node:test';

import { inherit } from '../dist/onenote-patch.js';

/**
 * A replaced table keeps each cell's own formatting, not the first cell's.
 *
 * Inheritance used to read the style off the FIRST cell of the table being
 * replaced and put it on every cell of the replacement. That is right only for
 * a table whose cells all look alike. On a table with a shaded header row the
 * first cell IS the header, so replacing a task table in place painted
 * `background-color:#EFEFEF` onto all 52 of its cells and the table came back
 * one solid grey block.
 *
 * Nothing reported it. The preview said it was "keeping the style of the table
 * it replaces", which was true, and was read — by me, to the musician — as
 * reassurance that nothing had changed. A caller cannot approve damage a
 * preview describes as preservation.
 */

const HEADER = 'style="background-color:#EFEFEF;border:1px solid #A3A3A3"';
const BODY = 'style="border:1px solid #A3A3A3"';

const shadedHeaderTable = (rows) =>
  '<table border="1">' +
  `<tr><td ${HEADER}><p>Aufgabe</p></td><td ${HEADER}><p>Status</p></td></tr>` +
  rows.map((r) => `<tr><td ${BODY}><p>${r}</p></td><td ${BODY}><p>OFFEN</p></td></tr>`).join('') +
  '</table>';

const bare = (rows) =>
  '<table>' +
  '<tr><td><p>Aufgabe</p></td><td><p>Status</p></td></tr>' +
  rows.map((r) => `<tr><td><p>${r}</p></td><td><p>OFFEN</p></td></tr>`).join('') +
  '</table>';

const shadingOf = (html) =>
  (html.match(/<td[^>]*>/g) ?? []).map((cell) => /background-color/i.test(cell));

test('the header stays shaded and the body does not', () => {
  const { html } = inherit(shadedHeaderTable(['Weill lernen', 'IBAN prüfen']), bare(['Weill lernen', 'IBAN prüfen']));

  assert.deepEqual(
    shadingOf(html),
    [true, true, false, false, false, false],
    'shading did not land on the header row alone',
  );
});

test('a body cell never inherits the header shading', () => {
  // The regression itself, stated as the thing that must not happen.
  const { html } = inherit(shadedHeaderTable(['a', 'b', 'c']), bare(['a', 'b', 'c']));
  const shaded = shadingOf(html).filter(Boolean).length;

  assert.equal(shaded, 2, `${shaded} of 8 cells are shaded; only the 2 header cells should be`);
});

test('borders still reach every cell, which is what inheritance is for', () => {
  const { html } = inherit(shadedHeaderTable(['a']), bare(['a']));
  const bordered = (html.match(/<td[^>]*>/g) ?? []).filter((c) => /border:1px/.test(c)).length;

  assert.equal(bordered, 4, 'a cell lost its border, which is the bug inheritance exists to stop');
});

test('a replacement of a different shape does not map styles by position', () => {
  // Four body rows against two: carrying by index would put the header's
  // shading on whatever landed in slot 0 and 1 regardless of what it is.
  const { html } = inherit(shadedHeaderTable(['a', 'b', 'c', 'd']), bare(['a']));

  assert.deepEqual(
    shadingOf(html),
    [false, false, false, false],
    'a mismatched shape inherited the header shading by position',
  );
});

test('a caller that styles one cell is left alone entirely', () => {
  const mine = '<table><tr><td style="border:2px dotted"><p>A</p></td><td><p>B</p></td></tr></table>';
  const { html } = inherit(shadedHeaderTable(['a']), mine);

  assert.equal(html.includes('background-color'), false, 'styling one cell did not take responsibility for all');
  assert.equal(html.includes('2px dotted'), true);
});
