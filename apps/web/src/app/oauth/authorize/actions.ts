'use server';

import { redirect } from 'next/navigation';
import { CODE_TTL_MS, SCOPE, admin, hash, newSecret, redirectAllowed } from '@/lib/oauth';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Send the magic link, returning to this authorization request afterwards.
 *
 * The sign-in that already existed is the consent step. It was built for the
 * hosted design, kept dormant when custody moved to the user's machine, and is
 * the reason this endpoint needs no new notion of identity.
 */
export const sendLink = async (_prev: unknown, formData: FormData) => {
  const email = String(formData.get('email') ?? '').trim();
  const next = String(formData.get('next') ?? '/');
  if (!email) return { error: 'Enter your email address.' };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Signup is closed, so this reaches existing named users only. Someone
      // without an account gets an error rather than a new account, which is
      // the boundary #55 asks for.
      shouldCreateUser: false,
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: error.message };
  return { sent: true };
};

/**
 * Issue an authorization code for the signed-in user.
 *
 * Every parameter is re-validated here rather than trusted from the form. The
 * page validated them to decide what to render; this is a separate request, and
 * a form is something a caller controls.
 */
export const approve = async (formData: FormData): Promise<void> => {
  const clientId = String(formData.get('client_id') ?? '');
  const redirectUri = String(formData.get('redirect_uri') ?? '');
  const challenge = String(formData.get('code_challenge') ?? '');
  const state = String(formData.get('state') ?? '');

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/oauth/authorize?error=session_expired');

  const db = admin();
  const { data: client } = await db
    .from('oauth_clients')
    .select('client_id, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle();

  if (!client || !redirectAllowed(client.redirect_uris as string[], redirectUri)) {
    // Never redirect to an unverified target, even to report a failure: that is
    // the open redirect this check exists to prevent.
    redirect('/oauth/authorize?error=invalid_client');
  }

  const code = newSecret('code');
  const { error } = await db.from('oauth_codes').insert({
    code_hash: hash(code),
    client_id: clientId,
    user_id: user.id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    scope: SCOPE,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  if (error) redirect('/oauth/authorize?error=server_error');

  await db
    .from('oauth_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('client_id', clientId);

  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  // Returned exactly as given. It is the client's CSRF defence, and altering or
  // dropping it breaks the one check it can make on the way back.
  if (state) target.searchParams.set('state', state);
  redirect(target.toString());
};
