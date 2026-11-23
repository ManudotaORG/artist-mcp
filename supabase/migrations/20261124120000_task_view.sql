-- The hosted task view's snapshot (docs/decisions/0020).
--
-- A read-only copy of what the CL Aufgaben pages held when they were last read,
-- kept so a page load never reads OneNote. Not a mirror and not a record:
-- nothing writes back from it, nothing in it is edited, and no write is ever
-- built from it. OneNote stays the record.
--
-- Custody, which is why this is not plain text behind a policy: everything
-- stored here is something the tokens in `connections` can already read, so it
-- adds no reach — it adds persistence. The task text is encrypted with the same
-- key the tokens are, passed per call and never stored, so a dump of this
-- database yields nothing readable from it, exactly as for the tokens. Titles,
-- section and notebook names and page links stay readable so the functions can
-- prune by them; they already appear in the hosted logs.
--
-- Every table has RLS and no policies, and every function is service role only
-- with EXECUTE revoked from PUBLIC *and* from anon and authenticated — the grants
-- trap in docs/operations.md. The one exception is forget_my_task_view(), which
-- the signed-in user's own disconnect calls and which can only delete that
-- user's own rows.

-- One row per user who has opened the view: which refresh is running, and what
-- "Neu" is compared against.
create table public.task_view_users (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  -- The refresh in progress or last started. Each notebook's read is accepted
  -- only for this refresh and only shortly after it began.
  refresh_started_at timestamptz,
  refresh_full       boolean not null default false,
  -- When the last full refresh was claimed (the one-an-hour limit) and finished.
  full_started_at    timestamptz,
  -- Neu: the hashes of every task key as they stood when "Gesehen" was last
  -- pressed. Hashes, never text — they are compared and never shown.
  seen_at            timestamptz,
  seen_keys          text[] not null default '{}'
);

-- One row per notebook in the view, chosen by the user. Named as OneNote names
-- it, because that is what the notebook listing is asked for.
create table public.task_view_notebooks (
  user_id          uuid not null references public.task_view_users (user_id) on delete cascade,
  notebook         text not null,
  position         smallint not null default 0,
  -- When this notebook was last listed, and how. The next narrowed refresh asks
  -- for sections changed since then.
  listed_at        timestamptz,
  full_at          timestamptz,
  stored_for       timestamptz,
  -- Sections with no CL Aufgaben page, or several: read nothing, said on the view.
  sections_without text[] not null default '{}',
  sections_several text[] not null default '{}',
  -- The CL Aufgaben pages the last listing found that have not been read since:
  -- id, section, title and links, never task text. Read in later requests,
  -- because one function cannot always list a notebook and read every page in
  -- sixty seconds — on 2026-11-23 a throttled listing took 22 s and left the
  -- reads 5. A page still pending keeps its older copy, labelled by its read_at.
  pending          jsonb not null default '[]'::jsonb,
  -- Why the last attempt failed, when it did. The older pages stay.
  error            text,
  error_at         timestamptz,
  primary key (user_id, notebook)
);

-- One row per CL Aufgaben page: the newest read of it and nothing older.
create table public.task_view_pages (
  user_id    uuid not null,
  page_id    text not null,
  notebook   text not null,
  section    text not null,
  title      text not null,
  web_url    text,
  client_url text,
  -- When this page was read. Not OneNote's last_modified, which on this account
  -- is a creation date and is deliberately not stored at all.
  read_at    timestamptz not null,
  -- pageTasks() as JSON, encrypted. Null when the read failed.
  tasks      bytea,
  error      text,
  primary key (user_id, page_id),
  foreign key (user_id, notebook)
    references public.task_view_notebooks (user_id, notebook) on delete cascade
);

alter table public.task_view_users     enable row level security;
alter table public.task_view_notebooks enable row level security;
alter table public.task_view_pages     enable row level security;
-- No policies: PostgREST exposes none of the three. The functions below are the
-- only way in.

comment on table public.task_view_pages is
  'A display copy of CL Aufgaben pages for the hosted task view (0020). Never '
  'a source for a write. Task text encrypted with the per-call key.';

-- Choose the notebooks in the view. Replaces the set; a dropped notebook takes
-- its pages with it.
create function public.set_task_view_notebooks(p_user_id uuid, p_notebooks text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.task_view_users (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  delete from public.task_view_notebooks
  where user_id = p_user_id and not (notebook = any (coalesce(p_notebooks, '{}')));

  insert into public.task_view_notebooks (user_id, notebook, position)
  select p_user_id, n, (i - 1)::smallint
  from unnest(coalesce(p_notebooks, '{}')) with ordinality as t (n, i)
  on conflict (user_id, notebook) do update set position = excluded.position;
end;
$$;

-- Claim a refresh, in one statement so two presses cannot both pass the check.
--
-- At most one every ten minutes, and a full one at most once an hour. A full
-- read is forced when none has finished in a day. Counted in refreshes rather
-- than left to the request pacer, because OneNote's 400 an hour is shared with
-- the digest and the local install and is not paced. Returns whether it was
-- claimed and, if not, when the next one may start.
create function public.claim_task_refresh(p_user_id uuid, p_full boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.task_view_users;
  current public.task_view_users;
  last_full timestamptz;
begin
  select max(full_at) into last_full
  from public.task_view_notebooks where user_id = p_user_id;

  update public.task_view_users u
     set refresh_started_at = now(),
         refresh_full = p_full or last_full is null or last_full < now() - interval '24 hours',
         full_started_at = case
           when p_full or last_full is null or last_full < now() - interval '24 hours' then now()
           else u.full_started_at
         end
   where u.user_id = p_user_id
     and (u.refresh_started_at is null or u.refresh_started_at < now() - interval '10 minutes')
     and (not p_full or u.full_started_at is null or u.full_started_at < now() - interval '1 hour')
  returning * into claimed;

  if claimed.user_id is not null then
    return jsonb_build_object('ok', true, 'started_at', claimed.refresh_started_at, 'full', claimed.refresh_full);
  end if;

  select * into current from public.task_view_users where user_id = p_user_id;
  if current.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_view');
  end if;
  return jsonb_build_object(
    'ok', false,
    'reason', case
      when current.refresh_started_at >= now() - interval '10 minutes' then 'cooldown'
      else 'full_cooldown'
    end,
    'next_at', greatest(
      current.refresh_started_at + interval '10 minutes',
      case when p_full then current.full_started_at + interval '1 hour' end
    )
  );
end;
$$;

-- The claimed refresh, checked by every store: the same start time, and not
-- long after it. Raises otherwise.
create function public.task_refresh_claim(p_user_id uuid, p_started_at timestamptz)
returns public.task_view_users
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claim public.task_view_users;
begin
  select * into claim from public.task_view_users where user_id = p_user_id;
  if claim.user_id is null
     or claim.refresh_started_at is distinct from p_started_at
     or now() > p_started_at + interval '10 minutes' then
    raise exception 'No refresh in progress';
  end if;
  return claim;
end;
$$;

-- Store one notebook's listing, for the refresh that was claimed: what its
-- sections are now and which CL Aufgaben pages are to be read. No task text.
--
-- p_sections is every section the notebook has now: pages of any other section
-- are dropped. p_changed is the sections this listing covered (every one, on a
-- full refresh): in those, a stored page that is no longer the section's CL
-- Aufgaben page is dropped, and the ones that are become pending, keeping their
-- older copy until they are read. Sections the listing skipped as unchanged
-- keep everything as it is. Once per notebook per refresh.
create function public.store_task_listing(
  p_user_id    uuid,
  p_started_at timestamptz,
  p_notebook   text,
  p_listed_at  timestamptz,
  p_sections   text[],
  p_changed    text[],
  p_pending    jsonb,
  p_without    text[],
  p_several    text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claim public.task_view_users := public.task_refresh_claim(p_user_id, p_started_at);
  nb    public.task_view_notebooks;
  ids   text[] := array(select p->>'page_id' from jsonb_array_elements(coalesce(p_pending, '[]'::jsonb)) p);
begin
  select * into nb from public.task_view_notebooks
  where user_id = p_user_id and notebook = p_notebook
  for update;
  if nb.user_id is null then
    raise exception 'Notebook is not in this view';
  end if;
  if nb.stored_for is not distinct from p_started_at then
    raise exception 'This notebook was already listed for this refresh';
  end if;

  delete from public.task_view_pages
  where user_id = p_user_id and notebook = p_notebook
    and (not (section = any (coalesce(p_sections, '{}')))
         or (section = any (coalesce(p_changed, '{}')) and not (page_id = any (ids))));

  update public.task_view_notebooks
     set listed_at  = p_listed_at,
         full_at    = case when claim.refresh_full then p_listed_at else full_at end,
         stored_for = p_started_at,
         -- Pending from an earlier refresh stays pending if its section was
         -- skipped as unchanged; a re-listed section's pages are this listing's.
         pending = coalesce((
           select jsonb_agg(p) from (
             select p from jsonb_array_elements(nb.pending) p
             where p->>'section' = any (coalesce(p_sections, '{}'))
               and not (p->>'section' = any (coalesce(p_changed, '{}')))
             union all
             select p from jsonb_array_elements(coalesce(p_pending, '[]'::jsonb)) p
           ) t), '[]'::jsonb),
         -- Unchanged sections keep what was found before; re-listed ones are
         -- replaced by this listing's findings; vanished ones drop out.
         sections_without = array(
           select s from unnest(sections_without) s
           where s = any (coalesce(p_sections, '{}')) and not (s = any (coalesce(p_changed, '{}')))
           union select unnest(coalesce(p_without, '{}'))
         ),
         sections_several = array(
           select s from unnest(sections_several) s
           where s = any (coalesce(p_sections, '{}')) and not (s = any (coalesce(p_changed, '{}')))
           union select unnest(coalesce(p_several, '{}'))
         ),
         error = null,
         error_at = null
   where user_id = p_user_id and notebook = p_notebook;
end;
$$;

-- Store pages read for the refresh that was claimed. Only a page the listing
-- left pending is accepted, and its section, title and links are the
-- listing's: the caller supplies an id and what was read, nothing that says
-- which page it is. That keeps every stored page a CL Aufgaben page the
-- server's own listing chose.
create function public.store_task_pages(
  p_user_id    uuid,
  p_key        text,
  p_started_at timestamptz,
  p_notebook   text,
  p_pages      jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claim  public.task_view_users := public.task_refresh_claim(p_user_id, p_started_at);
  nb     public.task_view_notebooks;
  stored integer;
begin
  select * into nb from public.task_view_notebooks
  where user_id = p_user_id and notebook = p_notebook
  for update;
  if nb.user_id is null or nb.stored_for is distinct from p_started_at then
    raise exception 'This notebook was not listed for this refresh';
  end if;

  insert into public.task_view_pages
    (user_id, page_id, notebook, section, title, web_url, client_url, read_at, tasks, error)
  select p_user_id, l->>'page_id', p_notebook, l->>'section', l->>'title',
         l->>'web_url', l->>'client_url', now(),
         case when jsonb_typeof(r->'tasks') = 'object'
              then extensions.pgp_sym_encrypt((r->'tasks')::text, p_key) end,
         case when jsonb_typeof(r->'tasks') = 'object' then null
              else coalesce(r->>'error', 'Nicht gelesen') end
  from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) r
  join jsonb_array_elements(nb.pending) l on l->>'page_id' = r->>'page_id'
  on conflict (user_id, page_id) do update
    set notebook = excluded.notebook, section = excluded.section, title = excluded.title,
        web_url = excluded.web_url, client_url = excluded.client_url,
        read_at = excluded.read_at, tasks = excluded.tasks, error = excluded.error;
  get diagnostics stored = row_count;

  update public.task_view_notebooks
     set pending = coalesce((
           select jsonb_agg(l) from jsonb_array_elements(nb.pending) l
           where not exists (select 1 from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) r
                             where r->>'page_id' = l->>'page_id')), '[]'::jsonb)
   where user_id = p_user_id and notebook = p_notebook;

  return stored;
end;
$$;

-- A notebook whose read failed: say so, keep what was there.
create function public.fail_task_notebook(
  p_user_id uuid, p_started_at timestamptz, p_notebook text, p_error text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.task_view_notebooks n
     set error = left(p_error, 500), error_at = now()
   where n.user_id = p_user_id and n.notebook = p_notebook
     and exists (select 1 from public.task_view_users u
                 where u.user_id = p_user_id and u.refresh_started_at = p_started_at);
$$;

-- Everything the view shows, decrypted. Read only.
create function public.task_view_for(p_user_id uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user', (select to_jsonb(u) - 'user_id' - 'seen_keys'
               || jsonb_build_object('seen_keys', u.seen_keys)
             from public.task_view_users u where u.user_id = p_user_id),
    'notebooks', coalesce((select jsonb_agg(to_jsonb(n) - 'user_id' order by n.position)
                           from public.task_view_notebooks n where n.user_id = p_user_id), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object(
                         'page_id', p.page_id, 'notebook', p.notebook, 'section', p.section,
                         'title', p.title, 'web_url', p.web_url, 'client_url', p.client_url,
                         'read_at', p.read_at, 'error', p.error,
                         'tasks', case when p.tasks is null then null
                                       else extensions.pgp_sym_decrypt(p.tasks, p_key)::jsonb end)
                       order by p.notebook, p.section)
                       from public.task_view_pages p where p.user_id = p_user_id), '[]'::jsonb)
  );
$$;

-- "Gesehen": what Neu is compared against from now on.
create function public.mark_task_view_seen(p_user_id uuid, p_keys text[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.task_view_users
     set seen_at = now(), seen_keys = coalesce(p_keys, '{}')
   where user_id = p_user_id;
$$;

-- The signed-in user's own copy, deleted. Called by their disconnect; takes no
-- argument, so it cannot name anyone else.
create function public.forget_my_task_view()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  delete from public.task_view_users where user_id = me;
end;
$$;

-- Disconnecting Microsoft now also deletes the copy of what Microsoft held.
-- Otherwise as 20260812120000.
create or replace function public.disconnect_provider(p_provider text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  remaining       integer;
begin
  if current_user_id is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;

  if p_provider is null or p_provider not in ('microsoft', 'google') then
    raise invalid_parameter_value using message = 'Unknown provider';
  end if;

  delete from public.connections
  where user_id = current_user_id
    and provider = p_provider;

  if p_provider = 'microsoft' then
    perform public.forget_my_task_view();
  end if;

  select count(*) into remaining
  from public.connections
  where user_id = current_user_id;

  if remaining = 0 then
    delete from public.mcp_keys
    where user_id = current_user_id;
  end if;
end;
$$;

-- Both revokes for every service-role function; see docs/operations.md.
revoke execute on function public.set_task_view_notebooks(uuid, text[]) from public;
revoke execute on function public.set_task_view_notebooks(uuid, text[]) from anon, authenticated;
revoke execute on function public.claim_task_refresh(uuid, boolean) from public;
revoke execute on function public.claim_task_refresh(uuid, boolean) from anon, authenticated;
revoke execute on function public.task_refresh_claim(uuid, timestamptz) from public;
revoke execute on function public.task_refresh_claim(uuid, timestamptz) from anon, authenticated;
revoke execute on function public.store_task_listing(uuid, timestamptz, text, timestamptz, text[], text[], jsonb, text[], text[]) from public;
revoke execute on function public.store_task_listing(uuid, timestamptz, text, timestamptz, text[], text[], jsonb, text[], text[]) from anon, authenticated;
revoke execute on function public.store_task_pages(uuid, text, timestamptz, text, jsonb) from public;
revoke execute on function public.store_task_pages(uuid, text, timestamptz, text, jsonb) from anon, authenticated;
revoke execute on function public.fail_task_notebook(uuid, timestamptz, text, text) from public;
revoke execute on function public.fail_task_notebook(uuid, timestamptz, text, text) from anon, authenticated;
revoke execute on function public.task_view_for(uuid, text) from public;
revoke execute on function public.task_view_for(uuid, text) from anon, authenticated;
revoke execute on function public.mark_task_view_seen(uuid, text[]) from public;
revoke execute on function public.mark_task_view_seen(uuid, text[]) from anon, authenticated;

grant execute on function public.set_task_view_notebooks(uuid, text[]) to service_role;
grant execute on function public.claim_task_refresh(uuid, boolean) to service_role;
grant execute on function public.task_refresh_claim(uuid, timestamptz) to service_role;
grant execute on function public.store_task_listing(uuid, timestamptz, text, timestamptz, text[], text[], jsonb, text[], text[]) to service_role;
grant execute on function public.store_task_pages(uuid, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.fail_task_notebook(uuid, timestamptz, text, text) to service_role;
grant execute on function public.task_view_for(uuid, text) to service_role;
grant execute on function public.mark_task_view_seen(uuid, text[]) to service_role;

-- Takes no argument and deletes only the caller's own rows, so the signed-in
-- user may run it — their disconnect does. Never anon.
revoke execute on function public.forget_my_task_view() from public, anon;
grant  execute on function public.forget_my_task_view() to authenticated;

revoke execute on function public.disconnect_provider(text) from public, anon;
grant  execute on function public.disconnect_provider(text) to authenticated;
