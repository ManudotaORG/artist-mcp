-- Disconnecting Microsoft deletes the OneNote entries of that user's write log.
--
-- docs/decisions/0019-retiring-the-previews.md, decision 4. Once the edit
-- previews are retired, write_audit's pre-images are the only way back for
-- every OneNote overwrite, and they are page content in plain text. The owner
-- decided they should not outlive the consent behind them: the mirror of
-- 20261125120000_forget_google_writes.sql, which Google's terms required and
-- this one nobody's terms do.
--
-- The rows to go are every row that is not a calendar row: each write this
-- tool can make is one provider's or the other's, and the undo of a OneNote
-- write is named `undo_` plus its operation. `not like '%calendar%'` is the
-- exact complement of the Google rule, so a disconnect of both leaves nothing
-- behind; the local log uses the same rule (audit.ts, isMicrosoftWrite).
--
-- The second removal from write_audit, and of the same kind as the first: the
-- person withdrawing their data. An undo is lost with it, and could not have
-- run without a Microsoft token anyway.

comment on table public.write_audit is
  'One row per write, append-only: nothing updates a row, and nothing removes '
  'one except the person''s own disconnect — Google deletes their calendar '
  'rows (forget_my_google_writes), Microsoft their OneNote rows '
  '(forget_my_onenote_writes).';

-- The signed-in user's own OneNote rows, deleted. Called by their disconnect;
-- takes no argument, so it cannot name anyone else. Security definer because
-- write_audit has RLS and no policies, like forget_my_google_writes.
create function public.forget_my_onenote_writes()
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
    and operation not like '%calendar%';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.forget_my_onenote_writes() from public, anon;
grant  execute on function public.forget_my_onenote_writes() to authenticated;

-- Otherwise as 20261125120000: the Microsoft branch also forgets the write log.
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
    perform public.forget_my_onenote_writes();
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
