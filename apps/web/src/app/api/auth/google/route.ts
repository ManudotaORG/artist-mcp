import { NextResponse } from 'next/server';
import { codeChallenge, codeVerifier, stateToken } from '@/lib/crypto';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';

// Read-only, and only Gmail. Email is supporting evidence for a OneNote
// working unit, so nothing here needs send, modify, or any other surface.
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

export const GET = async () => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/', getSiteUrl()));

  const verifier = codeVerifier();
  const state = stateToken();

  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI!);
  url.searchParams.set('scope', SCOPES);

  // Google's equivalent of offline_access. Without access_type=offline it
  // returns an access token and no refresh token, and the connection dies
  // within the hour — the same failure Microsoft has without offline_access.
  url.searchParams.set('access_type', 'offline');

  // Google issues a refresh token only on the FIRST consent for a given
  // client/user pair. A user who reconnects — after a disconnect, or to repair
  // a broken connection — silently gets none, and the exchange below rejects
  // them for a reason they cannot act on. prompt=consent forces the screen
  // every time so a refresh token always comes back.
  url.searchParams.set('prompt', 'consent');

  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(url);

  // httpOnly so the browser can never read either value; the callback compares
  // `state` against what comes back to reject a forged callback. Named apart
  // from the ms_ cookies so a connect to one provider cannot clobber an
  // in-flight connect to the other.
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  };
  res.cookies.set('google_state', state, cookie);
  res.cookies.set('google_verifier', verifier, cookie);

  return res;
};
