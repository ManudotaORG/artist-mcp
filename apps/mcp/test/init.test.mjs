import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { createServerEntry, packageSpec } from '../dist/init.js';
import { isStagingVersion } from '../dist/client.js';

test('registers the dist-tag matching the running build', () => {
  assert.equal(packageSpec('1.2.3'), '@manudota/artist-mcp');
  assert.equal(packageSpec('1.2.4-staging.317'), '@manudota/artist-mcp@staging');
});

test('creates the stable npm Claude entry by default', () => {
  assert.deepEqual(createServerEntry({ version: '1.2.3' }), {
    command: 'npx',
    args: ['-y', '@manudota/artist-mcp'],
  });
});

test('a staging build registers itself as staging', () => {
  assert.deepEqual(createServerEntry({ version: '1.2.4-staging.317' }), {
    command: 'npx',
    args: ['-y', '@manudota/artist-mcp@staging'],
  });
});

/**
 * The path has to be recorded here because there is nowhere else to learn it:
 * Claude Desktop spawns the server with no cwd worth trusting, so a relative
 * path would resolve against something arbitrary on every restart.
 */
test('a playbook directory is recorded in the entry as an absolute path', () => {
  const entry = createServerEntry({ version: '1.2.3', agentsDir: 'playbooks' });
  assert.equal(entry.args[0], '-y');
  assert.equal(entry.args[1], '@manudota/artist-mcp');
  assert.equal(entry.args[2], '--agents');
  assert.equal(entry.args[3], resolve('playbooks'));
});

test('a local build carries the playbook directory too', () => {
  const entry = createServerEntry({ local: true, agentsDir: '/tmp/playbooks' });
  assert.deepEqual(entry.args.slice(1), ['--agents', '/tmp/playbooks']);
});

test('no playbook directory means no flag at all, not an empty one', () => {
  assert.deepEqual(createServerEntry({ version: '1.2.3' }).args, [
    '-y',
    '@manudota/artist-mcp',
  ]);
});

/**
 * The entry used to carry the connection key in plaintext, inside a file other
 * tools read and back up. Credentials live in the token store now, and an entry
 * that reintroduced an env block would put one back there unnoticed.
 */
test('the Claude entry carries no credentials at all', () => {
  for (const entry of [createServerEntry(), createServerEntry({ local: true })]) {
    assert.equal(entry.env, undefined);
    assert.deepEqual(Object.keys(entry).sort(), ['args', 'command']);
    assert.doesNotMatch(JSON.stringify(entry), /KEY|TOKEN|SECRET/i);
  }
});

/**
 * The original regression: init verified a key against one environment and
 * registered an entry resolving to the other, so a valid staging key was
 * reported invalid on every restart. There is no key or endpoint now, but the
 * same split still decides which site serves client configuration, so the spec
 * and that judgement must not disagree.
 */
test('the registered spec and the environment judgement agree', () => {
  for (const version of ['1.2.3', '1.2.4-staging.317']) {
    assert.equal(packageSpec(version).endsWith('@staging'), isStagingVersion(version), version);
  }
});

test('creates an absolute Node entry for a local build', () => {
  const entry = createServerEntry({ local: true });

  assert.equal(entry.command, process.execPath);
  assert.equal(entry.args.length, 1);
  assert.match(entry.args[0], /\/apps\/mcp\/dist\/index\.js$/);
});
