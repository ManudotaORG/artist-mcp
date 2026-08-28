import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmationToken,
  draftFrom,
  pageXhtml,
  refuseUnsettled,
} from '../dist/onenote-write.js';

const draft = (over = {}) => ({
  section_id: '0-AE14106C4F7C7DCC!sedce32b208ec46618fd34301f03b8cba',
  title: 'Reiter wedding — working notes',
  body: 'Ceremony at 3pm.\n\nFee agreed at 450 EUR.',
  source_page: null,
  ...over,
});

test('a draft is shaped and trimmed, not taken on trust', () => {
  const d = draftFrom({ ...draft(), title: '  spaced  ' });
  assert.equal(d.title, 'spaced');
  assert.equal(d.source_page, null);
});

test('the fields a page cannot be created without are required by name', () => {
  for (const field of ['section_id', 'title', 'body']) {
    const params = { ...draft() };
    delete params[field];
    assert.throws(() => draftFrom(params), new RegExp(field));
  }
});

test('a body of nothing but whitespace is not a page', () => {
  assert.throws(() => draftFrom(draft({ body: '   \n\n  ' })), /body is required/);
});

test('ids are shape-checked, because they are concatenated into a URL', () => {
  assert.throws(() => draftFrom(draft({ section_id: '../../pages' })), /section_id is malformed/);
  assert.throws(() => draftFrom(draft({ source_page: 'a b/c' })), /source_page is malformed/);
});

/**
 * The cap is the working-unit rule, not a Graph limit — so the message has to
 * say what to do about it, since the caller can always split.
 */
test('a body too long to be one working unit is refused, with the remedy', () => {
  assert.throws(() => draftFrom(draft({ body: 'x'.repeat(20_001) })), /Split it across pages/);
  assert.doesNotThrow(() => draftFrom(draft({ body: 'x'.repeat(20_000) })));
});

test('a title longer than a title is refused', () => {
  assert.throws(() => draftFrom(draft({ title: 'x'.repeat(201) })), /200 is the most/);
});

/**
 * The rule that matters most in the decision record. A page is read back by
 * later sessions as though the notebook had settled the question.
 */
test('an unsettled title is not written', () => {
  for (const title of ['TBC', 'tbc', 'Fee TBD', 'Venue T.B.C', 'When??']) {
    assert.throws(() => refuseUnsettled(draft({ title })), /not settled/, title);
  }
});

/**
 * The deliberate asymmetry with the calendar: prose legitimately records an
 * open question, and refusing that would leave the tool unable to write down
 * the very thing the notebook is for.
 */
test('an unsettled body is written, because prose may record an open question', () => {
  assert.doesNotThrow(() => refuseUnsettled(draft({ body: 'The fee is still TBC.' })));
});

/**
 * The case that made the calendar's matching case-sensitive. A real gig title
 * must not be refused for containing a word.
 */
test('a real title containing a placeholder word survives', () => {
  assert.doesNotThrow(() => refuseUnsettled(draft({ title: 'Unknown Pleasures tribute night' })));
});

test('a blank line starts a paragraph and a single newline stays a line break', () => {
  const html = pageXhtml(draft({ body: 'One\nstill one\n\nTwo' }));
  assert.match(html, /<p>One<br\/>still one<\/p><p>Two<\/p>/);
});

/**
 * A model composing a page from an email or an attachment passes through text
 * it did not author. Unescaped, that text would decide what the page contains.
 */
test('everything the caller supplied is escaped, in both title and body', () => {
  const html = pageXhtml(
    draft({ title: 'Fee <b>& costs</b>', body: '<script>alert("x")</script>' }),
  );
  assert.match(html, /<title>Fee &lt;b&gt;&amp; costs&lt;\/b&gt;<\/title>/);
  assert.ok(!html.includes('<script>'), 'a script tag reached the page body');
  assert.match(html, /&lt;script&gt;/);
});

test('the ampersand is escaped once, not twice', () => {
  assert.match(pageXhtml(draft({ body: 'Bass & drums' })), /<p>Bass &amp; drums<\/p>/);
  assert.ok(!pageXhtml(draft({ body: 'Bass & drums' })).includes('&amp;amp;'));
});

/**
 * The token proves the create is for the values that were shown, not that a
 * preview happened at some point.
 */
test('the token changes when any shown value changes', async () => {
  const base = await confirmationToken(draft());
  for (const change of [{ title: 'Other' }, { body: 'Other' }, { section_id: 'other-id' }]) {
    assert.notEqual(await confirmationToken(draft(change)), base, JSON.stringify(change));
  }
});

test('the token is stable for identical values', async () => {
  assert.equal(await confirmationToken(draft()), await confirmationToken(draft()));
});

/**
 * source_page is provenance for the audit line, not part of what the musician
 * approved. Hashing it would report a caller that dropped the field between
 * preview and create as though the page itself had changed.
 */
test('the token ignores source_page, which is provenance rather than content', async () => {
  assert.equal(
    await confirmationToken(draft({ source_page: '1-abc' })),
    await confirmationToken(draft({ source_page: null })),
  );
});
