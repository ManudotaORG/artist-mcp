import assert from 'node:assert/strict';
import test from 'node:test';

import { htmlToText } from '../dist/notes.js';

/**
 * OneNote moves the tag, and the reader has to follow it.
 *
 * A cell written as `<td><p data-tag="to-do">…</p></td>` comes back from Graph
 * as `<td><span data-tag="to-do">…</span></td>`: the paragraph is gone and the
 * tag now sits on a span. Matching only `p` and `li` meant every task inside a
 * table read as untagged, so a page keeping its tasks in a table reported none
 * of them done however many were ticked.
 *
 * That is worse than a cosmetic gap. The workflow this serves corrects a page
 * from an update typed in chat, and a reader that cannot see which tasks are
 * finished will reopen one that is done.
 *
 * Found the long way: twelve tags were written, the page read back clean, and
 * the write declared a failure. The tags were on the page the whole time. So
 * the markup here is what Graph actually returned, not what was sent.
 */

/** Exactly as Graph returns it, attribute order and all. */
const AS_GRAPH_RETURNS_IT =
  '<table id="table:{x}{19}" style="border:1px solid;border-collapse:collapse">' +
  '<tr id="tr:{x}{57}">' +
  '<td id="td:{x}{81}" style="border:1px solid"><span data-tag="to-do">Kurt Weill lernen</span></td>' +
  '<td id="td:{x}{83}" style="border:1px solid"><p>Ruben</p></td>' +
  '</tr>' +
  '<tr id="tr:{x}{59}">' +
  '<td id="td:{x}{85}" style="border:1px solid"><span data-tag="to-do:completed">Rückreise entschieden</span></td>' +
  '<td id="td:{x}{87}" style="border:1px solid"><p>Ruben</p></td>' +
  '</tr></table>';

test('a task tagged inside a table cell reads as a checkbox', () => {
  const text = htmlToText(AS_GRAPH_RETURNS_IT);

  assert.match(text, /\[ \] Kurt Weill lernen/, 'an open task in a cell read as untagged');
  assert.match(text, /\[x\] Rückreise entschieden/, 'a finished task in a cell read as untagged');
});

test('the paragraph form still works, since OneNote keeps it outside tables', () => {
  assert.match(htmlToText('<p data-tag="to-do">Noten prüfen</p>'), /\[ \] Noten prüfen/);
  assert.match(htmlToText('<p data-tag="to-do:completed">Noten geprüft</p>'), /\[x\] Noten geprüft/);
});

test('a completed tag never reads as an open one', () => {
  const text = htmlToText('<span data-tag="to-do:completed">Fertig</span>');

  assert.match(text, /\[x\] Fertig/);
  assert.equal(text.includes('[ ]'), false, 'a done task was reported as still open');
});

test('a span carrying no tag is left alone', () => {
  assert.equal(htmlToText('<span style="font-weight:bold">Eckdaten</span>'), 'Eckdaten');
});
