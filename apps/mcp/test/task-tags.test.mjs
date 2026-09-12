import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFragment } from '../dist/onenote-patch.js';
import { htmlToText } from '../dist/notes.js';

/**
 * A task is a `data-tag` on the paragraph, and it has to survive both ways.
 *
 * Reading understood these long before anything could write — `htmlToText` has
 * rendered them as `[ ]` and `[x]` since before writes existed — while the
 * attribute allowlist refused every patch that carried one. So a task could be
 * read, reported, and never recorded: the page kept whatever checkbox it
 * already had, and a task the musician had just finished stayed open.
 *
 * The narrowness is the point. OneNote defines dozens of tags and every one is
 * a claim about the line it marks; a model writing `important` is a judgement
 * arriving as page markup. Two values have an agreed meaning here and the rest
 * stay out.
 */

test('an open task and a completed one can both be written', () => {
  validateFragment('<p data-tag="to-do">Send the programme to the Musikverein</p>');
  validateFragment('<p data-tag="to-do:completed">Viola spelling settled</p>');
  // In a list, because a bare <li> is refused for its own reasons.
  validateFragment('<ul><li data-tag="to-do">Confirm the Sitzprobe date</li></ul>');
});

test('what is written comes back as a checkbox on the way out', () => {
  const open = htmlToText('<p data-tag="to-do">Send the programme</p>');
  const done = htmlToText('<p data-tag="to-do:completed">Viola spelling settled</p>');

  assert.match(open, /\[ \] Send the programme/);
  assert.match(done, /\[x\] Viola spelling settled/);
});

test('every other OneNote tag is refused, however available it is', () => {
  for (const tag of ['important', 'question', 'remember-for-later', 'critical']) {
    assert.throws(
      () => validateFragment(`<p data-tag="${tag}">Mittersill</p>`),
      new RegExp(`data-tag="${tag}"`),
      `${tag} was accepted`,
    );
  }
});

test('a tag on something that is not a line of text is refused', () => {
  // OneNote renders a checkbox wherever the tag lands. On a cell or a heading
  // that is a checkbox nobody asked for, in a place nobody put a task.
  assert.throws(
    () => validateFragment('<table border="1"><tr><td data-tag="to-do"><p>x</p></td></tr></table>'),
    /data-tag/,
    'a tagged table cell was accepted',
  );
});

test('the refusal says nothing was written, because nothing was', () => {
  assert.throws(
    () => validateFragment('<p data-tag="important">Mittersill</p>'),
    /Nothing was written/,
  );
});
