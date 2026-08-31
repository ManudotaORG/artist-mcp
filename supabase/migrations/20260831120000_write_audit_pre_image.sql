-- Keep what a page edit overwrote, or hosted has no undo at all.
--
-- docs/decisions/0004-onenote-page-maintenance.md reopened replacing a OneNote
-- element, which 0003 had ruled out permanently, and it turns on one thing:
--
--   "The undo is not a feature attached to replace; it is the reason replace
--    is permissible."
--
-- OneNote keeps no version of a page and a Graph write leaves nothing in the
-- notebook's recycle bin, so the content an edit overwrote exists nowhere else
-- the moment the PATCH returns 204. The published package keeps it in
-- ~/.artist-mcp/writes.log. Without this column the hosted service would accept
-- the same destructive operation and discard the only copy — not a weaker undo
-- than the local one, but none, which is precisely the state 0003 refused to
-- ship and 0004 only escaped by having a pre-image to point at.
--
-- The same reasoning as this table's original note, one step further: a wrong
-- delete leaves a gap nobody notices, and a wrong replace leaves text that
-- looks as deliberate as what it displaced.
--
-- Held as the element's HTML rather than its text, because restoring it means
-- writing it back. It restores content and not bytes: OneNote rewrites the
-- markup it stores, so a restored paragraph returns carrying its words and not
-- its original markup.

alter table public.write_audit add column pre_image text;

comment on column public.write_audit.pre_image is
  'For a replaced OneNote element: exactly what stood there beforehand. Null '
  'for every operation that destroyed nothing. This is the only copy.';

-- Dropped and recreated rather than replaced with a defaulted sixth parameter.
-- `create or replace` cannot change a signature, so adding the argument would
-- leave two overloads resolvable by the same named-argument call and PostgREST
-- picking between them.
drop function public.record_write(uuid, text, text, text, text);

create function public.record_write(
  p_user_id     uuid,
  p_operation   text,
  p_summary     text,
  p_target      text,
  p_source_page text default null,
  p_pre_image   text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.write_audit (user_id, operation, summary, target, source_page, pre_image)
  values (p_user_id, p_operation, p_summary, p_target, p_source_page, p_pre_image);
$$;

comment on function public.record_write(uuid, text, text, text, text, text) is
  'Records a write that has already happened. Insert only — there is no '
  'function to amend or remove a row, deliberately. p_pre_image carries what a '
  'replace overwrote, and is the only copy of it.';

-- Both revokes; see 20260824130000 for why either alone is not enough.
revoke execute on function public.record_write(uuid, text, text, text, text, text) from public;
revoke execute on function public.record_write(uuid, text, text, text, text, text)
  from anon, authenticated;
