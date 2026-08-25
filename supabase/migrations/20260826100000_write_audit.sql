-- What this service changed on someone's behalf.
--
-- The published package appends a line to ~/.artist-mcp/writes.log. On a
-- serverless host that is a file nobody will ever read, and the whole
-- justification for calendar writes in docs/decisions/0001 is that a wrong one
-- is *detectable and reversible*. Hosted shipping without the detectable half
-- would be strictly worse than the local case rather than equivalent.
--
-- So the row records what was written in full, not a reference to it. A wrong
-- create leaves something visible; a wrong delete leaves a gap, and nobody
-- notices an absence — the record has to be enough to put the event back by
-- hand once Google's 30-day bin has expired.

create table public.write_audit (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  at          timestamptz not null default now(),
  operation   text not null,
  -- The event as the musician would read it back, not an id.
  summary     text not null,
  -- Where it landed, so it can be found again to undo.
  target      text not null,
  -- The OneNote page it came from, when the caller named one.
  source_page text
);

comment on table public.write_audit is
  'One row per completed write. Append-only by convention: nothing here '
  'updates or deletes a row, because a record that can be edited is not one.';

create index write_audit_user_at on public.write_audit (user_id, at desc);

alter table public.write_audit enable row level security;
-- No policies, matching the other tables in this schema: PostgREST exposes
-- nothing and the function below is the only way in.

create or replace function public.record_write(
  p_user_id     uuid,
  p_operation   text,
  p_summary     text,
  p_target      text,
  p_source_page text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.write_audit (user_id, operation, summary, target, source_page)
  values (p_user_id, p_operation, p_summary, p_target, p_source_page);
$$;

comment on function public.record_write(uuid, text, text, text, text) is
  'Records a write that has already happened. Insert only — there is no '
  'function to amend or remove a row, deliberately.';

-- Both revokes; see 20260824130000 for why either alone is not enough.
revoke execute on function public.record_write(uuid, text, text, text, text) from public;
revoke execute on function public.record_write(uuid, text, text, text, text)
  from anon, authenticated;
