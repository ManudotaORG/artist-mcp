import assert from 'node:assert/strict';
import test from 'node:test';

import { formatReleaseNotes, parseReleaseBody } from './format-release-notes.mjs';

test('formats grouped release notes for Telegram HTML', () => {
  const [message] = formatReleaseNotes({
    title: 'v0.2.0',
    body: '## Features\n- Add artist roles (#12)\n## Bug Fixes\n- Fix OAuth loop (#14)',
    url: 'https://example.com/release',
  });

  assert.match(message, /artist-mcp v0\.2\.0/);
  assert.match(message, /✨ <b>Features<\/b>/);
  assert.match(message, /🛠 <b>Bug Fixes<\/b>/);
  assert.match(message, /View release/);
});

test('normalizes Release Please titles and commit links', () => {
  const [message] = formatReleaseNotes({
    title: 'artist-mcp: v0.2.0',
    body: '## Bug Fixes\n- Fix publishing ([315b229](https://example.com/commit))',
  });

  assert.match(message, /<b>artist-mcp v0\.2\.0<\/b>/);
  assert.match(message, /• Fix publishing/);
  assert.doesNotMatch(message, /315b229|example\.com\/commit/);
});

test('deduplicates equivalent release bullets', () => {
  const entries = parseReleaseBody(
    '## Features\n- Add agent installer (#12)\n- Add agent installer (#13)\n',
  );

  assert.equal(entries.length, 1);
});

test('escapes Telegram HTML', () => {
  const [message] = formatReleaseNotes({
    title: 'v0.2.0',
    body: '## Fixes\n- Handle <unsafe> & values',
  });

  assert.match(message, /&lt;unsafe&gt; &amp; values/);
});

test('rejects empty and overflow-placeholder notes', () => {
  assert.throws(() => parseReleaseBody(''));
  assert.throws(() => parseReleaseBody('Release notes were too long.'));
});

test('paginates long releases below Telegram limits', () => {
  const body = `## Features\n${Array.from(
    { length: 120 },
    (_, index) => `- Add independently useful artist workflow ${index}`,
  ).join('\n')}`;
  const messages = formatReleaseNotes({ title: 'v0.3.0', body });

  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 3900));
});
