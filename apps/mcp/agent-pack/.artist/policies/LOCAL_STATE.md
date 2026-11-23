# Local State

Use local state only when it helps the musician resume work without rereading
the same context. What is stored is connection credentials and a log of what
this tool wrote — with what each write replaced, so that it can be undone — and
nothing else: never agent memory, and no other copy of OneNote content.

## Storage boundary

- Store optional agent-owned working data only under `.artist/local/`.
- Treat local state as disposable and user-controlled. The workflow must still
  work when the directory is missing or deleted.
- Choose the smallest legible format for the job. Prefer Markdown for working
  notes and JSON for structured facts. Use SQLite only when the amount or shape
  of local data genuinely requires it.
- Keep short derived preferences, decisions, and resumable working summaries.
  Do not mirror entire OneNote pages, contact books, calendars, or message
  histories.
- Never store access tokens, refresh tokens, connection keys, environment
  variables, or other secrets in `.artist/local/`.

## No coordination infrastructure

Local state is not an agent coordination protocol. Do not create claims,
locks, queues, leases, assignments, review records, concurrency control, or
maintenance daemons. Roles are plain-language lenses loaded for one item at a
time.

The Auditor may assess an Envoy draft in the current chat, and the Janitor may
propose stale items for the musician to clear. Neither action creates a review
system or authorizes an external write.

## Nothing is kept here

All source facts are fetched from the current OneNote working-unit page. Show
the result in chat. What this tool may write, and when, is `policy:patch`'s,
under the grants the musician gave; sending, closing, deleting, and changing
connected applications stay theirs.

Where an install has been granted a write, it changes nothing about this
policy: a granted write is one action the musician asked for, or set an
automation to make, not
a store of state, a sync, or a system of record that lives here. Nothing is
remembered between sessions, and a calendar is not somewhere to keep track of
work.
