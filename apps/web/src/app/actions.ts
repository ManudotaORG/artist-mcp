"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { connectionKey, hashKey } from "@/lib/crypto";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
  });

  if (error) return { error: error.message };
  return { sent: true };
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/");
}

/**
 * Issues a connection key, replacing any existing one.
 *
 * Returned to the caller once and never stored — only the sha256 goes in the
 * database, so a dump yields nothing usable and we cannot show it again.
 */
export async function createKey(): Promise<{ key?: string; error?: string }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const key = connectionKey();
  const admin = supabaseAdmin();

  // One key per user keeps revocation unambiguous: generating a new one
  // invalidates every installed copy of the old.
  await admin.from("mcp_keys").delete().eq("user_id", user.id);

  const { error } = await admin
    .from("mcp_keys")
    .insert({ user_id: user.id, key_hash: hashKey(key) });

  if (error) return { error: error.message };

  revalidatePath("/");
  return { key };
}

export async function revokeKey(): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { error } = await supabaseAdmin()
    .from("mcp_keys")
    .delete()
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/");
  return {};
}
