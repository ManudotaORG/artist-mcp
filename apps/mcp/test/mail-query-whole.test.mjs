import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_QUERY_CHARS, listEmails } from '../dist/mail.js';

/**
 * A Gmail search is sent whole, or refused — never cut.
 *
 * It used to be sliced at 500 characters. The digest's search is an OR group
 * of a project's counterparts with `has:userlabels` and the date at the end, so
 * the slice removed the very terms that bounded it, and every message past the
 * cut stopped matching while the reply named the whole query. Found when a
 * three-week digest search on hosted came back with nothing at all.
 */

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const capture = () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  };
  return urls;
};

const digestQuery = (count) =>
  `{${Array.from({ length: count }, (_, i) => `from:counterpart${i}@example.org`).join(' ')} has:userlabels} after:2026/11/01`;

test('a long digest search reaches Gmail whole, its last terms included', async () => {
  const urls = capture();
  const query = digestQuery(40);
  assert.ok(query.length > 500 && query.length <= MAX_QUERY_CHARS, `fixture is ${query.length}`);
  await listEmails('token', query);
  const sent = new URL(urls[0]).searchParams.get('q');
  assert.equal(sent, query);
  assert.ok(sent.endsWith('has:userlabels} after:2026/11/01'));
});

test('a search over the limit is refused, says how to split it, and searches nothing', async () => {
  const urls = capture();
  const query = digestQuery(80);
  assert.ok(query.length > MAX_QUERY_CHARS);
  await assert.rejects(listEmails('token', query), /nothing was searched.*Split it into several searches/s);
  assert.deepEqual(urls, []);
});
