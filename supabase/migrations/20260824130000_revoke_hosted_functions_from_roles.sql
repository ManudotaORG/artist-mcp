-- Fix: the custody functions were reachable with the public API key.
--
-- 20260824120000 revoked EXECUTE from PUBLIC, following the lesson recorded in
-- 20260810010000. That lesson is half the story, and the half it leaves out is
-- the one that matters here.
--
-- Supabase configures ALTER DEFAULT PRIVILEGES on the public schema to grant
-- EXECUTE on new functions to anon and authenticated. That is an explicit
-- grant to each role, not the implicit PUBLIC one, and revoking from PUBLIC
-- does not remove it. A function needs both revokes; either alone leaves it
-- callable.
--
-- Which is why connection_refresh_token is correctly locked — its first
-- migration revoked from anon and authenticated, and a later one added PUBLIC —
-- while the functions added yesterday were not. The comment in 20260810010000
-- calls that first revoke a no-op. It was not. Both were doing work, against
-- different grants that happen to look alike.
--
-- Observed on staging with the publishable key before this migration:
--   try_lock_refresh      -> 200, returning false
--   release_refresh_lock  -> 204, and it really did clear the lease
-- Neither reads a token, so nothing decrypted leaked. The reachable damage was
-- denial of service: anyone could hold or drop the refresh lease for any user
-- id they cared to guess, and a dropped lease is how two concurrent refreshes
-- get to race — the exact failure 20260824120000 exists to prevent.

revoke execute on function public.connection_access_token(uuid, text, text)
  from anon, authenticated;
revoke execute on function public.try_lock_refresh(uuid, text, integer)
  from anon, authenticated;
revoke execute on function public.store_refreshed_tokens(uuid, text, text, timestamptz, text, text)
  from anon, authenticated;
revoke execute on function public.release_refresh_lock(uuid, text)
  from anon, authenticated;

-- Belt and braces on the two the earlier migrations already covered, so the
-- whole custody surface is stated in one place and a reader does not have to
-- assemble it from three files to know it is closed.
revoke execute on function public.set_connection(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.connection_refresh_token(uuid, text, text)
  from public, anon, authenticated;
