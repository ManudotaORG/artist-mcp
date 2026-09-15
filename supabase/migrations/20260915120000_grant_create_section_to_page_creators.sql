-- Give `onenote-create-section` to every user who already granted
-- `onenote-create`, without asking them to switch writes off and on.
--
-- Earlier capabilities cleared all grants instead (20260828120000,
-- 20260831120100), because each widened what a Microsoft permission let the
-- tool do. This one does not: creating a section is within `Notes.Create`,
-- which those users already consented to for page creation, and like a page it
-- cannot be renamed or deleted by this tool. The owner of this invite-only
-- deployment decided that is close enough to carry the existing consent over.
--
-- Only users holding `onenote-create` gain it. Nobody without a OneNote write
-- grant is affected, and local installs name their capabilities by hand.
-- See docs/decisions/0011-creating-sections.md.

insert into public.write_grants (user_id, capability)
select user_id, 'onenote-create-section'
from public.write_grants
where capability = 'onenote-create'
on conflict (user_id, capability) do nothing;
