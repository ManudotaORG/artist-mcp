'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { connectionKey, hashKey } from '@/lib/crypto';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

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
 * Issues a connection key, replacing any existing one.
 *
 * Returned to the caller once and never stored — only the sha256 goes in the
 * database, so a dump yields nothing usable and we cannot show it again.
 */
export const createKey = async (): Promise<{ key?: string; error?: string }> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.' };

  const key = connectionKey();
  const admin = supabaseAdmin();

  // One key per user keeps revocation unambiguous: generating a new one
  // invalidates every installed copy of the old.
  await admin.from('mcp_keys').delete().eq('user_id', user.id);

  const { error } = await admin
    .from('mcp_keys')
    .insert({ user_id: user.id, key_hash: hashKey(key) });

  if (error) return { error: error.message };

  revalidatePath('/');
  return { key };
};

export const revokeKey = async (): Promise<{ error?: string }> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.' };

  const { error } = await supabaseAdmin().from('mcp_keys').delete().eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/');
  return {};
};

/**
 * Removes one provider's token, and revokes every MCP key only when it was the
 * last connection — a key addresses whichever providers remain, so dropping
 * Gmail must not revoke the key that still reaches OneNote. The atomicity of
 * both deletes lives in the function, so the account cannot land half
 * disconnected.
 */
export const disconnectProvider = async (
  provider: 'microsoft' | 'google',
): Promise<{ error?: string }> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.' };

  const { error } = await supabase.rpc('disconnect_provider', { p_provider: provider });
  if (error) {
    const label = provider === 'google' ? 'Gmail' : 'Microsoft';
    return { error: `Could not disconnect ${label}. Try again.` };
  }

  revalidatePath('/');
  return {};
};
