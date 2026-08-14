import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROVIDERS, accessTokenFor } from '../dist/oauth.js';
import { readProvider, saveProvider } from '../dist/tokens.js';

const withTempStore = async (body) => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-mcp-oauth-'));
  process.env.ARTIST_MCP_TOKENS = join(dir, 'tokens.json');
  const realFetch = globalThis.fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ARTIST_MCP_TOKENS;
  }
};

/** Stands in for the token endpoint, recording what was sent to it. */
const stubToken = (status, payload) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), form: Object.fromEntries(new URLSearchParams(init.body)) });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return calls;
};

const stored = {
  refreshToken: 'original',
  scope: 'offline_access Notes.Read',
  connectedAt: '2026-08-14T00:00:00.000Z',
};

test('offline_access is requested, or Microsoft returns no refresh token at all', () => {
  assert.match(PROVIDERS.microsoft.scope, /offline_access/);
});

test('Google asks for offline access and forces consent, or no refresh token comes back', () => {
  assert.equal(PROVIDERS.google.extraAuthParams.access_type, 'offline');
  assert.equal(PROVIDERS.google.extraAuthParams.prompt, 'consent');
});

/** Kept in step with the SCOPES list in the web app's Google route. */
test('Google asks for events only, not the whole calendar', () => {
  assert.match(PROVIDERS.google.scope, /calendar\.events\.readonly/);
  assert.doesNotMatch(PROVIDERS.google.scope, /auth\/calendar\.readonly/);
});

test('a rotated refresh token is stored before the access token is returned', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', stored);
    stubToken(200, { access_token: 'access-one', refresh_token: 'rotated' });

    const token = await accessTokenFor('microsoft');

    assert.equal(token, 'access-one');
    const after = await readProvider('microsoft');
    assert.equal(after.refreshToken, 'rotated');
    // Rotation must not disturb what the user sees about the connection.
    assert.equal(after.connectedAt, stored.connectedAt);
  });
});

/** Google returns no refresh token on an ordinary refresh and keeps the original valid. */
test('a reused refresh token is left alone', async () => {
  await withTempStore(async () => {
    await saveProvider('google', { ...stored, clientSecret: 'cached-secret' });
    stubToken(200, { access_token: 'access-two' });

    assert.equal(await accessTokenFor('google'), 'access-two');
    assert.equal((await readProvider('google')).refreshToken, 'original');
  });
});

test('an expired or revoked token asks for a reconnect', async () => {
  await withTempStore(async () => {
    await saveProvider('google', { ...stored, clientSecret: 'cached-secret' });
    stubToken(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });

    await assert.rejects(() => accessTokenFor('google'), (err) => {
      assert.equal(err.reconnectNeeded, true);
      assert.match(err.message, /expired or revoked/);
      return true;
    });
  });
});

/**
 * Anything that is not invalid_grant is ours or the provider's to fix. Telling
 * the user to reconnect there sends them round a loop that never closes.
 */
test('a server-side failure does not tell the user to reconnect', async () => {
  await withTempStore(async () => {
    // Cached, so this exercises the token exchange rather than the config fetch.
    await saveProvider('google', { ...stored, clientSecret: 'cached-secret' });
    const calls = stubToken(500, { error: 'internal_failure' });

    await assert.rejects(() => accessTokenFor('google'), (err) => {
      assert.equal(err.reconnectNeeded, false);
      return true;
    });

    assert.equal(calls[0].url, PROVIDERS.google.token);
  });
});

/**
 * Not shipped in the package: a live Google credential in a public tarball is
 * what Google's tooling objects to. It is fetched instead, and cached with the
 * tokens so a refresh does not depend on the web app being reachable.
 */
test('the Google client secret is never compiled into the package', async () => {
  const source = await readFile(new URL('../dist/oauth.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /GOCSPX-/, 'a Google client secret is present in the built output');
});

test('a cached client secret is used without calling the web app', async () => {
  await withTempStore(async () => {
    await saveProvider('google', { ...stored, clientSecret: 'cached-secret' });
    const calls = stubToken(200, { access_token: 'access-three' });

    assert.equal(await accessTokenFor('google'), 'access-three');

    // One call, to the token endpoint — the config endpoint was not consulted.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, PROVIDERS.google.token);
    assert.equal(calls[0].form.client_secret, 'cached-secret');
  });
});

/** An install made before the secret was cached must not need reconnecting. */
test('a connection stored without a secret fetches one rather than failing', async () => {
  await withTempStore(async () => {
    await saveProvider('google', stored);

    const seen = [];
    globalThis.fetch = async (url, init) => {
      seen.push(String(url));
      const payload = String(url).includes('/api/client-config')
        ? { google_client_secret: 'fetched-secret' }
        : { access_token: 'access-five' };
      if (init?.body) {
        seen.push(new URLSearchParams(init.body).get('client_secret'));
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    assert.equal(await accessTokenFor('google'), 'access-five');
    assert.match(seen[0], /\/api\/client-config$/);
    assert.equal(seen.at(-1), 'fetched-secret');

    // Written back, or this install would fetch it again on every refresh and
    // depend on the web app being reachable for as long as it existed.
    assert.equal((await readProvider('google')).clientSecret, 'fetched-secret');
  });
});

test('Microsoft never sends a client secret', async () => {
  await withTempStore(async () => {
    await saveProvider('microsoft', stored);
    const calls = stubToken(200, { access_token: 'access-four' });

    await accessTokenFor('microsoft');

    assert.equal(calls[0].form.client_secret, undefined);
  });
});

test('a provider that was never connected names the command that fixes it', async () => {
  await withTempStore(async () => {
    await assert.rejects(() => accessTokenFor('microsoft'), (err) => {
      assert.equal(err.reconnectNeeded, true);
      assert.match(err.message, /artist-mcp connect microsoft/);
      return true;
    });
  });
});
