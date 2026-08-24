import {
  SCOPE,
  TOKEN_TTL_MS,
  admin,
  hash,
  json,
  newSecret,
  oauthError,
  verifierMatches,
} from '@/lib/oauth';

/**
 * Exchange a code for a token, or a refresh token for a fresh one.
 *
 * The code is redeemed by a SQL function that sets redeemed_at in the same
 * statement that reads it, so two simultaneous redemptions cannot both succeed.
 * That is not theoretical tidiness: a code that can be spent twice is an
 * account takeover if one of the two callers is not who they claim to be.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const form = async (request: Request): Promise<URLSearchParams> => {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await request.json()) as Record<string, string>;
    return new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await request.text());
};

const issue = async (userId: string, clientId: string) => {
  const db = admin();
  const accessToken = newSecret('at');
  const refreshToken = newSecret('rt');

  const { error } = await db.from('oauth_tokens').insert({
    token_hash: hash(accessToken),
    refresh_hash: hash(refreshToken),
    client_id: clientId,
    user_id: userId,
    scope: SCOPE,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  if (error) return null;

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: SCOPE,
  };
};

/**
 * A registered secret must be presented; a client that registered without one
 * is public and authenticates with PKCE alone. Checked by hash, so the stored
 * value is never anything that could be replayed.
 */
const clientOk = async (clientId: string, presented: string | null) => {
  const { data } = await admin()
    .from('oauth_clients')
    .select('client_id, client_secret_hash')
    .eq('client_id', clientId)
    .maybeSingle();
  if (!data) return false;
  const expected = data.client_secret_hash as string | null;
  if (expected === null) return true;
  return presented !== null && hash(presented) === expected;
};

export const POST = async (request: Request): Promise<Response> => {
  let params: URLSearchParams;
  try {
    params = await form(request);
  } catch {
    return oauthError('invalid_request', 'The request body could not be read.');
  }

  const clientId = params.get('client_id') ?? '';
  const clientSecret = params.get('client_secret');
  const grant = params.get('grant_type');

  if (!clientId) return oauthError('invalid_client', 'client_id is required.', 401);
  if (!(await clientOk(clientId, clientSecret))) {
    return oauthError('invalid_client', 'The client could not be authenticated.', 401);
  }

  const db = admin();

  if (grant === 'authorization_code') {
    const code = params.get('code') ?? '';
    const verifier = params.get('code_verifier') ?? '';
    const redirectUri = params.get('redirect_uri') ?? '';
    if (!code || !verifier) {
      return oauthError('invalid_request', 'code and code_verifier are required.');
    }

    const { data, error } = await db.rpc('redeem_oauth_code', {
      p_code_hash: hash(code),
      p_client_id: clientId,
    });
    if (error) return oauthError('server_error', error.message, 500);

    const row = Array.isArray(data) ? data[0] : data;
    // Covers unknown, expired, and already-redeemed alike. Distinguishing them
    // would tell an attacker which guesses were close.
    if (!row) return oauthError('invalid_grant', 'The code is not valid.');

    if (row.redirect_uri !== redirectUri) {
      return oauthError('invalid_grant', 'redirect_uri does not match the authorization request.');
    }

    if (!verifierMatches(verifier, row.code_challenge)) {
      return oauthError('invalid_grant', 'The code_verifier does not match the challenge.');
    }

    const issued = await issue(row.user_id as string, clientId);
    return issued === null
      ? oauthError('server_error', 'Could not issue a token.', 500)
      : json(issued);
  }

  if (grant === 'refresh_token') {
    const presented = params.get('refresh_token') ?? '';
    if (!presented) return oauthError('invalid_request', 'refresh_token is required.');

    // Deleted as it is spent, so one refresh token buys exactly one rotation.
    const { data, error } = await db
      .from('oauth_tokens')
      .delete()
      .eq('refresh_hash', hash(presented))
      .eq('client_id', clientId)
      .select('user_id')
      .maybeSingle();

    if (error) return oauthError('server_error', error.message, 500);
    if (!data) return oauthError('invalid_grant', 'The refresh token is not valid.');

    const issued = await issue(data.user_id as string, clientId);
    return issued === null
      ? oauthError('server_error', 'Could not issue a token.', 500)
      : json(issued);
  }

  return oauthError(
    'unsupported_grant_type',
    `grant_type ${grant ?? '(missing)'} is not supported.`,
  );
};
