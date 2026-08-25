/**
 * Getting and keeping provider credentials, without a server holding anything.
 *
 * Consent happens in the user's browser and the authorization code comes back
 * to a loopback listener that exists for the seconds it takes to catch it. The
 * refresh token then lives on this machine (see tokens.ts) and is exchanged for
 * access tokens here. No credential of the user's ever reaches a server of ours,
 * which is the entire point of the change — see #22.
 *
 * The two providers differ in the one way that has always mattered here, and
 * getting it backwards breaks exactly one of them, silently:
 *
 *   Microsoft rotates. Every exchange returns a new refresh token and kills the
 *   old one, so the replacement must be stored before it is used for anything.
 *   Miss that and the connection dies on the *next* call, far from the cause.
 *
 *   Google reuses. An ordinary refresh returns no refresh token at all and the
 *   original stays valid, so there is normally nothing to write back.
 *
 * Storing whatever comes back, before doing anything else with it, handles both
 * without branching on the provider — the same resolution the edge function
 * reached for the hosted design.
 *
 * Google needs a client secret even here. Its Desktop client type refuses the
 * exchange without one, while the client types that need no secret are the ones
 * where the loopback redirect is deprecated, so no client type offers both.
 * That secret ships in this package and is readable by anyone who installs it.
 * It is not a hole — PKCE is what binds the authorization code to this request,
 * and the secret adds no protection — but it is not a secret either, and the
 * documentation should not pretend otherwise. Established by
 * scripts/spike-pkce.mjs on 2026-08-14.
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { platform } from 'node:os';
import { type WriteCapability } from './grants.js';

import { GraphError, isStagingVersion, packageVersion } from './client.js';
import {
  type ProviderName,
  readProvider,
  saveProvider,
  updateClientSecret,
  updateRefreshToken,
} from './tokens.js';

/**
 * Fixed because Microsoft matches redirect URIs exactly, so the port is part of
 * what is registered and cannot be chosen at runtime. Google accepts any
 * loopback port, and takes this one for consistency.
 */
const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

/** How long to wait for the user to finish consenting before giving up. */
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

export type ProviderConfig = {
  readonly label: string;
  readonly authorize: string;
  readonly token: string;
  readonly scope: string;
  readonly clientId: string;
  /**
   * Google alone needs a client secret, and it is not compiled in — it is
   * fetched at connect time and cached with the tokens, so it is passed to the
   * exchange rather than being part of this static configuration.
   */
  readonly needsClientSecret: boolean;
  readonly extraAuthParams: Readonly<Record<string, string>>;
};

/**
 * Overridable so a development build can point at a separate app registration
 * without editing the source, matching how client.ts treats its endpoint.
 */
const env = (name: string, fallback: string): string => process.env[name] ?? fallback;

const PRODUCTION_SITE = 'https://artist-mcp.vercel.app';
const STAGING_SITE = 'https://artist-mcp-staging.vercel.app';

/**
 * Where Google's client secret comes from.
 *
 * It is not shipped in the package. The published tarball is public, and a live
 * Google credential sitting in it is something Google's own tooling objects to
 * finding — so the value is served from the web app instead, from an endpoint
 * that is deliberately open. That is not a downgrade: the value reaches every
 * user's machine either way, and PKCE is what actually binds the authorization
 * code. What it buys is a value that can be rotated without publishing a new
 * version and waiting for every install to upgrade.
 *
 * Matches the staging/production split client.ts makes from the package version,
 * so an install cannot fetch configuration from one environment while talking
 * to the other.
 */
const configEndpoint = (): string => {
  const site = process.env.ARTIST_MCP_SITE ?? (isStagingVersion(packageVersion) ? STAGING_SITE : PRODUCTION_SITE);
  return `${site}/api/client-config`;
};

/**
 * Fetched once and cached beside the tokens, because Google demands the secret
 * on every refresh — a connection that only works while our web app is up would
 * be a worse dependency than the one this whole change removes.
 */
const fetchGoogleClientSecret = async (): Promise<string> => {
  let res: Response;
  try {
    res = await fetch(configEndpoint());
  } catch (cause) {
    throw new GraphError(`Could not reach ${configEndpoint()} to set up Google: ${cause}`, false);
  }

  const body = (await res.json().catch(() => ({}))) as {
    google_client_secret?: string;
    error?: string;
  };

  if (!res.ok || typeof body.google_client_secret !== 'string') {
    throw new GraphError(
      `Could not get the Google client configuration: ${body.error ?? `HTTP ${res.status}`}`,
      false,
    );
  }

  return body.google_client_secret;
};

/**
 * The extra scope each granted write needs, on top of the read-only set.
 *
 * Kept out of `PROVIDERS.scope` on purpose: that list is what every user is
 * asked for, and a write scope belongs behind a grant rather than on everyone's
 * consent screen. `test/google-scopes` asserts exactly that.
 *
 * `calendar.events` is read and write over all events, including update and
 * delete, because Google publishes no insert-only Calendar scope — insert and
 * delete accept the identical four. The narrowing this cannot do at the
 * provider is done by the operation table instead. See
 * docs/decisions/0001-opt-in-calendar-writes.md.
 */
export const WRITE_SCOPES: Readonly<Record<WriteCapability, readonly string[]>> = {
  'calendar-create': ['https://www.googleapis.com/auth/calendar.events'],
  // The same scope, because Google has only one: events.insert and
  // events.delete accept the identical four. Granting delete after create
  // therefore needs no new consent screen at all, which is the one convenience
  // that follows from the scopes being this coarse.
  'calendar-delete': ['https://www.googleapis.com/auth/calendar.events'],
};

/**
 * What to ask consent for, given what this install was granted.
 *
 * Asked at connect time and never widened afterwards: a refresh token carries
 * the scopes it was granted with, so granting a write after connecting means
 * reconnecting, not a quieter upgrade.
 */
export const scopesFor = (
  provider: ProviderName,
  grants: readonly WriteCapability[] = [],
): string => {
  const base = PROVIDERS[provider].scope;
  if (provider !== 'google' || grants.length === 0) return base;
  const extra = grants.flatMap((name) => [...(WRITE_SCOPES[name] ?? [])]);
  return [...new Set([...base.split(' '), ...extra])].join(' ');
};

export const PROVIDERS: Readonly<Record<ProviderName, ProviderConfig>> = {
  microsoft: {
    label: 'Microsoft',
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // offline_access is not optional: without it Microsoft returns no refresh
    // token and the connection dies within the hour.
    scope: 'offline_access Notes.Read',
    clientId: env('ARTIST_MCP_MS_CLIENT_ID', '4e484257-2c48-4088-84b9-60ea3ca82e88'),
    needsClientSecret: false,
    extraAuthParams: { response_mode: 'query' },
  },
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    // Kept in step with GOOGLE_SCOPES in supabase/functions/graph/index.ts —
    // asserted by test/google-scopes, because the two have to agree and a
    // refresh asking for more than the grant carries is rejected.
    //
    // Events rather than the whole calendar: events are the evidence, and the
    // broader scope would also hand over metadata and sharing ACLs nothing
    // reads. calendarlist.readonly is the exception, and it is read-only: it
    // names which calendars exist, without which "the day as it stands" quietly
    // means "the day on primary" for anyone keeping gigs on a second calendar,
    // and we could not detect that one exists in order to say so. See
    // docs/decisions/0001-opt-in-calendar-writes.md.
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.events.readonly',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ].join(' '),
    clientId: env(
      'ARTIST_MCP_GOOGLE_CLIENT_ID',
      '993381632576-33o752gthtkehtcbhoe2djssi1kepm03.apps.googleusercontent.com',
    ),
    needsClientSecret: true,
    // Google's equivalent of offline_access. Without access_type=offline it
    // returns an access token and no refresh token; prompt=consent forces the
    // refresh token to be re-issued rather than only on the very first consent.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
};

/** RFC 7636 S256. */
const pkcePair = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/**
 * Best-effort. A browser that does not open is an inconvenience, not a failure —
 * the URL is printed either way and pasting it works identically.
 */
/**
 * How to hand a URL to the desktop's browser, per platform.
 *
 * Separated from the spawn so it can be asserted for every platform from any
 * platform — the bug below only ever appeared on Windows, where none of this
 * suite runs.
 *
 * Windows does **not** go through `cmd`. It used to: `spawn('start', [url],
 * { shell: true })` runs `cmd /c start <url>`, and cmd reads `&` as a command
 * separator, so an authorize URL built by URLSearchParams was chopped at the
 * first parameter. The browser received `...authorize?client_id=...` with no
 * scope, response_type or redirect_uri, and Microsoft answered AADSTS900144.
 * Quoting it for cmd is possible and fiddly; `rundll32 url.dll` opens the
 * default handler with no shell involved, so there is no escaping to get
 * wrong.
 */
export const browserOpener = (
  os: string,
  url: string,
): { command: string; args: string[] } => {
  if (os === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  if (os === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
};

const openBrowser = (url: string): void => {
  const { command, args } = browserOpener(platform(), url);
  try {
    // No `shell`, on any platform. A shell is what interpreted the URL.
    spawn(command, args, { detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref();
  } catch {
    // Printed below regardless.
  }
};

/**
 * Serves exactly one request, then stops listening. The browser gets a readable
 * page in both outcomes so nobody is left on a connection error wondering
 * whether it worked.
 */
const awaitCode = (expectedState: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not here.');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const ok = code !== null && state === expectedState;

      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        ok
          ? 'Connected. Close this tab and return to your terminal.'
          : 'Something went wrong. Return to your terminal for the details.',
      );
      server.close();

      if (error !== null) {
        reject(new Error(`${error}: ${url.searchParams.get('error_description') ?? 'no detail'}`));
      } else if (state !== expectedState) {
        // Not the response we asked for, so the code in it is not ours to spend.
        reject(new Error('the response did not match this request and was discarded'));
      } else if (code === null) {
        reject(new Error('no authorization code came back'));
      } else {
        resolve(code);
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(
              `Port ${REDIRECT_PORT} is already in use, and sign-in has to use exactly ` +
                'that port. Close whatever is using it and try again.',
            )
          : err,
      );
    });

    // Without this a closed browser tab leaves the command hanging forever.
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for consent in the browser.'));
    }, CONSENT_TIMEOUT_MS);
    timer.unref();

    server.listen(REDIRECT_PORT);
  });

export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  /**
   * Seconds. Unused on this machine, which refreshes on every call and so
   * never has to decide whether a token is still good; the hosted server
   * caches and does.
   */
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

/**
 * Both providers explain a 4xx in the body. Throwing that away makes every
 * failure look identical, which cost real time on the hosted side, so the
 * provider's own words are used whenever it sends any.
 *
 * Exported because the hosted server performs the same exchange against the
 * same providers, and the error semantics below are the part worth not
 * reimplementing: which failures mean reconnect and which do not is a
 * distinction that took a while to get right.
 */
export const postToken = async (
  config: ProviderConfig,
  form: Record<string, string>,
  clientSecret?: string,
): Promise<TokenResponse> => {
  const body: Record<string, string> = { client_id: config.clientId, ...form };
  if (clientSecret !== undefined && clientSecret !== '') {
    body.client_secret = clientSecret;
  }

  let res: Response;
  try {
    res = await fetch(config.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch (cause) {
    throw new GraphError(`Could not reach ${config.label} to sign in: ${cause}`, false);
  }

  const parsed = (await res.json().catch(() => ({}))) as TokenResponse;

  if (!res.ok) {
    // invalid_grant is the expired-or-revoked case, and the only one the user
    // can fix. Everything else is ours or the provider's to fix, and telling
    // someone to reconnect would send them round a loop that never closes.
    const reconnect = parsed.error === 'invalid_grant';
    throw new GraphError(
      `${config.label} rejected the sign-in: ${parsed.error_description ?? parsed.error ?? res.status}` +
        (reconnect ? '. Reconnect needed.' : ''),
      reconnect,
    );
  }

  return parsed;
};

/**
 * Run consent for one provider and store what comes back. Resolves once the
 * connection is usable, so a caller can report success without a second check.
 */
export const connect = async (
  provider: ProviderName,
  grants: readonly WriteCapability[] = [],
): Promise<void> => {
  const config = PROVIDERS[provider];
  const scope = scopesFor(provider, grants);

  // Before the browser opens, so a configuration problem is reported while the
  // user is still in the terminal rather than after they have consented.
  const clientSecret = config.needsClientSecret
    ? (process.env.ARTIST_MCP_GOOGLE_CLIENT_SECRET ?? (await fetchGoogleClientSecret()))
    : undefined;

  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');

  const url = new URL(config.authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...config.extraAuthParams,
  }).toString();

  // Listen before opening the browser, or a fast consent can arrive at a port
  // nothing is watching yet.
  const pending = awaitCode(state);

  console.error(`\nOpening your browser to connect ${config.label}.`);
  console.error('If it does not open, paste this into a browser yourself:\n');
  console.error(`  ${url}\n`);
  openBrowser(url.toString());

  const code = await pending;

  const tokens = await postToken(
    config,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    },
    clientSecret,
  );

  if (tokens.refresh_token === undefined) {
    throw new Error(
      `${config.label} returned no refresh token, so this connection could not ` +
        'be kept. Nothing was stored.',
    );
  }

  await saveProvider(provider, {
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? scope,
    connectedAt: new Date().toISOString(),
    ...(clientSecret === undefined ? {} : { clientSecret }),
  });
};

/**
 * Exchange the stored refresh token for an access token.
 *
 * The write-back happens before the access token is returned, and that ordering
 * is the whole reason this is not three lines. Microsoft has already invalidated
 * the old refresh token by the time this responds, so returning first and
 * storing later would leave a window where a crash costs the user their
 * connection with no server-side copy to restore it.
 */
export const accessTokenFor = async (provider: ProviderName): Promise<string> => {
  const config = PROVIDERS[provider];
  const stored = await readProvider(provider);

  if (stored === undefined) {
    throw new GraphError(
      `No ${config.label} connection on this machine. Run \`artist-mcp connect ${provider}\`.`,
      true,
    );
  }

  // Cached at connect time. Only fetched here for a connection stored before
  // this was cached, so an existing install does not need reconnecting — and
  // the result is written back, or that install would fetch it again on every
  // refresh and depend on our web app for as long as it lived.
  let clientSecret: string | undefined;
  if (config.needsClientSecret) {
    clientSecret = process.env.ARTIST_MCP_GOOGLE_CLIENT_SECRET ?? stored.clientSecret;
    if (clientSecret === undefined) {
      clientSecret = await fetchGoogleClientSecret();
      await updateClientSecret(provider, clientSecret);
    }
  }

  const tokens = await postToken(
    config,
    {
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      // What this connection actually carries, not what the current build would
      // ask for. A refresh requesting more than the grant carries is rejected,
      // so using config.scope here breaks every existing connection the moment
      // a scope is added to the product — an hour later, in a session, far from
      // the change that caused it.
      scope: stored.scope,
    },
    clientSecret,
  );

  if (tokens.refresh_token !== undefined && tokens.refresh_token !== stored.refreshToken) {
    await updateRefreshToken(provider, tokens.refresh_token);
  }

  if (tokens.access_token === undefined) {
    throw new GraphError(`${config.label} returned no access token.`, false);
  }

  return tokens.access_token;
};
