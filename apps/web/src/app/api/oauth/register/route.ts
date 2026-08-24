import { admin, hash, json, newSecret, oauthError } from '@/lib/oauth';

/**
 * RFC 7591 dynamic client registration.
 *
 * Open, and that is not an oversight. ChatGPT has no client id here and no way
 * to be given one out of band, so refusing unknown clients would refuse the
 * only client this was built for.
 *
 * What makes it safe is that registration grants nothing. A registered client
 * can ask for authorization; it cannot obtain any, because that requires a
 * human to receive a magic link, sign in, and approve. Registration is a name
 * and a redirect target, and both are worthless without that person.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RegistrationRequest = {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
};

/**
 * A redirect target must be a real absolute URL, and https unless it is
 * loopback. http://localhost is how a desktop client receives its code and is
 * safe because it never leaves the machine; http anywhere else puts an
 * authorization code on the open network.
 */
const usableRedirect = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
};

export const POST = async (request: Request): Promise<Response> => {
  let body: RegistrationRequest;
  try {
    body = (await request.json()) as RegistrationRequest;
  } catch {
    return oauthError('invalid_client_metadata', 'The request body is not JSON.');
  }

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (uris.length === 0) {
    return oauthError('invalid_redirect_uri', 'At least one redirect_uri is required.');
  }
  if (!uris.every(usableRedirect)) {
    return oauthError(
      'invalid_redirect_uri',
      'Every redirect_uri must be an absolute https URL, or http on loopback.',
    );
  }

  const clientId = newSecret('client');

  // A public client authenticates with PKCE alone. Only issue a secret when the
  // client says it intends to use one — handing a secret to something that
  // cannot keep it is worse than not issuing one, because it looks like
  // protection that is not there.
  const wantsSecret = body.token_endpoint_auth_method === 'client_secret_post';
  const clientSecret = wantsSecret ? newSecret('secret') : null;

  const { error } = await admin()
    .from('oauth_clients')
    .insert({
      client_id: clientId,
      client_secret_hash: clientSecret === null ? null : hash(clientSecret),
      client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null,
      redirect_uris: uris,
    });

  if (error) {
    return oauthError('server_error', `Could not register the client: ${error.message}`, 500);
  }

  return json(
    {
      client_id: clientId,
      ...(clientSecret === null ? {} : { client_secret: clientSecret }),
      client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: wantsSecret ? 'client_secret_post' : 'none',
    },
    201,
  );
};
