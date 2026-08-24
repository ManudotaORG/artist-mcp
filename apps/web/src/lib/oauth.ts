import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSiteUrl } from '@/lib/siteUrl';

/**
 * The authorization server, existing because ChatGPT offers no other way in.
 *
 * Its connector settings are OAuth, none, or mixed. A bearer key in a header is
 * not among them, and "none" would put a URL that reads someone's mail and
 * calendar on the open internet. So the protocol plumbing below is not
 * enthusiasm for OAuth; it is the only option that is not a data leak.
 *
 * Resource server and authorization server are the same deployment. They are
 * separate roles in the spec and could be separate services, but there is one
 * app here and pretending otherwise would add indirection with no reader.
 */

/** Long enough that guessing is not a strategy, short enough to paste. */
const SECRET_BYTES = 32;

/** Codes are redeemed within seconds of being issued. Minutes is already generous. */
export const CODE_TTL_MS = 5 * 60 * 1000;

/** Access tokens are cheap to refresh and expensive to leak. */
export const TOKEN_TTL_MS = 60 * 60 * 1000;

export const SCOPE = 'mcp';

export const issuer = (): string => getSiteUrl();

export const newSecret = (prefix: string): string =>
  `${prefix}_${randomBytes(SECRET_BYTES).toString('base64url')}`;

/** Stored form. Never the value itself — a dump must not yield anything presentable. */
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export const admin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || secret === undefined) {
    throw new Error('Supabase credentials are not configured on this deployment.');
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

/**
 * A redirect_uri is only acceptable if it was registered, compared whole.
 *
 * Prefix matching is the classic way to get this wrong: a client registering
 * `https://example.com/cb` would accept `https://example.com/cb.evil.test`,
 * and the authorization code goes to the attacker. Exact match, or nothing.
 */
export const redirectAllowed = (registered: string[], candidate: string): boolean =>
  registered.includes(candidate);

/**
 * RFC 7636 S256 only.
 *
 * The spec permits "plain", where the verifier is sent as the challenge. That
 * defeats the point — anyone who saw the authorization request can replay it —
 * so it is not offered, and a client asking for it is refused rather than
 * silently downgraded.
 */
export const verifierMatches = (verifier: string, challenge: string): boolean =>
  createHash('sha256').update(verifier).digest('base64url') === challenge;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Discovery documents are fetched cross-origin by clients that are not
      // browsers pretending otherwise; the errors are too.
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...headers,
    },
  });

/** The shape RFC 6749 requires for failures, which clients parse rather than display. */
export const oauthError = (error: string, description: string, status = 400): Response =>
  json({ error, error_description: description }, status);
