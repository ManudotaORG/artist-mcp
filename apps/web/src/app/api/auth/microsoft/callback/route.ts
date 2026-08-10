import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

const home = (params: Record<string, string>) => {
  const url = new URL('/', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Microsoft reports consent failures here rather than by status code.
  const oauthError = params.get('error');
  if (oauthError) {
    return NextResponse.redirect(home({ error: params.get('error_description') ?? oauthError }));
  }

  const code = params.get('code');
  const state = params.get('state');

  const expectedState = request.cookies.get('ms_state')?.value;
  const verifier = request.cookies.get('ms_verifier')?.value;

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
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.MS_REDIRECT_URI!,
      code_verifier: verifier,
    }),
  });

  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    console.error('Microsoft token exchange failed:', token);
    return NextResponse.redirect(
      home({ error: token.error_description?.split('\n')[0] ?? 'Token exchange failed.' }),
    );
  }

  if (!token.refresh_token) {
    // Almost always a missing offline_access scope.
    return NextResponse.redirect(
      home({ error: 'Microsoft returned no refresh token. Check the offline_access scope.' }),
    );
  }

  // Encrypted inside Postgres; the key is passed in, never stored.
  const { error } = await supabaseAdmin().rpc('set_connection', {
    p_user_id: user.id,
    p_refresh_token: token.refresh_token,
    p_key: process.env.TOKEN_ENCRYPTION_KEY!,
  });

  if (error) {
    console.error('Storing connection failed:', error);
    return NextResponse.redirect(home({ error: 'Could not save the connection.' }));
  }

  const res = NextResponse.redirect(home({ connected: '1' }));
  res.cookies.delete('ms_state');
  res.cookies.delete('ms_verifier');
  return res;
}
