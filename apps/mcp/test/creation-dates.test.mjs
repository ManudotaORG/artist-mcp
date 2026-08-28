import assert from 'node:assert/strict';
import test from 'node:test';

import { narrowSections, pageDatesAreCreationDates } from '../dist/notes.js';

/**
 * Microsoft returns each page's creation date in `lastModifiedDateTime` on some
 * storage clusters — 164 pages of 164 on the account where this was found, and
 * three independent public reports. It is not universal, not documented, and it
 * was fixed once in 2024 and came back. So the product has to decide per
 * account, at runtime, and heal itself when the fault goes away. See #122.
 */

const section = (last_modified) => ({ last_modified });
const page = (last_modified) => ({ last_modified });

test('a healthy account is not flagged', () => {
  // The section's timestamp equals its newest page: nothing contradicts.
  assert.equal(
    pageDatesAreCreationDates(
      [section('2026-08-20T10:00:00Z')],
      [[page('2026-08-20T10:00:00Z'), page('2026-08-01T09:00:00Z')]],
    ),
    false,
  );
});

/**
 * The measured signature: a section that changed minutes ago, and no page in it
 * admitting to a change in eleven days.
 */
test('a section newer than every page it holds is proof', () => {
  assert.equal(
    pageDatesAreCreationDates(
      [section('2026-08-28T15:13:02Z')],
      [[page('2026-08-17T11:04:42Z'), page('2026-08-17T11:00:00Z')]],
    ),
    true,
  );
});

test('one contradicting section is enough, however many are silent', () => {
  assert.equal(
    pageDatesAreCreationDates(
      [section('2026-08-01T00:00:00Z'), section('2026-08-28T15:00:00Z')],
      [[page('2026-08-01T00:00:00Z')], [page('2026-08-17T00:00:00Z')]],
    ),
    true,
  );
});

/**
 * The reason this is not a "are all pages frozen?" test.
 *
 * One public report describes an account where title edits propagate and body
 * edits do not. A frozen-ratio check would see genuine timestamps, call the
 * account healthy, and then silently miss every body edit — this bug wearing a
 * detector. The contradiction catches a partially broken field too.
 */
test('a partially working field is still caught', () => {
  const pages = [page('2026-08-25T00:00:00Z'), page('2026-08-01T00:00:00Z')];
  // A real modification date on one page, and still a section newer than both.
  assert.equal(pageDatesAreCreationDates([section('2026-08-28T00:00:00Z')], [pages]), true);
});

test('an empty section proves nothing either way', () => {
  assert.equal(pageDatesAreCreationDates([section('2026-08-28T00:00:00Z')], [[]]), false);
});

test('a section with no timestamp proves nothing', () => {
  assert.equal(
    pageDatesAreCreationDates([section(null)], [[page('2026-08-01T00:00:00Z')]]),
    false,
  );
});

test('pages with no timestamps at all are not read as a contradiction', () => {
  assert.equal(
    pageDatesAreCreationDates([section('2026-08-28T00:00:00Z')], [[page(null), page(null)]]),
    false,
  );
});

/**
 * Narrowing sections is the same contract as narrowing pages, including the
 * refusal to guess about a missing date.
 */
test('narrowSections keeps sections on or after the day named', () => {
  const sections = [
    { name: 'a', last_modified: '2026-08-28T15:00:00Z' },
    { name: 'b', last_modified: '2026-08-10T00:00:00Z' },
    { name: 'c', last_modified: '2026-08-01T00:00:00Z' },
  ];
  const { sections: kept } = narrowSections(sections, '2026-08-10');
  assert.deepEqual(
    kept.map((s) => s.name),
    ['a', 'b'],
    'the day named is inclusive',
  );
});

test('narrowSections without a window returns everything unchanged', () => {
  const sections = [{ last_modified: '2026-08-01T00:00:00Z' }];
  assert.deepEqual(narrowSections(sections, undefined).sections, sections);
});

test('a section with no date is reported, not guessed into the window', () => {
  const { sections: kept, undated } = narrowSections(
    [{ last_modified: null }, { last_modified: '2026-08-28T00:00:00Z' }],
    '2026-08-01',
  );
  assert.equal(kept.length, 1);
  assert.equal(undated, 1);
});

test('an unreadable since is refused rather than ignored', () => {
  assert.throws(() => narrowSections([{ last_modified: null }], 'last tuesday'), /Could not read/);
});
