-- Generalise disconnect to any provider.
--
-- disconnect_microsoft() deleted every key the user had, which was right while
-- Microsoft was the only connection: no connection meant no key could address
-- anything. With a second provider that reasoning inverts. One key addresses
-- whichever providers are connected, so dropping Google must not revoke the
-- key that still reaches OneNote.
--
-- The rule that survives both cases: a key outlives any single disconnect and
-- dies with the last connection.

create function public.disconnect_provider(p_provider text)
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

  select count(*) into remaining
  from public.connections
  where user_id = current_user_id;

  -- Last connection gone: the key can no longer reach anything, so it goes
  -- with it rather than lingering as a credential that resolves to nothing.
  if remaining = 0 then
    delete from public.mcp_keys
    where user_id = current_user_id;
  end if;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function. Revoking from anon
-- and authenticated alone leaves PUBLIC intact and the revoke does nothing.
revoke execute on function public.disconnect_provider(text) from public, anon;
grant  execute on function public.disconnect_provider(text) to authenticated;

-- disconnect_microsoft() stays as a thin delegation. Deployed web copies keep
-- calling it through their own release cycle, exactly as installed npm copies
-- keep calling /v1/.
create or replace function public.disconnect_microsoft()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.disconnect_provider('microsoft');
end;
$$;

revoke execute on function public.disconnect_microsoft() from public, anon;
grant  execute on function public.disconnect_microsoft() to authenticated;
