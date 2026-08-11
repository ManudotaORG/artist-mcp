-- Remove a signed-in user's Microsoft connection and every key that could
-- still address it. Keeping both deletes in one function makes disconnect
-- atomic: the account never lands in a half-disconnected state.
create function public.disconnect_microsoft()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;

  delete from public.mcp_keys
  where user_id = current_user_id;

  delete from public.connections
  where user_id = current_user_id
    and provider = 'microsoft';
end;
$$;

revoke execute on function public.disconnect_microsoft() from public, anon;
grant execute on function public.disconnect_microsoft() to authenticated;
