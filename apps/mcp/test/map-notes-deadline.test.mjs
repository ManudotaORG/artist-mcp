import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_DEADLINE_MS, mapNotes } from '../dist/notes.js';
import { withGraphBatch } from './support/graph-batch.mjs';

/**
 * The survey must return something rather than nothing.
 *
 * Hosted dies at sixty seconds and the caller gets no answer at all — not even
 * the pages already sketched — so a chat client retries and buys three more
 * minutes of the same. Production logs showed exactly that: timeouts at
 * 15:02:17, 15:03:19 and 15:04:20, one per minute, all of the same survey.
 *
 * What these pin down is that the deadline is a floor on usefulness: pages that
 * were not reached come back counted and named as unsurveyed, never as empty,
 * because a page nobody looked at must not read as a page with nothing on it.
 */

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = withGraphBatch(impl);
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const PREVIEW = 'x'.repeat(80);
const ok = () => new Response(JSON.stringify({ previewText: PREVIEW }), { status: 200 });

const pagesOf = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `page-${i}`,
    title: `Page ${i}`,
    section: 'Concerts',
    notebook: 'My Notebook',
    last_modified: null,
  }));

test('a survey that fits the deadline reports nothing unreached', async () => {
  const { sketches, not_reached, elapsed_ms } = await withFetch(ok, () =>
    mapNotes('token', pagesOf(8)),
  );

  assert.equal(sketches.length, 8);
  assert.equal(not_reached, 0);
  assert.equal(typeof elapsed_ms, 'number');
});

test('the deadline returns the pages already sketched instead of nothing', async () => {
  // A clock the test drives, so the deadline is reached without spending it.
  // Previews go out sixty pages at a time (three batches of twenty), and the
  // deadline is checked before each group, so the unit it stops is a group.
  let clock = 0;
  const now = () => clock;

  let calls = 0;
  const batched = withGraphBatch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ previewText: PREVIEW }), { status: 200 });
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // Every round trip costs three seconds of the notional clock; the deadline is five.
    clock += 3_000;
    return batched(url, init);
  };
  let result;
  try {
    result = await mapNotes('token', pagesOf(130), { deadlineMs: 5_000, now });
  } finally {
    globalThis.fetch = original;
  }
  const { sketches, not_reached } = result;

  assert.equal(sketches.length > 0, true, 'the deadline returned nothing at all');
  assert.equal(sketches.length < 130, true, 'the deadline did not stop anything');
  assert.equal(
    sketches.length + not_reached,
    130,
    'pages went missing rather than being counted as unreached',
  );
  assert.equal(calls, sketches.length, 'a page was requested but not returned');
});

test('an unreached page is absent from the sketches, never a blank one', async () => {
  let clock = 0;
  const { sketches } = await withFetch(
    async () => {
      clock += 10_000;
      return ok();
    },
    () => mapNotes('token', pagesOf(20), { deadlineMs: 1, now: () => clock }),
  );

  // Whatever survived must be a real sketch. A page that was never fetched
  // appearing here with a null sketch would read as an empty page.
  for (const s of sketches) {
    assert.equal(s.sketch, PREVIEW, `${s.id} came back without content`);
    assert.equal(s.source, 'preview');
  }
});

test('the default deadline leaves room under the hosted 60s limit', async () => {
  assert.equal(MAP_DEADLINE_MS < 60_000, true, `${MAP_DEADLINE_MS}ms does not fit in 60s`);
});
