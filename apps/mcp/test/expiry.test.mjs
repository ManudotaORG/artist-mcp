import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expiryAtConnect,
  expiryNotice,
  expiryState,
  explainRefreshFailure,
  reconnectCommand,
} from '../dist/expiry.js';

/**
 * The reason for a fixed clock rather than `new Date()`: every assertion here
 * is about a boundary, and a suite that passes on a Tuesday is not a test.
 */
const at = (iso) => new Date(iso);

const connection = (expiresAt) => ({
  refreshToken: 'r',
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
  connectedAt: '2026-08-14T09:00:00.000Z',
  ...(expiresAt === undefined ? {} : { expiresAt }),
});

test('a connection with no stated limit reports none', () => {
  assert.equal(expiryState(connection(), at('2030-01-01T00:00:00Z')).kind, 'unlimited');
  assert.equal(expiryNotice('google', connection(), at('2030-01-01T00:00:00Z')), undefined);
});

test('a stored expiry that will not parse is treated as no limit, never as expired', () => {
  // The direction matters: a connection wrongly declared dead is worse than a
  // missing warning, because the second one still works.
  assert.equal(expiryState(connection('not a date'), at('2026-08-20T00:00:00Z')).kind, 'unlimited');
});

test('days left round away from zero, so a live connection never reads as zero days', () => {
  const state = expiryState(connection('2026-08-21T09:00:00.000Z'), at('2026-08-20T22:00:00Z'));
  assert.equal(state.kind, 'valid');
  assert.equal(state.daysLeft, 1);
});

test('the notice stays silent until the limit is close', () => {
  const tokens = connection('2026-08-21T09:00:00.000Z');
  // Five days out: nothing, or the line becomes furniture and is not read on
  // the day it matters.
  assert.equal(expiryNotice('google', tokens, at('2026-08-16T09:00:00Z')), undefined);

  const soon = expiryNotice('google', tokens, at('2026-08-20T09:00:00Z'));
  assert.match(soon, /expires in 1 day\./);
  assert.match(soon, /artist-mcp connect google/);
});

test('a lapsed connection says so, and says the one command that fixes it', () => {
  const notice = expiryNotice('google', connection('2026-08-21T09:00:00.000Z'), at('2026-08-24T09:00:00Z'));
  assert.match(notice, /LAPSED 3 days ago/);
  assert.match(notice, /artist-mcp connect google/);
});

test('elapsed time rounds down, so a partial day is never counted as a whole one', () => {
  // Two days and three hours dead. Saying "3 days ago" overstates it, in the
  // one place the user came to check the facts.
  const notice = expiryNotice('google', connection('2026-08-21T09:00:00.000Z'), at('2026-08-23T12:00:00Z'));
  assert.match(notice, /LAPSED 2 days ago/);
});

test('a connection that lapsed hours ago says today, not zero days', () => {
  const notice = expiryNotice('google', connection('2026-08-21T09:00:00.000Z'), at('2026-08-21T14:00:00Z'));
  assert.match(notice, /LAPSED today/);
  assert.doesNotMatch(notice, /0 days/);
});

test('connect-time notice names the date and calls it a limit, not a fault', () => {
  const said = expiryAtConnect('google', '2026-08-21T09:00:00.000Z', at('2026-08-14T09:00:00Z'));
  assert.match(said, /lapses in 7 days/);
  assert.match(said, /2026-08-21/);
  assert.match(said, /not a fault/);
  assert.match(said, /artist-mcp connect google/);
});

test('no stated limit means nothing is said at connect time', () => {
  assert.equal(expiryAtConnect('google', undefined), undefined);
});

test('a failure past the limit is read as the scheduled expiry', () => {
  const said = explainRefreshFailure('google', connection('2026-08-21T09:00:00.000Z'), at('2026-08-22T09:00:00Z'));
  assert.match(said, /expired on schedule/);
  // Worded as inference. Google says "expired or revoked" for both cases, so
  // claiming it told us which would be putting words in the provider's mouth.
  assert.match(said, /most likely/);
  assert.match(said, /artist-mcp connect google/);
});

test('a failure before the limit is read as a withdrawal, and points at the account page', () => {
  const said = explainRefreshFailure('google', connection('2026-08-21T09:00:00.000Z'), at('2026-08-17T09:00:00Z'));
  assert.match(said, /something withdrew it/);
  assert.match(said, /myaccount\.google\.com\/connections/);
  assert.doesNotMatch(said, /expired on schedule/);
});

test('with no stated limit the failure claims no cause at all, only the remedy', () => {
  const said = explainRefreshFailure('microsoft', connection(), at('2026-08-17T09:00:00Z'));
  assert.equal(said, 'Reconnect with: artist-mcp connect microsoft');
});

test('the remedy is one command per provider', () => {
  assert.equal(reconnectCommand('google'), 'artist-mcp connect google');
  assert.equal(reconnectCommand('microsoft'), 'artist-mcp connect microsoft');
});
