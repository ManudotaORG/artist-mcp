-- Fix: the previous migration revoked EXECUTE from anon and authenticated, but
-- Postgres grants EXECUTE to PUBLIC on every new function by default, and both
-- roles inherit that. The revokes were therefore no-ops and the functions were
-- reachable with the anon key.
--
-- Verified before this migration: an anon-key POST to
-- /rest/v1/rpc/connection_refresh_token executed and returned null.
-- Expected after: 404 (PostgREST hides functions it cannot execute).
--
-- Only the service role, which the edge function uses, should reach these —
-- they run as definer and take the encryption key as an argument.

revoke execute on function public.set_connection(uuid, text, text, text)
  from public;
revoke execute on function public.connection_refresh_token(uuid, text, text)
  from public;

grant execute on function public.set_connection(uuid, text, text, text)
  to service_role;
grant execute on function public.connection_refresh_token(uuid, text, text)
  to service_role;
