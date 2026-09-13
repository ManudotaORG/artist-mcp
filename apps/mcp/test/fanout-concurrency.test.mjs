import assert from 'node:assert/strict';
import test from 'node:test';

import { FANOUT_LIMIT, mapWithConcurrency } from '../dist/api.js';
import { mapNotes } from '../dist/notes.js';
import { withGraphBatch } from './support/graph-batch.mjs';

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
  globalThis.fetch = withGraphBatch(impl);
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

/**
 * A survey used to be one Graph request per page, bounded by FANOUT_LIMIT.
 * Previews now travel as `$batch` round trips of up to twenty, which is what
 * brought a 56-section walk from sixty seconds to under ten. What must still
 * hold is the property this test was written for: forty pages are not forty
 * simultaneous requests to Graph.
 */
test('surveying a large notebook does not open a request per page', async () => {
  const pages = Array.from({ length: 40 }, (_, i) => ({
    id: `page-${i}`,
    title: `Page ${i}`,
    section: 'Concerts',
    notebook: 'My Notebook',
    last_modified: null,
  }));

  let roundTrips = 0;
  let live = 0;
  let peak = 0;
  let previews = 0;

  const inner = withGraphBatch(async () => {
    previews += 1;
    return new Response(JSON.stringify({ previewText: PREVIEW }), { status: 200 });
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    roundTrips += 1;
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 2));
    try {
      return await inner(url, init);
    } finally {
      live -= 1;
    }
  };
  let sketches;
  try {
    ({ sketches } = await mapNotes('token', pages));
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(previews, 40, 'a page was skipped or read twice');
  assert.equal(sketches.length, 40);
  // Asserted against literals, not against the constants that produced them:
  // comparing an observation to its own cause passes for any value.
  assert.equal(roundTrips <= 2, true, `${roundTrips} round trips for 40 pages`);
  assert.equal(peak <= 3, true, `peaked at ${peak} concurrent Graph requests`);
  assert.equal(
    Number.isInteger(FANOUT_LIMIT) && FANOUT_LIMIT <= 8,
    true,
    `FANOUT_LIMIT is ${FANOUT_LIMIT}, which does not bound a fanout`,
  );
});

/**
 * Failure inside a batch is per request. A 429 for one listing is retried in a
 * later batch; a request that keeps failing comes back as its own error, and
 * neither case is reported as a success or spills onto its neighbours.
 */
test('a throttled request inside a batch is retried, and a persistent failure stays its own', async () => {
  const { graphBatchGet } = await import('../dist/api.js');
  let throttledOnce = false;
  const original = globalThis.fetch;
  globalThis.fetch = withGraphBatch(async (url) => {
    const u = String(url);
    if (u.includes('/pages/slow/preview') && !throttledOnce) {
      throttledOnce = true;
      return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
    }
    if (u.includes('/pages/broken/preview')) return new Response('{"error":"nope"}', { status: 404 });
    return new Response(JSON.stringify({ previewText: 'fine' }), { status: 200 });
  });
  try {
    const [slow, broken, fine] = await graphBatchGet(
      ['/me/onenote/pages/slow/preview', '/me/onenote/pages/broken/preview', '/me/onenote/pages/fine/preview'],
      't',
    );
    assert.deepEqual(slow, { ok: true, body: { previewText: 'fine' } });
    assert.equal(broken.ok, false);
    assert.match(broken.error, /404/);
    assert.deepEqual(fine, { ok: true, body: { previewText: 'fine' } });
  } finally {
    globalThis.fetch = original;
  }
});
