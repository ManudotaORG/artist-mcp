import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDisconnect, runStatus } from '../dist/connect.js';
import { readProvider, saveProvider } from '../dist/tokens.js';

/** Captures console output so the user-facing wording can be asserted. */
const capture = async (body) => {
  const lines = [];
  const real = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await body();
  } finally {
    console.log = real;
  }
  return lines.join('\n');
};

/**
 * Both the token store and the Claude Desktop config are pointed somewhere
 * temporary. `status` now reads the config, and a suite that read the real one
 * would report on the developer's own install — and pass or fail depending on
 * a machine it does not own.
 */
const withTempStore = async (body) => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-mcp-connect-'));
  process.env.ARTIST_MCP_TOKENS = join(dir, 'tokens.json');
  process.env.ARTIST_MCP_CONFIG = join(dir, 'claude_desktop_config.json');
  try {
    await body(dir);
  } finally {
    delete process.env.ARTIST_MCP_TOKENS;
    delete process.env.ARTIST_MCP_CONFIG;
  }
};

/** Write the Claude Desktop entry `init` would have written. */
const withEntry = async (entry) =>
  writeFile(
    process.env.ARTIST_MCP_CONFIG,
    JSON.stringify({ mcpServers: { 'artist-notes': entry } }),
    'utf8',
  );

const sample = {
  refreshToken: 'refresh-one',
  scope: 'offline_access Notes.Read',
  connectedAt: '2026-08-14T09:30:00.000Z',
};

test('status points at the command to run when nothing is connected', async () => {
  await withTempStore(async () => {
    const out = await capture(runStatus);
    assert.match(out, /artist-mcp connect/);
  });
});

test('status reports each provider separately', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);

    const out = await capture(runStatus);
    assert.match(out, /Microsoft\s+connected 2026-08-14/);
    assert.match(out, /Google\s+not connected/);
  });
});

test('an unknown provider is refused before anything is touched', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);

    await assert.rejects(() => runDisconnect('gmail'), /Unknown provider "gmail"/);
    assert.notEqual(await readProvider('microsoft'), undefined);
  });
});

test('disconnecting one provider leaves the other connected', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);
    await saveProvider('google', { ...sample, refreshToken: 'google-one' });

    await capture(() => runDisconnect('google'));

    assert.equal(await readProvider('google'), undefined);
    assert.notEqual(await readProvider('microsoft'), undefined);
  });
});

/**
 * Removing the token stops this machine using the connection; it does not
 * revoke the grant. Implying otherwise would leave someone believing they had
 * withdrawn an access they had not.
 */
test('disconnect says the grant still exists at the provider', async () => {
  await withTempStore(async () => {
    await saveProvider('google', sample);

    const out = await capture(() => runDisconnect('google'));
    assert.match(out, /still exists in your Google account/);
  });
});

/**
 * The failure these cover is silent: the server starts, both providers report
 * connected, and the install looks healthy until every workflow tool fails
 * naming a directory the user has forgotten about. Renaming
 * ~/artist-playbooks to ~/artist-mcp produced exactly that.
 */
test('a moved local build is named, with the command that fixes it', async () => {
  await withTempStore(async (dir) => {
    await withEntry({ command: '/usr/bin/node', args: [join(dir, 'gone', 'index.js')] });

    const out = await capture(runStatus);
    assert.match(out, /MISSING/);
    assert.match(out, /gone/);
    assert.match(out, /artist-mcp init --local/);
  });
});

test('a playbook directory that no longer holds a pack is reported, not passed over', async () => {
  await withTempStore(async (dir) => {
    const missing = join(dir, 'renamed-away');
    await withEntry({ command: 'npx', args: ['-y', '@manudota/artist-mcp', '--agents', missing] });

    const out = await capture(runStatus);
    assert.match(out, /UNREADABLE/);
    assert.match(out, /renamed-away/);
  });
});

test('a healthy published install stays short and says which build it is', async () => {
  await withTempStore(async () => {
    await withEntry({ command: 'npx', args: ['-y', '@manudota/artist-mcp'] });

    const out = await capture(runStatus);
    assert.match(out, /published package/);
    assert.match(out, /shipped, checksummed/);
    // Two install lines at most; a report nobody reads diagnoses nothing.
    assert.ok(out.split('\n').length <= 4, out);
  });
});

/**
 * A local and a published entry are indistinguishable from inside a chat, and
 * they fail identically when crossed, so status has to say which is registered.
 */
test('a local build is distinguished from a published one', async () => {
  await withTempStore(async (dir) => {
    const build = join(dir, 'index.js');
    await writeFile(build, '', 'utf8');
    await withEntry({ command: '/usr/bin/node', args: [build] });

    const out = await capture(runStatus);
    assert.match(out, /local build/);
    assert.doesNotMatch(out, /MISSING/);
  });
});

test('a missing entry sends the user to init rather than reporting connections only', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);

    const out = await capture(runStatus);
    assert.match(out, /no "artist-notes" entry/);
    assert.match(out, /artist-mcp init/);
    // The connection lines still print: the install is the extra check, not a
    // replacement for what status already said.
    assert.match(out, /Microsoft\s+connected/);
  });
});

test('an unreadable config is not reported as an absent one', async () => {
  await withTempStore(async () => {
    await writeFile(process.env.ARTIST_MCP_CONFIG, '{ not json', 'utf8');

    const out = await capture(runStatus);
    assert.match(out, /config unreadable/);
    assert.doesNotMatch(out, /Run: artist-mcp init/);
  });
});
