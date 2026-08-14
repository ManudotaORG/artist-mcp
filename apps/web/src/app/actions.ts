'use server';

import { redirect } from 'next/navigation';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';

export const signIn = async (_prev: unknown, formData: FormData) => {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email address.' };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${getSiteUrl()}/auth/confirm` },
  });

  if (error) return { error: error.message };
  return { sent: true };
};

export const signOut = async () => {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/');
};

/**
 * Key issuance lived here. It is gone: an installed copy holds its own provider
 * tokens now and authenticates directly, so there is no key for this app to
 * mint and nothing for the edge function to resolve. The mcp_keys table is left
 * in place and dormant — see docs/operations.md for why it was not dropped.
 */
