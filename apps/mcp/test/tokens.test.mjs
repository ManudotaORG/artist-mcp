import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearProvider,
  loadTokens,
  readProvider,
  saveProvider,
  tokensPath,
  updateRefreshToken,
} from '../dist/tokens.js';

/** Point the store at a throwaway directory so a test can never read or destroy real tokens. */
const withTempStore = async (body) => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-mcp-tokens-'));
  process.env.ARTIST_MCP_TOKENS = join(dir, 'nested', 'tokens.json');
  try {
    await body();
  } finally {
    delete process.env.ARTIST_MCP_TOKENS;
  }
};

const sample = {
  refreshToken: 'refresh-one',
  scope: 'Notes.Read offline_access',
  connectedAt: '2026-08-14T00:00:00.000Z',
};

test('a missing file is the not-yet-connected case, not an error', async () => {
  await withTempStore(async () => {
    assert.deepEqual(await loadTokens(), { version: 1, providers: {} });
    assert.equal(await readProvider('microsoft'), undefined);
  });
});

test('stores a provider and creates the directory it needs', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);
    assert.deepEqual(await readProvider('microsoft'), sample);
  });
});

test('the tokens file is not readable by other accounts', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);
    const mode = (await stat(tokensPath())).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
  });
});

test('providers are independent — disconnecting one leaves the other', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);
    await saveProvider('google', { ...sample, refreshToken: 'google-one' });

    await clearProvider('google');

    assert.deepEqual(await readProvider('microsoft'), sample);
    assert.equal(await readProvider('google'), undefined);
  });
});

/** Rotation runs on every Microsoft call, so it must not disturb what the user sees. */
test('rotation replaces the token and preserves the connection date', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);
    await updateRefreshToken('microsoft', 'refresh-two');

    assert.deepEqual(await readProvider('microsoft'), {
      ...sample,
      refreshToken: 'refresh-two',
    });
  });
});

test('refuses to rotate a provider that was never connected', async () => {
  await withTempStore(async () => {
    await assert.rejects(() => updateRefreshToken('microsoft', 'refresh-two'), /never|No stored/i);
  });
});

/** Starting fresh would read as "you were logged out" and hide the real damage. */
test('a corrupt file is reported rather than silently replaced', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);
    await writeFile(tokensPath(), '{ not json', 'utf8');

    await assert.rejects(() => loadTokens(), /not valid JSON/);

    // And it is still on disk, so it can be recovered by hand.
    assert.match(await readFile(tokensPath(), 'utf8'), /not json/);
  });
});

test('a file from a future version is refused rather than misread', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', sample);
    await writeFile(tokensPath(), JSON.stringify({ version: 2, providers: {} }), 'utf8');

    await assert.rejects(() => loadTokens(), /different version/);
  });
});
