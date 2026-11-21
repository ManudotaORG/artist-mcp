import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * OneNote allows 120 requests a minute per app per user and counts each request
 * inside a batch. Concurrency was capped in September; rate was not, and a
 * 221-page sweep on 2026-11-21 ran at about 127 a minute and drew 429s. These
 * pin the pacer that closes that gap — and, as much as the pacing, that it
 * keeps users apart: the hosted route serves many users from one process.
 */

// The default pacer reads its budget once, at import, so the env is set first
// and every import below is dynamic.
process.env.ARTIST_MCP_ONENOTE_PER_MINUTE = '3';
const { createPacer, MAX_PACE_WAIT_MS } = await import('../dist/pace.js');
const { graphGet, graphBatchGet, gmailGet } = await import('../dist/api.js');
const { GraphError } = await import('../dist/client.js');
const { dispatchWith } = await import('../dist/dispatch.js');

const fakeClock = () => {
  let t = 1_000_000;
  const slept = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
    slept,
  };
};

test('under the budget nothing waits', async () => {
  const clock = fakeClock();
  const pace = createPacer({ limit: 5, now: clock.now, sleep: clock.sleep });
  for (let i = 0; i < 5; i++) await pace('alice');
  assert.deepEqual(clock.slept, []);
});

test('over the budget a request waits for the oldest slot to leave the minute', async () => {
  const clock = fakeClock();
  const pace = createPacer({ limit: 3, windowMs: 10_000, maxWaitMs: 20_000, now: clock.now, sleep: clock.sleep });
  await pace('alice');
  clock.advance(2_000);
  await pace('alice');
  await pace('alice');
  await pace('alice');
  // The first stamp was 2 s before the others; it leaves the window 8 s later.
  assert.deepEqual(clock.slept, [8_000]);
});

test('one user spending the budget does not slow another', async () => {
  const clock = fakeClock();
  const pace = createPacer({ limit: 2, windowMs: 60_000, maxWaitMs: 1, now: clock.now, sleep: clock.sleep });
  await pace('alice-token');
  await pace('alice-token');
  await assert.rejects(pace('alice-token'), GraphError);
  await pace('bob-token');
  await pace('bob-token');
  assert.deepEqual(clock.slept, []);
});

test('a wait past the ceiling is refused with a sentence, and spends nothing', async () => {
  const clock = fakeClock();
  const pace = createPacer({ limit: 1, windowMs: 60_000, now: clock.now, sleep: clock.sleep });
  await pace('alice');
  const err = await pace('alice').then(() => null, (e) => e);
  assert.ok(err instanceof GraphError);
  assert.equal(err.reconnectNeeded, false);
  assert.match(err.message, /pacing OneNote requests/);
  assert.match(err.message, /Nothing was refused by Microsoft/);
  assert.deepEqual(clock.slept, []);
  // The refusal took no slot: once the minute passes, one request fits again.
  clock.advance(60_001);
  await pace('alice');
});

test('the ceiling is the throttle budget, not the hosted limit', () => {
  assert.ok(MAX_PACE_WAIT_MS <= 8_000);
});

test('a batch takes one slot per request inside it', async () => {
  const clock = fakeClock();
  const pace = createPacer({ limit: 20, windowMs: 60_000, maxWaitMs: 1, now: clock.now, sleep: clock.sleep });
  await pace('alice', 15);
  await pace('alice', 5);
  await assert.rejects(pace('alice', 1), GraphError);
});

// --- Through the real request paths, with the default pacer at 3 a minute ---

const stubFetch = () => {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push(String(url));
    if (String(url).endsWith('/$batch')) {
      const { requests } = JSON.parse(init.body);
      return new Response(JSON.stringify({ responses: requests.map((r) => ({ id: r.id, status: 200, body: { value: [] } })) }), { status: 200 });
    }
    return new Response('{"value":[]}', { status: 200 });
  };
  return seen;
};

test('OneNote reads and batches are paced; Gmail is not', async () => {
  const seen = stubFetch();
  await graphGet('/me/onenote/sections', 'carol');
  await graphBatchGet(['/me/onenote/sections/a/pages', '/me/onenote/sections/b/pages'], 'carol');
  // Three spent: one read, two inside the batch. The next waits about a minute.
  const err = await graphGet('/me/onenote/sections', 'carol').then(() => null, (e) => e);
  assert.match(String(err?.message), /pacing OneNote requests/);
  assert.equal(seen.length, 2, 'a paced request still reached Microsoft');

  // Another account on the same process is untouched, and so is Gmail.
  await graphGet('/me/onenote/sections', 'dave');
  for (let i = 0; i < 5; i++) await gmailGet('/users/me/messages', 'carol');
  assert.equal(seen.length, 8);
});

test('tokens bound to one key share one budget', async () => {
  const clock = fakeClock();
  const pace = createPacer({ limit: 2, maxWaitMs: 1, now: clock.now, sleep: clock.sleep });
  pace.bind('token-1', 'erin');
  pace.bind('token-2', 'erin');
  await pace('token-1');
  await pace('token-2');
  await assert.rejects(pace('token-1'), GraphError);
});

/**
 * The regression the live check found. `accessTokenFor` fetches a fresh access
 * token for every operation, so a pacer keyed on the token saw every operation
 * as a new user, and a 60-second window reached 133 requests. A resolver that
 * mints a new token per call is exactly that case.
 */
test('a dispatcher that gets a fresh token per operation is still paced as one user', async () => {
  stubFetch();
  let minted = 0;
  const freshEachTime = async () => `fresh-token-${++minted}`;
  const frank = dispatchWith(freshEachTime, async () => {}, { paceKey: 'frank' });
  await frank('list_notes');
  await frank('list_notes');
  await frank('list_notes');
  const err = await frank('list_notes').then(() => null, (e) => e);
  assert.match(String(err?.message), /pacing OneNote requests/);
  assert.equal(minted, 4, 'each operation did get its own token');

  // Another user on the same process, also minting tokens, is unaffected.
  const gina = dispatchWith(freshEachTime, async () => {}, { paceKey: 'gina' });
  await gina('list_notes');
});

test('a dispatcher with no key gets one of its own, never a shared one', async () => {
  stubFetch();
  let minted = 0;
  const fresh = async () => `anon-token-${++minted}`;
  const first = dispatchWith(fresh, async () => {});
  for (let i = 0; i < 3; i++) await first('list_notes');
  await assert.rejects(first('list_notes'), /pacing OneNote requests/);
  // A second keyless dispatcher is a separate budget, not the first one's.
  const second = dispatchWith(fresh, async () => {});
  await second('list_notes');
});
