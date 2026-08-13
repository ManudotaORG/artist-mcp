import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerEntry, packageSpec } from '../dist/init.js';
import { defaultEndpoint } from '../dist/client.js';

test('registers the dist-tag matching the running build', () => {
  assert.equal(packageSpec('1.2.3'), '@manudota/artist-mcp');
  assert.equal(packageSpec('1.2.4-staging.317'), '@manudota/artist-mcp@staging');
});

test('creates the stable npm Claude entry by default', () => {
  assert.deepEqual(createServerEntry({ key: 'test-key', version: '1.2.3' }), {
    command: 'npx',
    args: ['-y', '@manudota/artist-mcp'],
    env: { ARTIST_MCP_KEY: 'test-key' },
  });
});

test('a staging build registers itself as staging', () => {
  assert.deepEqual(createServerEntry({ key: 'test-key', version: '1.2.4-staging.317' }), {
    command: 'npx',
    args: ['-y', '@manudota/artist-mcp@staging'],
    env: { ARTIST_MCP_KEY: 'test-key' },
  });
});

// The regression: init verified the key against one environment and then wrote
// an entry that resolved to the other, so a valid staging key was reported as
// invalid on every restart. The spec and the endpoint must agree.
test('the registered spec and the verified endpoint agree', () => {
  for (const version of ['1.2.3', '1.2.4-staging.317']) {
    const staging = defaultEndpoint(version).includes('cakkwvxwlkdfzqjbvrpa');
    assert.equal(packageSpec(version).endsWith('@staging'), staging, version);
  }
});

test('creates an absolute Node entry for a local build', () => {
  const entry = createServerEntry({ key: 'test-key', local: true });

  assert.equal(entry.command, process.execPath);
  assert.equal(entry.args.length, 1);
  assert.match(entry.args[0], /\/apps\/mcp\/dist\/index\.js$/);
  assert.deepEqual(entry.env, { ARTIST_MCP_KEY: 'test-key' });
});
