import assert from 'node:assert/strict';
import test from 'node:test';

import { getWithRetry } from '../dist/api.js';

/**
 * Throttling is the failure that hosting introduced. On one machine a fanout is
 * one user's burst and providers tolerate it; hosted, it is multiplied by the
 * number of concurrent callers and Microsoft throttles per user, not per
 * connection. Five concurrent list_notes calls against a real account produced
 * three 429s, which is what these exist to stop happening quietly.
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

const throttle = (headers = {}) =>
  new Response('{"error":{"code":"20166"}}', { status: 429, headers });

test('a 429 is retried, and Retry-After is what decides the wait', async () => {
  const waits = [];
  let calls = 0;
  const started = Date.now();

  await withFetch(
    async () => {
      calls += 1;
      waits.push(Date.now() - started);
      // One second, which is well under the ladder's own first step only
      // because the ladder is jittered — what matters is that it is obeyed.
      return calls === 1 ? throttle({ 'retry-after': '1' }) : new Response('{}', { status: 200 });
    },
    () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
  );

  assert.equal(calls, 2, 'the throttled request was not retried');
  assert.ok(waits[1] >= 900, `waited ${waits[1]}ms, ignoring Retry-After`);
});

test('an HTTP-date Retry-After is understood, not treated as zero', async () => {
  let calls = 0;
  const started = Date.now();
  // Two seconds, not one: toUTCString truncates to whole seconds, so a date
  // built from now + 1000ms can land as little as ~1ms ahead depending on where
  // in the current second the clock happens to be. The assertion below allows
  // for that same truncation rather than assuming the full interval survives.
  await withFetch(
    async () => {
      calls += 1;
      return calls === 1
        ? throttle({ 'retry-after': new Date(Date.now() + 2000).toUTCString() })
        : new Response('{}', { status: 200 });
    },
    () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
  );
  assert.equal(calls, 2);
  assert.ok(Date.now() - started >= 800, 'a dated Retry-After was not waited out');
});

test('throttling gets more attempts than the old two-step ladder', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return throttle({ 'retry-after': '0' });
    },
    async () => {
      await assert.rejects(() => getWithRetry('https://example.test/x', 't', 'Gmail'), /rate limit/i);
    },
  );
  assert.equal(calls, 4, 'expected three retries after the first attempt');
});

test('a persistent 429 says to wait, rather than reading as a fault', async () => {
  await withFetch(
    async () => throttle({ 'retry-after': '0' }),
    async () => {
      await assert.rejects(
        () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
        (err) => {
          assert.match(err.message, /rate limiting/i);
          // Waiting fixes it, so it must not send anyone to reconnect.
          assert.equal(err.reconnectNeeded, false);
          return true;
        },
      );
    },
  );
});

test('a 4xx that is not throttling is still not retried', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return new Response('{"error":"nope"}', { status: 404 });
    },
    async () => {
      await assert.rejects(() => getWithRetry('https://example.test/x', 't', 'Gmail'));
    },
  );
  assert.equal(calls, 1);
});

test('waiting is bounded, so a hosted request fails fast instead of timing out', async () => {
  let calls = 0;
  const started = Date.now();

  await withFetch(
    async () => {
      calls += 1;
      // Thirty seconds, which is what a genuinely throttled account asks for.
      return throttle({ 'retry-after': '30' });
    },
    async () => {
      await assert.rejects(
        () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
        /rate limiting/i,
      );
    },
  );

  const elapsed = Date.now() - started;
  assert.equal(calls, 1, 'asked again after being told to wait longer than the budget');
  assert.ok(elapsed < 1000, `spent ${elapsed}ms waiting; the whole point is not to`);
});

test('a short Retry-After is still honoured within the budget', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return calls === 1
        ? throttle({ 'retry-after': '1' })
        : new Response('{}', { status: 200 });
    },
    () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
  );
  assert.equal(calls, 2, 'a one-second wait fits the budget and should have been taken');
});

test('a busy service is not reported as this account being rate limited', async () => {
  await withFetch(
    async () =>
      new Response('{"error":{"code":"10007","message":"The server is too busy"}}', {
        status: 429,
        headers: { 'retry-after': '0' },
      }),
    async () => {
      await assert.rejects(
        () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
        (err) => {
          // 10007 is the service, not the caller. Saying "your account is being
          // rate limited" sends someone looking for a fault that is not theirs.
          assert.match(err.message, /busy and is refusing requests/i);
          assert.doesNotMatch(err.message, /rate limiting this account/i);
          return true;
        },
      );
    },
  );
});

test('a per-user throttle still names the account', async () => {
  await withFetch(
    async () => throttle({ 'retry-after': '0' }),
    async () => {
      await assert.rejects(
        () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
        /rate limiting this account/i,
      );
    },
  );
});

test('the provider’s own wait is quoted, not our willingness to wait', async () => {
  await withFetch(
    // Five minutes: far past both the sleep cap and the budget, and exactly the
    // case where "wait a moment" would be a lie.
    async () => throttle({ 'retry-after': '300' }),
    async () => {
      await assert.rejects(
        () => getWithRetry('https://example.test/x', 't', 'Microsoft Graph'),
        (err) => {
          assert.match(err.message, /try again in about 5 minutes/i);
          assert.doesNotMatch(err.message, /wait a moment/i);
          return true;
        },
      );
    },
  );
});

test('without Retry-After it does not invent a number', async () => {
  await withFetch(
    async () => throttle(),
    async () => {
      await assert.rejects(
        () => getWithRetry('https://example.test/x', 't', 'Gmail'),
        (err) => {
          assert.match(err.message, /wait a moment/i);
          assert.doesNotMatch(err.message, /try again in about/i);
          return true;
        },
      );
    },
  );
});
