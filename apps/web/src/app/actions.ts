'use server';

import { redirect } from 'next/navigation';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';

export const signIn = async (_prev: unknown, formData: FormData) => {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email address.' };

  const supabase = await supabaseServer();
  // Accounts are not self-served. Signup is disabled on the project itself,
  // which is what actually enforces this — the anon key is public and reaches
  // GoTrue directly, so nothing decided here could be relied on. Saying it
  // again from this side only makes the refusal arrive as a refusal, instead
  // of as a 'check your email' for a message that is never sent.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${getSiteUrl()}/auth/confirm`, shouldCreateUser: false },
  });

  // Supabase reports a closed signup in its own words, which describe the
  // instance rather than the person's situation. Someone who was never added
  // has done nothing wrong and can do nothing about "signups not allowed", so
  // they are told what is actually true and what would change it.
  if (error) {
    const closed = /signup|not allowed|disabled/i.test(error.message);
    return {
      error: closed
        ? 'That address is not set up for artist-mcp. Accounts are arranged directly — get in touch and we will add you.'
        : error.message,
    };
  }

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
