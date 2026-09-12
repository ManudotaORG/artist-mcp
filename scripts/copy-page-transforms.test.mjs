import assert from 'node:assert/strict';
import test from 'node:test';

import { preserveTableBorders, preserveTaskTags } from './copy-onenote-page.mjs';

/**
 * What OneNote drops when a page is created, and the copy puts back.
 *
 * Both of these were learned from a page that came back wrong, not from the
 * documentation, and both fail silently: the text arrives, the formatting or
 * the checkbox does not. A copy is where the asymmetry bites, because OneNote's
 * own output is being handed straight back to it as input.
 *
 * Task tags, measured on a real create carrying all the forms at once:
 *
 *   <p data-tag> outside a table     kept
 *   <p data-tag> inside a cell       kept, and returned as a span
 *   <span data-tag> inside a cell    DROPPED
 *
 * So a page copied verbatim loses every task tag it had — the whole task state
 * of a CL Aufgabe page — while looking like a faithful copy.
 */

test('a tagged span becomes the paragraph form OneNote will accept', () => {
  assert.equal(
    preserveTaskTags('<td><span data-tag="to-do">Weill lernen</span></td>'),
    '<td><p data-tag="to-do">Weill lernen</p></td>',
  );
  assert.equal(
    preserveTaskTags('<td><span data-tag="to-do:completed">Entschieden</span></td>'),
    '<td><p data-tag="to-do:completed">Entschieden</p></td>',
  );
});

test('a span carrying no tag is left exactly as it was', () => {
  const heading = '<p><span style="font-weight:bold">Eckdaten</span></p>';
  assert.equal(preserveTaskTags(heading), heading);
});

test('a span wrapping other markup is layout, and is not restructured', () => {
  // Turning this into a paragraph would move the elements inside it rather
  // than preserve the cell.
  const wrapping = '<span data-tag="to-do"><p>A</p><p>B</p></span>';
  assert.equal(preserveTaskTags(wrapping), wrapping);
});

test('every tag in a table is converted, not just the first', () => {
  const out = preserveTaskTags(
    '<table><tr><td><span data-tag="to-do">A</span></td></tr>' +
      '<tr><td><span data-tag="to-do">B</span></td></tr>' +
      '<tr><td><span data-tag="to-do:completed">C</span></td></tr></table>',
  );
  assert.equal((out.match(/<p data-tag/g) ?? []).length, 3);
  assert.equal(out.includes('<span data-tag'), false);
});

test('a bordered table keeps the attribute OneNote acts on', () => {
  assert.match(
    preserveTableBorders('<table style="border:1px solid;border-collapse:collapse">'),
    /<table border="1"/,
  );
  assert.equal(
    preserveTableBorders('<table style="border:0px">'),
    '<table style="border:0px">',
  );
});
