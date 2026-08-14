#!/usr/bin/env node
/**
 * Spike: can the npm package complete OAuth as a public client — PKCE, loopback
 * redirect, no client secret — against Microsoft and Google?
 *
 * This is the question issue #22's comment says decides whether token custody
 * can move to the user's machine. Provider documentation says yes for both; the
 * point of this script is to establish it against the real consent screens,
 * because restricted-scope rules and consent configuration are where a
 * documented "yes" turns into a practical no.
 *
 * Three things have to hold, and the script fails loudly on each:
 *
 *   1. The code exchange succeeds with no client_secret.
 *   2. A refresh token comes back. Without it there is no unattended access
 *      and the whole design is pointless.
 *   3. That refresh token can itself be redeemed without a secret. This is the
 *      one that matters most — it is what an installed copy does every day
 *      after the browser is long gone.
 *
 * A live API call follows, so a token that is technically issued but scoped
 * uselessly does not read as success.
 *
 * Deliberately standalone: no imports from apps/mcp, no workspace deps, nothing
 * written to disk. It is a probe, not a prototype.
 *
 * Usage:
 *   SPIKE_MS_CLIENT_ID=...     node scripts/spike-pkce.mjs microsoft
 *   SPIKE_GOOGLE_CLIENT_ID=... node scripts/spike-pkce.mjs google
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.SPIKE_PORT ?? 8765);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const PROVIDERS = {
  microsoft: {
    label: 'Microsoft',
    clientIdEnv: 'SPIKE_MS_CLIENT_ID',
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // offline_access is what produces the refresh token at all. Notes.Read is
    // the scope the product actually ships with, so the spike tests the real
    // consent screen rather than an easier one.
    scope: 'offline_access Notes.Read',
    extraAuthParams: { response_mode: 'query' },
    probes: [
      {
        url: 'https://graph.microsoft.com/v1.0/me/onenote/sections?$top=1',
        describe: (body) => `${body.value?.length ?? 0} OneNote section(s) visible`,
      },
    ],
    registrationHint: [
      'Entra portal → App registrations → your app:',
      '  • Authentication → Add a platform → Mobile and desktop applications',
      `  • Custom redirect URI: ${REDIRECT_URI}`,
      '  • Advanced settings → Allow public client flows → Yes',
      'The existing web platform and its client secret can stay; an app',
      'registration may hold both, so the hosted sign-in flow is unaffected.',
    ],
  },
  google: {
    label: 'Google',
    clientIdEnv: 'SPIKE_GOOGLE_CLIENT_ID',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    // Both scopes the product actually requests, kept in step with the SCOPES
    // list in apps/web/src/app/api/auth/google/route.ts. Testing only Gmail
    // would leave the calendar half of the evidence layer unestablished, and
    // the two are not equivalent: gmail.readonly is restricted while
    // calendar.events.readonly is merely sensitive, so consent can plausibly
    // treat them differently.
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ].join(' '),
    // Google withholds the refresh token unless both are present, and returns
    // it only on first consent unless prompt=consent forces re-issue.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    probes: [
      {
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        describe: (body) => `mailbox ${body.emailAddress}, ${body.messagesTotal} message(s)`,
      },
      // A granted scope is not the same as a working one — Calendar is a
      // separate API that must also be enabled on the project, and that failure
      // surfaces here rather than at consent.
      {
        url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1',
        describe: (body) => `calendar "${body.summary ?? 'primary'}" reachable`,
      },
    ],
    // Established 2026-08-14: Google rejects the exchange outright with
    // "client_secret is missing" for a Desktop client, so it is not a public
    // client in the RFC 8252 sense. The secretless types (Android, iOS, Chrome)
    // are the ones where the loopback redirect is deprecated, so no client type
    // offers both. Set SPIKE_GOOGLE_CLIENT_SECRET to carry on past step 1 and
    // test whether the remaining flow — refresh and a live call — holds with a
    // secret the package would have to ship publicly.
    clientSecretEnv: 'SPIKE_GOOGLE_CLIENT_SECRET',
    registrationHint: [
      'Google Cloud console → APIs & Services → Credentials:',
      '  • Create OAuth client ID → Application type: Desktop app',
      `  Loopback redirects are accepted without registering ${REDIRECT_URI}.`,
      '',
      '  Google requires the desktop client secret even though its own docs say',
      '  such apps "cannot keep secrets". Pass it to test the rest of the flow:',
      '    SPIKE_GOOGLE_CLIENT_SECRET=... ',
    ],
  },
};

const die = (message) => {
  console.error(`\n  FAILED  ${message}\n`);
  process.exit(1);
};

/** RFC 7636 S256. base64url, no padding, verifier of 43–128 chars. */
const pkcePair = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

/**
 * Serves exactly one request and resolves with its query parameters. The
 * browser gets a plain page either way so the user is not left staring at a
 * connection error while the terminal reports success.
 */
const awaitCallback = (expectedState) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not here.');
        return;
      }

      const params = Object.fromEntries(url.searchParams);
      const ok = params.code && params.state === expectedState;

      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' });
      res.end(ok ? 'Authorised. Close this tab and return to the terminal.' : 'Authorisation failed.');

      server.close();

      if (params.error) {
        reject(new Error(`${params.error}: ${params.error_description ?? 'no description'}`));
      } else if (params.state !== expectedState) {
        // A mismatch means this response is not the one we asked for, so the
        // code in it is not ours to redeem.
        reject(new Error('state mismatch — discarding the response'));
      } else if (!params.code) {
        reject(new Error('no authorization code in the callback'));
      } else {
        resolve(params.code);
      }
    });

    server.on('error', (err) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`port ${PORT} is busy. Set SPIKE_PORT and re-register the redirect URI.`)
          : err,
      );
    });

    server.listen(PORT);
  });

/**
 * Posts a form to the token endpoint. Note what is absent: client_secret. Every
 * call in this script goes out without one, which is the entire experiment.
 */
const tokenRequest = async (provider, form) => {
  const res = await fetch(provider.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Both providers explain 4xx in the body, and the explanation is the whole
    // result of this spike when it fails — a bare status code would not say
    // whether the secret was the problem or the scope was.
    throw new Error(
      `${res.status} ${body.error ?? 'unknown'} — ${body.error_description ?? JSON.stringify(body)}`,
    );
  }

  return body;
};

const main = async () => {
  const name = process.argv[2];
  const provider = PROVIDERS[name];

  if (!provider) {
    console.error(`Usage: node scripts/spike-pkce.mjs <${Object.keys(PROVIDERS).join('|')}>`);
    process.exit(1);
  }

  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) {
    console.error(`\n${provider.label}: set ${provider.clientIdEnv} first.\n`);
    console.error(provider.registrationHint.join('\n'));
    console.error('');
    process.exit(1);
  }

  // Present only when the provider refuses a secretless exchange and we are
  // deliberately testing the fallback. Its presence is reported in every line
  // below, so a pass can never be mistaken for a public-client pass.
  const clientSecret = provider.clientSecretEnv ? process.env[provider.clientSecretEnv] : undefined;
  const secretForm = clientSecret ? { client_secret: clientSecret } : {};

  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');

  const authUrl = new URL(provider.authorize);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: provider.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthParams,
  }).toString();

  console.log(`\n${provider.label} public-client PKCE spike`);
  console.log(`redirect  ${REDIRECT_URI}`);
  console.log(`scope     ${provider.scope}`);
  console.log(
    clientSecret
      ? `secret    SENT — not a public-client result; testing the fallback\n`
      : `secret    none — sending client_id only\n`,
  );
  console.log('Open this and consent:\n');
  console.log(`  ${authUrl}\n`);

  const code = await awaitCallback(state).catch((err) => die(`callback: ${err.message}`));

  // 1. Authorization code for tokens, no secret.
  const first = await tokenRequest(provider, {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    ...secretForm,
  }).catch((err) => die(`code exchange ${clientSecret ? 'with' : 'without'} a secret: ${err.message}`));

  console.log(`  ok      code exchanged ${clientSecret ? 'WITH a shipped client_secret' : 'with no client_secret'}`);

  // 2. A refresh token, or there is no unattended access to move anywhere.
  if (!first.refresh_token) {
    die('no refresh token returned — unattended access is not possible for this client type');
  }
  console.log(`  ok      refresh token issued (${first.refresh_token.length} chars)`);
  console.log(`  note    granted scopes: ${first.scope ?? '(not reported)'}`);

  // 3. Redeem the refresh token, still with no secret. This is the daily path.
  const refreshed = await tokenRequest(provider, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: first.refresh_token,
    scope: provider.scope,
    ...secretForm,
  }).catch((err) => die(`refresh ${clientSecret ? 'with' : 'without'} a secret: ${err.message}`));

  console.log(`  ok      refresh token redeemed ${clientSecret ? 'WITH a shipped client_secret' : 'with no client_secret'}`);

  // Microsoft rotates on every use and Google does not. An installed copy has
  // to write the new one back or the connection dies on the *next* call, so the
  // spike reports which behaviour this provider shows rather than assuming.
  const rotated = Boolean(refreshed.refresh_token) && refreshed.refresh_token !== first.refresh_token;
  console.log(`  note    refresh token ${rotated ? 'ROTATED — the client must write it back' : 'reused'}`);

  // 4. Prove the access token actually reaches the data — every API the
  //    product uses, not just the first, so one working scope cannot stand in
  //    for the rest.
  for (const probe of provider.probes) {
    const res = await fetch(probe.url, {
      headers: { authorization: `Bearer ${refreshed.access_token}` },
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      die(`API call rejected the token: ${res.status} ${JSON.stringify(body)}`);
    }

    console.log(`  ok      live API call succeeded — ${probe.describe(body)}`);
  }
  console.log(
    clientSecret
      ? `\n${provider.label}: flow works, but only with a client_secret the package must ship publicly.\n`
      : `\n${provider.label}: viable as a public PKCE client.\n`,
  );
};

main().catch((err) => die(err.stack ?? err.message));
