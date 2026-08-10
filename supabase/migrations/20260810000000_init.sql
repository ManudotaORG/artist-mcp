-- Core schema: one row per Microsoft connection, one row per issued MCP key.
--
-- Two separate protections, guarding different things:
--   RLS        keeps signed-in user A from reading user B's rows.
--   pgcrypto   keeps a stolen database dump from yielding usable tokens.
-- Neither substitutes for the other.
--
-- The encryption key is never stored in the database. It lives in the edge
-- function's secrets and is passed in as an argument on each call, so a dump
-- contains ciphertext and nothing that decrypts it.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- connections

create table public.connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      text not null default 'microsoft',
  refresh_token bytea not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, provider)
);

comment on column public.connections.refresh_token is
  'pgp_sym_encrypt ciphertext. Never written or read directly — use the '
  'set_connection / connection_refresh_token functions, which take the key.';

-- ------------------------------------------------------------------ mcp_keys

create table public.mcp_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

comment on column public.mcp_keys.key_hash is
  'sha256 of the connection key. The key itself is shown once and never stored.';

create index mcp_keys_user_id_idx on public.mcp_keys (user_id);

-- ----------------------------------------------------------------------- RLS

alter table public.connections enable row level security;
alter table public.mcp_keys    enable row level security;

-- The service role bypasses RLS, which is how the edge function reads another
-- user's row when resolving a connection key. These policies govern the
-- browser's anon-key access only.

create policy "own connections" on public.connections
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own keys" on public.mcp_keys
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------- functions

-- Upsert a connection, encrypting the token on the way in.
create function public.set_connection(
  p_user_id       uuid,
  p_refresh_token text,
  p_key           text,
  p_provider      text default 'microsoft'
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.connections (user_id, provider, refresh_token)
  values (
    p_user_id,
    p_provider,
    extensions.pgp_sym_encrypt(p_refresh_token, p_key)
  )
  on conflict (user_id, provider) do update
    set refresh_token = excluded.refresh_token,
        updated_at    = now();
$$;

-- Decrypt on the way out. Returns null when there's no connection.
create function public.connection_refresh_token(
  p_user_id  uuid,
  p_key      text,
  p_provider text default 'microsoft'
) returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.pgp_sym_decrypt(c.refresh_token, p_key)
  from public.connections c
  where c.user_id = p_user_id
    and c.provider = p_provider;
$$;

-- These run as definer and take the encryption key as an argument, so they must
-- never be reachable from the browser.
revoke execute on function public.set_connection(uuid, text, text, text)
  from anon, authenticated;
revoke execute on function public.connection_refresh_token(uuid, text, text)
  from anon, authenticated;
