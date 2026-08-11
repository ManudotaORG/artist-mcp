import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerEntry } from '../dist/init.js';

test('creates the stable npm Claude entry by default', () => {
  assert.deepEqual(createServerEntry({ key: 'test-key' }), {
    command: 'npx',
    args: ['-y', '@manudota/artist-mcp'],
    env: { ARTIST_MCP_KEY: 'test-key' },
  });
});

test('creates an absolute Node entry for a local build', () => {
  const entry = createServerEntry({ key: 'test-key', local: true });

  assert.equal(entry.command, process.execPath);
  assert.equal(entry.args.length, 1);
  assert.match(entry.args[0], /\/apps\/mcp\/dist\/index\.js$/);
  assert.deepEqual(entry.env, { ARTIST_MCP_KEY: 'test-key' });
});
