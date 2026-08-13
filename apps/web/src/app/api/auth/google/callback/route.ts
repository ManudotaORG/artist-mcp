import { NextRequest, NextResponse } from 'next/server';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const home = (params: Record<string, string>) => {
  const url = new URL('/', getSiteUrl());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
};

export const GET = async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;

  // Google reports a declined consent screen here rather than by status code.
  const oauthError = params.get('error');
  if (oauthError) {
    return NextResponse.redirect(home({ error: params.get('error_description') ?? oauthError }));
  }

  const code = params.get('code');
  const state = params.get('state');

  const expectedState = request.cookies.get('google_state')?.value;
  const verifier = request.cookies.get('google_verifier')?.value;

  // Reject a callback we didn't initiate.
  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    return NextResponse.redirect(home({ error: 'Invalid OAuth state. Try connecting again.' }));
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(home({ error: 'Sign in first.' }));

  // Exchanged server-side: the client secret and the resulting tokens never
  // touch the browser.
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      code_verifier: verifier,
    }),
  });

  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    console.error('Google token exchange failed:', token);
    return NextResponse.redirect(
      home({ error: token.error_description?.split('\n')[0] ?? 'Token exchange failed.' }),
    );
  }

  if (!token.refresh_token) {
    // Google withholds it when the user has consented before and the authorize
    // call did not force the screen. The connect route sets prompt=consent to
    // prevent exactly this, so reaching here means that guard is gone.
    return NextResponse.redirect(
      home({ error: 'Google returned no refresh token. Disconnect and connect again.' }),
    );
  }

  // Encrypted inside Postgres; the key is passed in, never stored. p_provider
  // is what keeps this from overwriting the Microsoft row — the table is
  // unique on (user_id, provider), not on user_id.
  const { error } = await supabaseAdmin().rpc('set_connection', {
    p_user_id: user.id,
    p_refresh_token: token.refresh_token,
    p_key: process.env.TOKEN_ENCRYPTION_KEY!,
    p_provider: 'google',
  });

  if (error) {
    console.error('Storing connection failed:', error);
    return NextResponse.redirect(home({ error: 'Could not save the connection.' }));
  }

  const res = NextResponse.redirect(home({ connected: 'google' }));
  res.cookies.delete('google_state');
  res.cookies.delete('google_verifier');
  return res;
};
