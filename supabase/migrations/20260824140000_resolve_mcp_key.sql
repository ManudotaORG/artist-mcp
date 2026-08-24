-- Who a hosted request is acting for.
--
-- The key itself is never stored — only its sha256, which is what makes a
-- database dump useless for impersonating anyone. The caller presents the key,
-- the server hashes it, and this looks up the hash. A leaked dump yields
-- hashes, and a hash cannot be presented.
--
-- Written as a function rather than a table read so the lookup and the
-- last_used_at write happen together. Two round trips would let a key be used
-- without recording it, and last_used_at is the only signal that a key still
-- matters — which is what tells you it is safe to revoke.
--
-- Returns null for an unknown hash. The caller cannot distinguish "no such
-- key" from "revoked", which is correct: both mean the same thing to whoever
-- is holding it, and saying more would confirm which guesses were close.

create or replace function public.resolve_mcp_key(p_key_hash text)
returns uuid
language sql
security definer
set search_path = public
as $$
  update public.mcp_keys
     set last_used_at = now()
   where key_hash = p_key_hash
  returning user_id;
$$;

-- Both revokes, deliberately. Revoking from PUBLIC alone leaves the explicit
-- grant Supabase's default privileges give anon and authenticated, and the
-- function stays callable — see 20260824130000, which exists because that
-- distinction was missed once already.
revoke execute on function public.resolve_mcp_key(text) from public, anon, authenticated;
grant  execute on function public.resolve_mcp_key(text) to service_role;
