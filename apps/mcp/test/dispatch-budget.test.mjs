import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchWith } from '../dist/dispatch.js';

/**
 * A hosted request's reads share one budget, and a read still running when it
 * is spent is reported as out of time rather than left for Vercel to end.
 *
 * On 2026-11-21 a hosted `map_notes` listed in 9 s and then logged nothing for
 * 51, until the function was ended at sixty and the caller saw "Internal
 * error". These hang the token lookup — the one step the dispatcher takes
 * before any tool work — and require an answer on time anyway.
 */

const hang = () => new Promise(() => {});
const noRecord = async () => {};
const pending = Symbol('pending');
const settledWithin = (promise, ms) =>
  Promise.race([promise.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r(pending), ms))]);

test('a read that outlives the budget is reported as out of time, naming it', async () => {
  const call = dispatchWith(hang, noRecord, { budgetMs: 100 });
  const started = Date.now();
  await assert.rejects(call('list_notebooks'), (err) => {
    assert.match(err.message, /list_notebooks ran out of time/);
    assert.match(err.message, /Nothing was changed/);
    return true;
  });
  assert.equal(Date.now() - started < 2_000, true, 'the budget did not cut the read');
});

test('the budget is the whole request, not each operation', async () => {
  // The first read spends most of it; the second gets only what is left.
  let first = true;
  const resolve = async () => {
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 150));
      throw new Error('first read done');
    }
    return hang();
  };
  const call = dispatchWith(resolve, noRecord, { budgetMs: 250 });
  await assert.rejects(call('list_notebooks'), /first read done/);
  const started = Date.now();
  await assert.rejects(call('list_notes'), /ran out of time/);
  assert.equal(Date.now() - started < 200, true, 'the second read was given a fresh budget');
});

test('a write is never cut off by the budget', async () => {
  // Abandoning a write that then lands would report a failure for a change
  // that happened, and invite a duplicate.
  const call = dispatchWith(hang, noRecord, { budgetMs: 50 });
  assert.equal(await settledWithin(call('create_calendar_event', {}), 300), pending);
});

test('without a budget nothing changes', async () => {
  const call = dispatchWith(hang, noRecord);
  assert.equal(await settledWithin(call('list_notebooks'), 300), pending);
});
