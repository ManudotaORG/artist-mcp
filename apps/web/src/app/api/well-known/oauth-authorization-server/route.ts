import { SCOPE, issuer, json } from '@/lib/oauth';

/**
 * What this authorization server supports, for a client that has never heard
 * of it. Served at /.well-known/oauth-authorization-server by a rewrite: Next
 * will not route a directory whose name begins with a dot.
 */
export const dynamic = 'force-dynamic';

export const GET = async (): Promise<Response> => {
  const base = issuer();
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // S256 only, deliberately. See verifierMatches.
    code_challenge_methods_supported: ['S256'],
    // Public clients authenticate with PKCE alone; a client that registered a
    // secret may present it. Both are listed so a client can choose.
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: [SCOPE],
  });
};
