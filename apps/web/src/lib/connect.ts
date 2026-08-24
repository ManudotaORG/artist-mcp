import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { PROVIDERS, type ProviderConfig } from '@manudota/artist-mcp/oauth';
import { getSiteUrl } from '@/lib/siteUrl';

/**
 * Connecting a provider to a hosted account, from the web.
 *
 * The package's own consent flow redirects to loopback on the user's machine,
 * which is right there and useless here: the point of a hosted account is a
 * person who will not open a terminal. So this repeats the flow with a web
 * redirect, reusing the provider endpoints, scopes and token exchange rather
 * than restating them.
 *
 * It uses **separate client registrations** from the published package. The
 * package's clients are desktop clients whose Google secret is served openly by
 * /api/client-config — harmless there because PKCE is what protects a desktop
 * client, and not harmless at all for a web client that can keep a secret. One
 * registration serving both would have to be the weaker of the two.
 *
 * Unconfigured, connecting is refused rather than half-attempted. A deployment
 * without these values has no web client to consent against, and discovering
 * that at the provider's error page helps nobody.
 */

export type ProviderName = 'microsoft' | 'google';

export type WebClient = {
  config: ProviderConfig;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const ENV: Record<ProviderName, { id: string; secret: string }> = {
  microsoft: {
    id: 'ARTIST_MCP_WEB_MS_CLIENT_ID',
    secret: 'ARTIST_MCP_WEB_MS_CLIENT_SECRET',
  },
  google: {
    id: 'ARTIST_MCP_WEB_GOOGLE_CLIENT_ID',
    secret: 'ARTIST_MCP_WEB_GOOGLE_CLIENT_SECRET',
  },
};

export const isProvider = (value: string): value is ProviderName =>
  value === 'microsoft' || value === 'google';

/** Where the provider sends the person back. Registered with them, exactly. */
export const redirectUriFor = (provider: ProviderName): string =>
  `${getSiteUrl()}/api/connect/${provider}/callback`;

/** Null when this deployment has no web client for the provider. */
export const webClient = (provider: ProviderName): WebClient | null => {
  const names = ENV[provider];
  const clientId = process.env[names.id];
  const clientSecret = process.env[names.secret];
  if (!clientId || !clientSecret) return null;

  return {
    config: PROVIDERS[provider],
    clientId,
    clientSecret,
    redirectUri: redirectUriFor(provider),
  };
};

/**
 * RFC 7636 S256, same as everywhere else here.
 *
 * PKCE still matters with a confidential client. The secret proves which
 * application is redeeming the code; the verifier proves it is the same session
 * that asked for it. A stolen code without the verifier is useless even to the
 * real client.
 */
export const pkce = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
};

export const newState = (): string => randomBytes(16).toString('base64url');

/**
 * The cookie carrying state and verifier between the two halves of the flow.
 *
 * httpOnly so no script can read it, sameSite lax so it survives the provider's
 * top-level redirect back, and short-lived because it is worthless once
 * consent completes and a liability if it lingers.
 */
export const HANDOFF_COOKIE = 'artist_mcp_connect';
export const HANDOFF_MAX_AGE = 10 * 60;

export type Handoff = { provider: ProviderName; state: string; verifier: string };

export const encodeHandoff = (value: Handoff): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export const decodeHandoff = (raw: string | undefined): Handoff | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Handoff;
    if (!isProvider(parsed.provider) || !parsed.state || !parsed.verifier) return null;
    return parsed;
  } catch {
    return null;
  }
};
