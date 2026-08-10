import { NextResponse } from 'next/server';
import { codeChallenge, codeVerifier, stateToken } from '@/lib/crypto';
import { supabaseServer } from '@/lib/supabase/server';

const AUTHORIZE = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

// offline_access is not optional: without it Microsoft returns no refresh
// token and the connection dies after the first hour.
const SCOPES = 'Notes.Read offline_access User.Read';

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.redirect(
      new URL('/', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    );

  const verifier = codeVerifier();
  const state = stateToken();

  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', process.env.MS_CLIENT_ID!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', process.env.MS_REDIRECT_URI!);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(url);

  // httpOnly so the browser can never read either value; the callback compares
  // `state` against what comes back to reject a forged callback.
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  };
  res.cookies.set('ms_state', state, cookie);
  res.cookies.set('ms_verifier', verifier, cookie);

  return res;
}
