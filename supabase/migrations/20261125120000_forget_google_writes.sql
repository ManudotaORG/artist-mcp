-- Disconnecting Google deletes the calendar entries of that user's write log.
--
-- docs/decisions/0022-google-requires-mcp-for-agents.md, step 1. Google's
-- Workspace AI Tools Addendum (24.11.2026), 2(d): no retaining user data
-- obtained through the tool after it has been disconnected or its access
-- revoked. write_audit keeps calendar content in plain text — what an event
-- said, and for an edit what it said before — and a Google disconnect used to
-- delete only the connection.
--
-- The rows to go are the calendar writes: every Google write this tool can make
-- is one, and Gmail is read-only here. `operation like '%calendar%'` rather than
-- a list, so a calendar operation added later is covered without remembering
-- this file; the local log uses the same rule (audit.ts, isGoogleWrite).
--
-- This is the first delete from write_audit, which until now promised that
-- nothing removes a row. The promise was about the tool editing its own record;
-- this is the person withdrawing their data, which the record does not outrank.
-- An undo of a calendar write is lost with it, and could not have run without a
-- Google token anyway.

comment on table public.write_audit is
  'One row per write, append-only: nothing updates a row, and nothing removes '
  'one except the person''s own Google disconnect, which deletes their calendar '
  'rows (forget_my_google_writes).';

-- The signed-in user's own calendar rows, deleted. Called by their disconnect;
-- takes no argument, so it cannot name anyone else. Security definer because
-- write_audit has RLS and no policies, like forget_my_task_view.
create function public.forget_my_google_writes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := (select auth.uid());
  removed integer;
begin
  if me is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  delete from public.write_audit
  where user_id = me
    and operation like '%calendar%';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.forget_my_google_writes() from public, anon;
grant  execute on function public.forget_my_google_writes() to authenticated;

-- Otherwise as 20261124120000.
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

  if p_provider = 'google' then
    perform public.forget_my_google_writes();
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
