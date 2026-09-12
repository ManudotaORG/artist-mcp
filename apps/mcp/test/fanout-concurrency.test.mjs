import assert from 'node:assert/strict';
import test from 'node:test';

import { FANOUT_LIMIT, mapWithConcurrency } from '../dist/api.js';
import { mapNotes } from '../dist/notes.js';

/**
 * The cap exists because of a real outage shape, not a tidiness preference.
 *
 * Hosted logs showed forty `Microsoft Graph 429 attempt=1 waited=0s` lines in
 * the same millisecond: a survey of a forty-page notebook opened forty Graph
 * requests at once, every one was refused on arrival, and each then burned the
 * eight-second throttle budget retrying against congestion it had caused. The
 * retry ladder cannot fix that — by the time it runs, the burst has happened.
 *
 * So what these assert is the burst, not the total. A version that paces
 * requests and a version that does not both finish and both return every page;
 * only one of them is survivable, and the difference is visible solely in how
 * many calls are in flight at the peak.
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

/** A preview long enough to clear PREVIEW_FLOOR, so no page falls back to a full read. */
const PREVIEW = 'x'.repeat(80);

test('mapWithConcurrency keeps order and never exceeds the limit', async () => {
  let live = 0;
  let peak = 0;

  const out = await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 4, async (n) => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 1));
    live -= 1;
    return n * 2;
  });

  assert.equal(peak <= 4, true, `peaked at ${peak} concurrent, limit was 4`);
  assert.deepEqual(out.slice(0, 4), [0, 2, 4, 6], 'results came back out of order');
  assert.equal(out.length, 50);
});

test('a rejection still rejects the whole call, as Promise.all did', async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});

test('surveying a large notebook does not open a request per page', async () => {
  const pages = Array.from({ length: 40 }, (_, i) => ({
    id: `page-${i}`,
    title: `Page ${i}`,
    section: 'Concerts',
    notebook: 'My Notebook',
    last_modified: null,
  }));

  let live = 0;
  let peak = 0;
  let calls = 0;

  const { sketches } = await withFetch(
    async () => {
      live += 1;
      peak = Math.max(peak, live);
      calls += 1;
      await new Promise((r) => setTimeout(r, 2));
      live -= 1;
      return new Response(JSON.stringify({ previewText: PREVIEW }), { status: 200 });
    },
    () => mapNotes('token', pages),
  );

  assert.equal(calls, 40, 'a page was skipped or read twice');
  assert.equal(sketches.length, 40);

  // Asserted against a literal, not against FANOUT_LIMIT. Comparing the
  // observed peak to the constant that produced it passes for any value of
  // that constant, including one that caps nothing — which is exactly the
  // regression this test is here to catch.
  assert.equal(peak <= 8, true, `peaked at ${peak} concurrent Graph requests`);
  assert.equal(
    Number.isInteger(FANOUT_LIMIT) && FANOUT_LIMIT <= 8,
    true,
    `FANOUT_LIMIT is ${FANOUT_LIMIT}, which does not bound a fanout`,
  );
});
