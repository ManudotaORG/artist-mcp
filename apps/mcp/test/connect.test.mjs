import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
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

const withTempStore = async (body) => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-mcp-connect-'));
  process.env.ARTIST_MCP_TOKENS = join(dir, 'tokens.json');
  try {
    await body();
  } finally {
    delete process.env.ARTIST_MCP_TOKENS;
  }
};

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
