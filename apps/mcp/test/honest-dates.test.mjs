import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFile(resolve(root, rel), 'utf8');

/**
 * These guard a claim the product is not entitled to make.
 *
 * `lastModifiedDateTime` on a OneNote page does not track edits: Microsoft is
 * returning the creation date in that field on some accounts, measured here as
 * 164 pages out of 164. So every surface that called the value a "modified"
 * date was asserting something it could not support — and the failure is silent,
 * because a wrong date looks exactly like a right one.
 *
 * The word is the whole point. "Dated" is true whichever the field holds;
 * "modified" is a claim about when someone last worked, which is precisely what
 * cannot be known. See #122.
 *
 * If one of these fails because the regression was fixed upstream: that is a
 * behaviour change, not a licence to edit the assertion. Confirm against a real
 * account first — it has been fixed once before, in 2024, and came back.
 */

test('no tool surface calls a page date a modified date', async () => {
  const server = await read('src/server.ts');

  // Named phrasings rather than the bare word. `last_modified` is the field's
  // own name and has to stay; the warning text has to say "modified" in order
  // to explain the problem. What is banned is presenting the value to a caller
  // AS a modification date.
  const BANNED = [
    '— modified ',
    'most recently modified',
    'no modified date',
    'modified on or after',
    'pages modified',
    'modified date. Takes',
  ];

  const offenders = BANNED.filter((phrase) => server.includes(phrase));
  assert.deepEqual(
    offenders,
    [],
    'A caller-visible string presents a page date as a modification date: ' +
      offenders.join(', '),
  );
});

/**
 * The narrower half. Saying "dated" is not enough on its own: a caller asking
 * "what changed this week" and getting nothing back will read that as "nothing
 * changed" unless told otherwise, which is the original bug surviving a rename.
 */
test('an empty since-window says it is not evidence that nothing changed', async () => {
  // Backticks, quotes and `+` removed as well as whitespace: these sentences
  // are split across concatenated literals, so the phrase being asserted does
  // not appear contiguously in the source.
  const server = (await read('src/server.ts')).replace(/[`"'+]/g, '').replace(/\s+/g, ' ');
  for (const marker of ['No pages in ${scope} dated on or after', 'No pages to map']) {
    const at = server.indexOf(marker.replace(/[`"'+]/g, ''));
    assert.notEqual(at, -1, `${marker} is gone — was the empty case reworded?`);
    assert.match(
      server.slice(at, at + 600),
      /not evidence that nothing changed/,
      `The empty result for "${marker}" does not warn that it proves nothing.`,
    );
  }
});

/**
 * The pack is executable policy, so a false rule there is worse than a false
 * tool string: it tells the session what to believe. This one instructed a
 * session to report the modified date "because it is what is true", and to
 * prefer it over the musician's own version marker.
 */
test('the intake policy does not claim the date records change', async () => {
  const intake = await read('agent-pack/.artist/policies/INTAKE.md');
  assert.doesNotMatch(
    intake,
    /the date records change/i,
    'INTAKE.md still tells sessions the modified date records change.',
  );
  assert.match(
    intake,
    /creation.{0,40}date|never as proof/i,
    'INTAKE.md no longer warns that the date may not be a modification date.',
  );
});
