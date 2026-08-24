import { NextResponse } from 'next/server';
import {
  HANDOFF_COOKIE,
  HANDOFF_MAX_AGE,
  encodeHandoff,
  isProvider,
  newState,
  pkce,
  webClient,
} from '@/lib/connect';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Begin consent for a hosted connection.
 *
 * Signed in first, always. The whole flow exists to attach a credential to an
 * account, and beginning it without knowing which account would produce a token
 * with nowhere to go — or worse, somewhere wrong.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> => {
  const { provider } = await params;
  const base = getSiteUrl();
  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, base));

  if (!isProvider(provider)) return fail('Unknown provider.');

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in', base));

  const client = webClient(provider);
  if (client === null) {
    // Said here rather than at the provider, where the error would be about a
    // client id that does not exist and would read as our outage.
    return fail(`Connecting ${provider} is not configured on this deployment yet.`);
  }

  const { verifier, challenge } = pkce();
  const state = newState();

  const authorize = new URL(client.config.authorize);
  authorize.searchParams.set('client_id', client.clientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', client.redirectUri);
  authorize.searchParams.set('scope', client.config.scope);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  // offline_access for Microsoft, access_type=offline and prompt=consent for
  // Google. Without them the provider returns an access token and no refresh
  // token, and a hosted connection dies within the hour.
  for (const [key, value] of Object.entries(client.config.extraAuthParams)) {
    authorize.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(authorize.toString());
  response.cookies.set(HANDOFF_COOKIE, encodeHandoff({ provider, state, verifier }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: base.startsWith('https://'),
    path: '/api/auth',
    maxAge: HANDOFF_MAX_AGE,
  });
  return response;
};
