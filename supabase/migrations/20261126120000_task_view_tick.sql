-- Ticking a task from the hosted task view (docs/decisions/0023).
--
-- After a tick or its undo, the view re-reads that one page so the task shows
-- as done, or open again, without a whole refresh. Until now a page entered
-- the snapshot only through store_task_pages, during a refresh claim and only
-- if the claim's own listing left it pending — which is what keeps a browser
-- from putting a page into it. That rule stands: this function replaces the
-- tasks of a page **already in this user's snapshot**, and nothing else. It
-- cannot add a page, and it keeps the notebook, section, title and links the
-- last listing set.
--
-- It takes no claim and is not counted against the refresh cooldowns. It is
-- called only by the tick and undo server actions, after a write, with the
-- server's own read of the page.
--
-- Service role only, with both revokes (docs/operations.md, "The grants trap").

create function public.store_task_page(
  p_user_id uuid,
  p_key     text,
  p_page_id text,
  p_tasks   jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored integer;
begin
  -- A read that failed is never stored over a good copy: the older one stays,
  -- labelled by its own read_at.
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'object' then
    return 0;
  end if;
  update public.task_view_pages
     set tasks   = extensions.pgp_sym_encrypt(p_tasks::text, p_key),
         read_at = now(),
         error   = null
   where user_id = p_user_id and page_id = p_page_id;
  get diagnostics stored = row_count;
  return stored;
end;
$$;

revoke execute on function public.store_task_page(uuid, text, text, jsonb) from public;
revoke execute on function public.store_task_page(uuid, text, text, jsonb) from anon, authenticated;
grant  execute on function public.store_task_page(uuid, text, text, jsonb) to service_role;

comment on table public.task_view_pages is
  'A display copy of CL Aufgaben pages for the hosted task view (0020). Never '
  'a source for a write: a tick (0023) names its task from here and builds the '
  'write from a fresh read of the page. Task text encrypted with the per-call key.';
