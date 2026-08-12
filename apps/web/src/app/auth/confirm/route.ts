import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Where the magic link lands. Verifies the token and sets the session cookie.
 *
 * Two shapes arrive here depending on the email template:
 *   ?code=...        Supabase's default template, which routes through its own
 *                    /auth/v1/verify and hands back a PKCE code.
 *   ?token_hash=...  a custom template using {{ .TokenHash }}.
 * Both are supported so this works whichever template the project has.
 */
export const GET = async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const base = getSiteUrl();

  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, base));

  // Supabase reports link problems (expired, already used) here.
  const linkError = params.get('error_description') ?? params.get('error');
  if (linkError) return fail(linkError);

  const supabase = await supabaseServer();

  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? fail(error.message) : NextResponse.redirect(new URL('/', base));
  }

  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    return error ? fail(error.message) : NextResponse.redirect(new URL('/', base));
  }

  return fail('Invalid sign-in link.');
};
