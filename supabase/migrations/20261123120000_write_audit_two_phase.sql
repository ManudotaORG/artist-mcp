-- Record a write before it happens, and let one user's record be read back.
--
-- docs/decisions/0018-undo-and-unattended-row-updates.md, step 1. The write log
-- is becoming the undo: `undo_write` will find a write by its id and reverse
-- it. That changes what a failed record means. While a person confirmed every
-- destructive write, a record that could not be made after the write was
-- swallowed, because the write had happened and reporting it as failed invited
-- a duplicate. Once the log is the only way back, a write whose pre-image was
-- not kept is a write with no undo — so a write that has one is recorded as
-- `pending` first, and refused if that cannot be done.
--
-- Completion is a second row with the same write_id, never an update of the
-- first. The table stays strictly append-only, as its first comment promises,
-- and a pending row with no done row is itself the evidence that a write may
-- or may not have landed.
--
-- Safe to apply before the code that uses it is deployed: every new parameter
-- has a default, so the record_write calls the running deployment makes with
-- six named arguments resolve to the new function unchanged.

alter table public.write_audit
  add column write_id uuid,
  add column status   text check (status in ('pending', 'done')),
  add column wrote    text;

comment on column public.write_audit.write_id is
  'Shared by the pending row written before a write and the done row after it. '
  'Null for writes recorded the old way, once, afterwards.';
comment on column public.write_audit.status is
  'pending: recorded before the write, which may or may not have landed. '
  'done: the write returned. Null for writes recorded the old way.';
comment on column public.write_audit.wrote is
  'What the write put there, as written, so an undo can find it again.';

create index write_audit_user_write_id on public.write_audit (user_id, write_id);

-- Dropped and recreated rather than replaced with defaulted parameters, as in
-- 20260831120000: `create or replace` cannot change a signature, and two
-- overloads resolvable by the same named-argument call would leave PostgREST
-- choosing between them.
drop function public.record_write(uuid, text, text, text, text, text);

create function public.record_write(
  p_user_id     uuid,
  p_operation   text,
  p_summary     text,
  p_target      text,
  p_source_page text default null,
  p_pre_image   text default null,
  p_write_id    uuid default null,
  p_status      text default null,
  p_wrote       text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.write_audit
    (user_id, operation, summary, target, source_page, pre_image, write_id, status, wrote)
  values
    (p_user_id, p_operation, p_summary, p_target, p_source_page, p_pre_image, p_write_id, p_status, p_wrote);
$$;

comment on function public.record_write(uuid, text, text, text, text, text, uuid, text, text) is
  'Records a write. Insert only — there is no function to amend or remove a '
  'row, deliberately. A pending row is recorded before a write and a done row '
  'with the same write_id after it.';

-- Both revokes; see 20260824130000 for why either alone is not enough.
revoke execute on function public.record_write(uuid, text, text, text, text, text, uuid, text, text) from public;
revoke execute on function public.record_write(uuid, text, text, text, text, text, uuid, text, text)
  from anon, authenticated;

-- One user's own record, newest first: what an undo reads. Bound to the user
-- by the caller, exactly as record_write is, and reachable only by the service
-- role — a log of what was written on someone's pages, with what it replaced,
-- is as private as the pages.
create function public.writes_for(
  p_user_id  uuid,
  p_since    timestamptz default null,
  p_write_id uuid default null,
  p_limit    integer default 200
)
returns table (
  at          timestamptz,
  operation   text,
  summary     text,
  target      text,
  source_page text,
  pre_image   text,
  write_id    uuid,
  status      text,
  wrote       text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select at, operation, summary, target, source_page, pre_image, write_id, status, wrote
  from public.write_audit
  where user_id = p_user_id
    and (p_since is null or at >= p_since)
    and (p_write_id is null or write_id = p_write_id)
  order by at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

comment on function public.writes_for(uuid, timestamptz, uuid, integer) is
  'One user''s write log, newest first. Read only. The undo reads it.';

revoke execute on function public.writes_for(uuid, timestamptz, uuid, integer) from public;
revoke execute on function public.writes_for(uuid, timestamptz, uuid, integer)
  from anon, authenticated;
