-- An OAuth 2.1 authorization server, because ChatGPT offers no other way in.
--
-- Its connector UI has three authentication settings — OAuth, none, and mixed.
-- A bearer key in a header is not among them, and "none" would put a URL that
-- reads someone's mail and calendar on the open internet. That leaves OAuth,
-- which the MCP profile specifies in detail: discovery metadata, dynamic client
-- registration, authorization code with PKCE.
--
-- The human step is the sign-in that already exists. A magic link was built for
-- the hosted design, kept dormant when custody moved to the user's machine, and
-- is exactly the consent screen this needs — which is why it was worth keeping.
--
-- Secrets are stored as sha256 and never in the clear, the same rule mcp_keys
-- follows: a database dump yields values that cannot be presented.

-- ----------------------------------------------------------------- clients

-- Registered by the client itself, unprompted. ChatGPT has no client id here
-- and no way to be given one out of band, so dynamic registration is not a
-- convenience — without it there is no first request.
create table public.oauth_clients (
  client_id            text primary key,
  -- Null for a public client. PKCE is what protects those, and demanding a
  -- secret from a client that cannot keep one buys nothing.
  client_secret_hash   text,
  client_name          text,
  redirect_uris        text[] not null,
  created_at           timestamptz not null default now(),
  last_used_at         timestamptz
);

comment on table public.oauth_clients is
  'Dynamically registered OAuth clients. Anyone may register; registration '
  'grants nothing. Access still requires a human to sign in and approve.';

-- ------------------------------------------------------------------- codes

create table public.oauth_codes (
  code_hash             text primary key,
  client_id             text not null references public.oauth_clients (client_id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  redirect_uri          text not null,
  -- S256 only. The spec permits "plain"; accepting it would let a network
  -- observer replay the verifier, which is the whole thing PKCE prevents.
  code_challenge        text not null,
  scope                 text,
  expires_at            timestamptz not null,
  -- Set on redemption rather than deleting the row: a code presented twice is
  -- a signal worth being able to see, and deleting makes replay look like an
  -- unknown code.
  redeemed_at           timestamptz
);

create index oauth_codes_expires_at_idx on public.oauth_codes (expires_at);

-- ------------------------------------------------------------------ tokens

create table public.oauth_tokens (
  token_hash        text primary key,
  client_id         text not null references public.oauth_clients (client_id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  refresh_hash      text unique,
  scope             text,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz
);

create index oauth_tokens_user_id_idx on public.oauth_tokens (user_id);

-- --------------------------------------------------------------------- RLS
--
-- Enabled with no policies at all. Every table in this schema is served by
-- PostgREST, so a table without RLS is a public endpoint — these hold client
-- registrations, live authorization codes and token hashes. The service role
-- bypasses RLS, and nothing else has any business here.

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes   enable row level security;
alter table public.oauth_tokens  enable row level security;

-- --------------------------------------------------------------- functions

-- Redeem a code exactly once.
--
-- A single statement, because "check then update" lets two simultaneous
-- redemptions both pass the check — and a code that can be spent twice is an
-- account takeover if one of the two callers is not who they claim.
create or replace function public.redeem_oauth_code(
  p_code_hash text,
  p_client_id text
) returns table (user_id uuid, redirect_uri text, code_challenge text, scope text)
language sql
security definer
set search_path = public
as $$
  update public.oauth_codes
     set redeemed_at = now()
   where code_hash = p_code_hash
     and client_id = p_client_id
     and redeemed_at is null
     and expires_at > now()
  returning user_id, redirect_uri, code_challenge, scope;
$$;

-- Resolve an access token and record the use, in one statement for the same
-- reason resolve_mcp_key does: a token used without being recorded makes
-- last_used_at a lie, and that column is what says a token is safe to revoke.
create or replace function public.resolve_oauth_token(p_token_hash text)
returns uuid
language sql
security definer
set search_path = public
as $$
  update public.oauth_tokens
     set last_used_at = now()
   where token_hash = p_token_hash
     and expires_at > now()
  returning user_id;
$$;

-- Both revokes. Revoking from PUBLIC alone leaves the explicit grant Supabase's
-- default privileges give anon and authenticated — the hole 20260824130000
-- exists to correct, and the reason scripts/hosted-custody.test.mjs asserts it.
revoke execute on function public.redeem_oauth_code(text, text) from public, anon, authenticated;
revoke execute on function public.resolve_oauth_token(text) from public, anon, authenticated;
grant  execute on function public.redeem_oauth_code(text, text) to service_role;
grant  execute on function public.resolve_oauth_token(text) to service_role;
