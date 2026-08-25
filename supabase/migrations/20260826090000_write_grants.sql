-- Which writes a hosted user has opted into.
--
-- Its own table rather than a column on connections, for an ordering reason
-- that is easy to miss: the grant decides which scopes the consent screen asks
-- for, so it has to exist *before* the connection does. A refresh token carries
-- the scopes it was granted with and cannot be widened afterwards, so a grant
-- recorded on the connection row could only ever describe a connection that was
-- made without it.
--
-- Per user, not per user and provider. A capability is a thing this account may
-- do; which provider it reaches is a property of the capability.
--
-- Not a secret, so not encrypted. It is still reachable only through the
-- functions below, for the same reason the custody functions are: the anon and
-- publishable keys must not be able to read or change what an account is
-- allowed to do. See docs/decisions/0002-hosted-writes.md.

create table public.write_grants (
  user_id    uuid not null references auth.users (id) on delete cascade,
  capability text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, capability)
);

comment on table public.write_grants is
  'Opt-in write capabilities per hosted user. Off by default: no row means no '
  'write tool is registered for that user, and their token is never asked for '
  'a write scope.';

alter table public.write_grants enable row level security;
-- No policies, deliberately, matching the oauth tables: PostgREST exposes
-- nothing, and every read goes through the security-definer functions below.

-- ------------------------------------------------------------------- reading

create or replace function public.write_grants_for(p_user_id uuid)
returns text[]
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(capability order by capability), array[]::text[])
  from public.write_grants
  where user_id = p_user_id;
$$;

comment on function public.write_grants_for(uuid) is
  'The capabilities this user has opted into. Empty array, never null, so a '
  'caller cannot mistake "no grant" for "not answered".';

-- ------------------------------------------------------------------- writing

create or replace function public.set_write_grants(
  p_user_id      uuid,
  p_capabilities text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Replace, not merge. The caller states the whole set, so revoking is
  -- expressible — a merge would make removing a capability impossible without a
  -- second function, and a capability nobody can withdraw is not opt-in.
  delete from public.write_grants
  where user_id = p_user_id
    and capability <> all (coalesce(p_capabilities, array[]::text[]));

  insert into public.write_grants (user_id, capability)
  select p_user_id, unnest(coalesce(p_capabilities, array[]::text[]))
  on conflict (user_id, capability) do nothing;
end;
$$;

comment on function public.set_write_grants(uuid, text[]) is
  'Replaces this user''s capabilities with the set given. Widening one still '
  'requires reconnecting the provider: a refresh token carries the scopes it '
  'was granted with.';

-- Both revokes, because they guard different grants that look alike. See
-- 20260824130000 — revoking from PUBLIC alone leaves the ALTER DEFAULT
-- PRIVILEGES grants to anon and authenticated in place.
revoke execute on function public.write_grants_for(uuid) from public;
revoke execute on function public.write_grants_for(uuid) from anon, authenticated;
revoke execute on function public.set_write_grants(uuid, text[]) from public;
revoke execute on function public.set_write_grants(uuid, text[]) from anon, authenticated;
