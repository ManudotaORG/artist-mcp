import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { postToken } from '@manudota/artist-mcp/oauth';
import { HANDOFF_COOKIE, decodeHandoff, isProvider, webClient } from '@/lib/connect';
import { admin } from '@/lib/oauth';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Where the provider sends the person back, and where the token becomes ours to
 * keep.
 *
 * Three things are checked before anything is stored, and each closes a
 * different hole: the person is signed in (whose connection is this), the state
 * matches the cookie (did we start this flow), and the provider in the cookie
 * matches the route (a code for one provider must not be redeemed as another).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> => {
  const { provider } = await params;
  const base = getSiteUrl();

  const done = (query: string) => {
    const response = NextResponse.redirect(new URL(`/?${query}`, base));
    // Spent or failed, it has no further use and should not outlive the round
    // trip it was created for.
    response.cookies.delete({ name: HANDOFF_COOKIE, path: '/api/auth' });
    return response;
  };
  const fail = (message: string) => done(`error=${encodeURIComponent(message)}`);

  if (!isProvider(provider)) return fail('Unknown provider.');

  const search = request.nextUrl.searchParams;

  // The provider reports refusal here too. "access_denied" is someone changing
  // their mind, which is not an error to apologise for.
  const providerError = search.get('error');
  if (providerError) {
    return fail(
      providerError === 'access_denied'
        ? 'Connection cancelled.'
        : `${provider} refused the connection: ${search.get('error_description') ?? providerError}`,
    );
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in', base));

  const store = await cookies();
  const handoff = decodeHandoff(store.get(HANDOFF_COOKIE)?.value);
  if (handoff === null) return fail('That connection attempt expired. Try again.');

  const state = search.get('state');
  // Constant-time is unnecessary — an attacker who can read the cookie has
  // already won — but the comparison must happen, and against the value we
  // issued rather than anything in the URL.
  if (!state || state !== handoff.state) return fail('The connection could not be verified.');
  if (handoff.provider !== provider) return fail('The connection could not be verified.');

  const code = search.get('code');
  if (!code) return fail('The provider returned no authorization code.');

  const client = webClient(provider);
  if (client === null) return fail(`Connecting ${provider} is not configured on this deployment.`);

  let refreshToken: string | undefined;
  try {
    const tokens = await postToken(
      client.config,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: client.redirectUri,
        code_verifier: handoff.verifier,
        // The package's config carries its own client id; this flow uses the
        // web registration instead, so it is overridden here.
        client_id: client.clientId,
      },
      client.clientSecret,
    );
    refreshToken = tokens.refresh_token;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  // No refresh token means the connection would work until the access token
  // expired and then fail silently — the exact failure this project keeps
  // warning about. Better to refuse now and say why.
  if (refreshToken === undefined) {
    return fail(
      `${provider} returned no refresh token, so this connection could not outlive the hour. ` +
        'Remove the app from your account security settings and try again.',
    );
  }

  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) return fail('This deployment cannot store connections.');

  const { error } = await admin().rpc('set_connection', {
    p_user_id: user.id,
    p_refresh_token: refreshToken,
    p_key: key,
    p_provider: provider,
  });

  if (error) return fail(`Could not store the connection: ${error.message}`);

  return done(`connected=${provider}`);
};
