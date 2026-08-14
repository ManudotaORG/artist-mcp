import assert from 'node:assert/strict';
import test from 'node:test';

import { GraphError, isStagingVersion } from '../dist/client.js';

/**
 * This file used to assert which edge-function endpoint a build called. There
 * is no endpoint any more — operations run on this machine — but the version
 * split survives, because it still decides which site serves client
 * configuration and an install must not cross the two.
 */
test('a staging build is identified by its version alone', () => {
  assert.equal(isStagingVersion('1.2.3'), false);
  assert.equal(isStagingVersion('1.2.4-staging.317'), true);
});

/**
 * The distinction the whole error surface turns on: a revoked token is the
 * user's to fix, and nothing else is. Advising a reconnect that cannot help
 * sends someone round a loop that never closes.
 */
test('GraphError carries whether reconnecting would help', () => {
  const expired = new GraphError('Token has been expired or revoked.', true);
  const ours = new GraphError('Gmail returned 500.', false);

  assert.equal(expired.reconnectNeeded, true);
  assert.equal(ours.reconnectNeeded, false);
  assert.equal(expired.name, 'GraphError');
  assert.ok(expired instanceof Error);
});
