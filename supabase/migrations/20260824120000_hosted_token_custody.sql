-- Hosted custody: cache the access token, and make rotation safe under
-- concurrency.
--
-- The local package refreshes on every call, which is correct there: one
-- process, one user, one thing at a time. Hosted it is not. Microsoft
-- invalidates a refresh token the instant it issues the replacement, so two
-- concurrent requests both refresh, both write, and the loser's token is the
-- one the next call tries to spend. The connection dies silently, one call
-- later, and nothing in the failure names the cause.
--
-- Two changes, addressing different halves:
--
--   Caching turns a refresh from something that happens on every request into
--   something that happens roughly hourly. That is not a speed argument. It is
--   how often the dangerous window opens at all.
--
--   The lock makes the window safe when it does open, because rarely is not
--   never and the failure is silent.

-- ------------------------------------------------------------------ columns

alter table public.connections
  -- Encrypted with the same key as the refresh token. An access token is
  -- shorter-lived, not less sensitive: it spends against the provider directly
  -- and needs no exchange to be useful.
  add column if not exists access_token bytea,
  add column if not exists access_token_expires_at timestamptz,
  -- A lease, not a lock: held by a process that may vanish mid-refresh, so it
  -- expires on its own rather than needing anyone to release it.
  add column if not exists refresh_lock_until timestamptz;

comment on column public.connections.access_token is
  'pgp_sym_encrypt ciphertext, valid until access_token_expires_at. Cached so '
  'a refresh — which rotates the refresh token — is hourly rather than '
  'per-request.';

comment on column public.connections.refresh_lock_until is
  'Lease expiry for the one request permitted to refresh. Self-expiring, '
  'because the holder is a serverless instance that can disappear.';

-- ---------------------------------------------------------------- functions

-- The cached access token, or null when there is none or it is close enough to
-- expiry to be worthless. The margin is generous on purpose: a token that
-- expires mid-request is a failure the user sees, and the cost of refreshing a
-- minute early is one extra exchange an hour.
create or replace function public.connection_access_token(
  p_user_id  uuid,
  p_key      text,
  p_provider text default 'microsoft'
) returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.pgp_sym_decrypt(c.access_token, p_key)
  from public.connections c
  where c.user_id = p_user_id
    and c.provider = p_provider
    and c.access_token is not null
    and c.access_token_expires_at > now() + interval '2 minutes';
$$;

-- Claim the right to refresh. True means this caller may spend the refresh
-- token; false means someone else already is, and the caller should wait and
-- read the access token they will have written.
create or replace function public.try_lock_refresh(
  p_user_id  uuid,
  p_provider text default 'microsoft',
  p_seconds  integer default 20
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  locked boolean;
begin
  -- One statement, so two callers arriving together cannot both win: the
  -- second blocks on the row and then fails its own predicate.
  update public.connections
     set refresh_lock_until = now() + make_interval(secs => p_seconds)
   where user_id = p_user_id
     and provider = p_provider
     and (refresh_lock_until is null or refresh_lock_until < now())
  returning true into locked;

  return coalesce(locked, false);
end;
$$;

-- Store what an exchange returned, and drop the lease in the same statement so
-- a waiting caller is not held for the full lease after the work is done.
--
-- The refresh token is written only when one came back. Google does not always
-- return one, and treating its absence as a revocation would delete a working
-- connection.
create or replace function public.store_refreshed_tokens(
  p_user_id       uuid,
  p_key           text,
  p_access_token  text,
  p_expires_at    timestamptz,
  p_refresh_token text default null,
  p_provider      text default 'microsoft'
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.connections
     set access_token            = extensions.pgp_sym_encrypt(p_access_token, p_key),
         access_token_expires_at = p_expires_at,
         refresh_token           = case
                                     when p_refresh_token is null then refresh_token
                                     else extensions.pgp_sym_encrypt(p_refresh_token, p_key)
                                   end,
         refresh_lock_until      = null,
         updated_at              = now()
   where user_id = p_user_id
     and provider = p_provider;
$$;

-- Release without storing, for an exchange that failed. Without this a failed
-- refresh would block every later attempt until the lease ran out.
create or replace function public.release_refresh_lock(
  p_user_id  uuid,
  p_provider text default 'microsoft'
) returns void
language sql
security definer
set search_path = public
as $$
  update public.connections
     set refresh_lock_until = null
   where user_id = p_user_id
     and provider = p_provider;
$$;

-- ------------------------------------------------------------------- grants
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and anon and
-- authenticated inherit it. Revoking from those two roles alone is a no-op —
-- the mistake migration 20260810010000 exists to correct. Revoke from PUBLIC.
--
-- These take the encryption key as an argument and run as definer, so the
-- service role is the only caller that may reach them.

revoke execute on function public.connection_access_token(uuid, text, text) from public;
revoke execute on function public.try_lock_refresh(uuid, text, integer) from public;
revoke execute on function public.store_refreshed_tokens(uuid, text, text, timestamptz, text, text) from public;
revoke execute on function public.release_refresh_lock(uuid, text) from public;

grant execute on function public.connection_access_token(uuid, text, text) to service_role;
grant execute on function public.try_lock_refresh(uuid, text, integer) to service_role;
grant execute on function public.store_refreshed_tokens(uuid, text, text, timestamptz, text, text) to service_role;
grant execute on function public.release_refresh_lock(uuid, text) to service_role;
