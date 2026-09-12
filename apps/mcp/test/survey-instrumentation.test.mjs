import assert from 'node:assert/strict';
import test from 'node:test';

import { listNotes } from '../dist/notes.js';

/**
 * The measurement must exist for the runs that failed.
 *
 * A `map_notes` against a throttled account produced nineteen Graph 429s and
 * not one line of evidence about the survey: the listing throws before the
 * survey is reached, and a line placed after an await never runs when the
 * await rejects. So the only runs that logged anything were the ones where
 * nothing had gone wrong — which are not the runs anyone needs to see.
 */

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const withConsole = async (run) => {
  const original = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(String(line));
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return lines;
};

test('a listing that throws still reports what it cost', async () => {
  const lines = await withConsole(async () => {
    await assert.rejects(
      withFetch(
        async () => new Response('{"error":{"code":"20166"}}', { status: 429 }),
        () => listNotes('token'),
      ),
    );
  });

  const line = lines.find((l) => l.includes('list_notes'));
  assert.ok(line, `no list_notes line was logged; got ${JSON.stringify(lines)}`);
  assert.match(line, /elapsed=\d+ms/, 'the line carries no elapsed time');
  assert.match(line, /failed=/, 'a failed run was not marked as failed');
});

test('a listing that succeeds reports without a failure marker', async () => {
  const lines = await withConsole(async () => {
    await withFetch(
      async () => new Response(JSON.stringify({ value: [] }), { status: 200 }),
      () => listNotes('token'),
    );
  });

  const line = lines.find((l) => l.includes('list_notes'));
  assert.ok(line, 'no list_notes line was logged on a clean run');
  assert.equal(line.includes('failed='), false, `a clean run was marked failed: ${line}`);
});
