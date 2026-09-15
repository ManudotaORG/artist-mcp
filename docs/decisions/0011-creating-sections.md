# 0011 — Creating sections

Date: 2026-09-15

## Decision

A new write capability, `onenote-create-section`, registers one tool,
`create_onenote_section`. It creates one empty section in a notebook named from
the live notebook list with its `notebook_key`.

## Why

- **Ruben asked for it.** A project in this notebook is a section, so starting a
  new project means creating one.
- **Testing:** it lets a test account go past 100 sections, which is how the
  section-listing paging bug fixed in #234 can be checked on real data.

## Boundary

- **The same provider boundary as [0003](0003-onenote-writes.md).** `Notes.Create`,
  which `onenote-create` already requests, can create a section and cannot rename
  or delete one. No new Microsoft permission is needed and no reconnect.
- **The code's own limits:**
  - one section per call, with no bulk form
  - no retry, since a 5xx does not say whether the section landed
  - a name already used in that notebook is refused
  - names OneNote would reject are refused before sending
  - every creation is written to the audit log

## A capability of its own

A grant to add pages should not quietly come to mean adding structure to a
notebook, so this is not folded into `onenote-create`.

## Existing grants carry over

Earlier capabilities came with a migration clearing `write_grants`
(`20260828120000`, `20260831120100`), so everyone re-answered the question. This
one does the opposite. `20260915120000_grant_create_section_to_page_creators.sql`
adds `onenote-create-section` for every hosted user who already holds
`onenote-create`, so they can create sections without re-granting.

- **Consent:** creating a section is within `Notes.Create`, which those users
  already agreed to for page creation, and it is equally irreversible by this
  tool. The owner of this invite-only deployment decided that is close enough.
- **Scope:** users without a OneNote write grant gain nothing. Local installs
  name capabilities in `--allow-writes`, so none gets it without adding it.
- **Users who switch writes on later** get it through the switch, which grants
  every capability in `WRITE_CAPABILITIES`.

**Not a precedent.** A capability that widens what a permission can do, or that
can change or destroy something, still clears grants. Revisit this one before
hosted opens beyond invited users.

## Cost

- **Cleanup is manual.** A section created by mistake can only be removed in
  OneNote by hand.
- **The tool list grows by one tool**, so clients see it after a refresh.
