# 0018 — Undo, then unattended changes to a task row

Status: **steps 1–3 built and verified on hosted; step 4 open.** A build plan for the part of
[0015](0015-recovery-replaces-confirmation.md) the digest needs, written for
approval before any code. Builds on [0017](0017-appending-a-table-row.md), whose
server-built row is the pattern every step here reuses.

## Why

Ruben wants the record to stay current without him. Today the digest can add a
task, but when the mail shows that a task is done or its date has moved, it can
only list that *zu bestätigen*. Ticking a row or moving a date overwrites his
content, and 0015's rule is that such a write commits unattended only once this
tool can reverse it itself. Nothing can put a pre-image back yet. This plan
builds that recovery, then the one change that rests on it.

## What 0017 changes about 0015's plan

0015 planned undo as "replace the element with its pre-image". For a table that
is the whole table, so undoing one tick would also undo every cell Ruben edited
afterwards. 0017 showed a better unit: the server reads the table, touches one
row, and carries every other row across as OneNote returned it, checked
afterwards. Undo can work the same way:

- **Undoing an added row**: remove that row, if it still reads as it was written.
- **Undoing a changed row**: put that row's previous cells and tag back, if it
  still reads as the change left it.

Every other row is carried across, so an edit Ruben made in between, anywhere
else in the table, survives the undo. If he edited *that* row, the undo refuses
and shows what it would have restored — 0015's safe failure, at row level.

## Scope

**In:** OneNote task rows on pages this tool created — the CL Aufgaben pages,
under `onenote-edit` — and the lines the digest appends below a table.

**Out, for now:** 0015's calendar half (undoing an event edit, restoring a
deleted event). The digest does not touch the calendar, and it is separable;
it stays as 0015 describes it.

## The build, in four steps

Each step is verified before the next, and steps 1–3 ship in one promotion.

### 1. The write log records before the write, and can be read back

- **Two-phase for every OneNote write that has an undo**: a `pending` line,
  carrying a new `write_id` and the pre-image, is recorded *before* the write,
  and the write is refused if that record cannot be made. A `done` line with
  the same `write_id`, and what was written, follows the write. A pending line
  with no `done` is a write that may or may not have landed, and undo treats it
  by looking at the page, not by trusting the log.
- **Locally**: two lines in `~/.artist-mcp/writes.log`. A failed pending line
  throws before the write; a failed done line is still swallowed, as now,
  because the write happened.
- **Hosted**: a migration adds `write_id`, `status` and `wrote` to
  `write_audit`, keeping it strictly append-only — completion is a second row,
  not an update, as 0015 recommends. A function `writes_for(user, since,
  limit)` returns one user's own rows. Executable by the service role only:
  revoked from `PUBLIC`, `anon` and `authenticated`, since revoking from the
  last two alone is a no-op.
- **Every result names its `write_id`**, so the digest can print it beside each
  change, and Ruben, or a session, can undo by naming it.

**Built on 2026-11-23**, for the two writes that will have an undo: appending
a line and `append_row`. Each records a `pending` line with a `write_id`, the
pre-image and what it will write (`wrote`) before the write, is refused if that
fails, and records `done` after; results name their write ids. The local log
reads back with `readWriteLog`; hosted, `hostedWriteLog` reads through the new
`writes_for`. Verified:

- **Tests**: pending before the `PATCH` and nothing sent when it fails, on both
  paths; a failed done line still swallowed; the log read back newest first, by
  id and by date, skipping a torn line; the hosted sink's catch throwing for a
  pending record only. Each fails with its guard removed.
- **The migration on a real Postgres 16** (a throwaway local cluster, Supabase's
  default execute grant reproduced): the six-argument call the running
  deployment makes still works, two-phase rows go in, a bad status is refused,
  one `record_write` remains, `writes_for` returns one user's rows, and `anon`
  and `authenticated` are refused both functions.
- **Live, locally**: an `append_row` on the scratch page wrote its pending line
  two seconds before its done line, the `PATCH` between them, both carrying the
  table as it was and the row as written.

**Before this deploys, the migration has to be applied to production**:
hosted code that records a pending row against the old function would refuse
every append. Applied first, it is harmless to the running deployment.
**Applied on 2026-11-23** with `supabase db push`, after a dry run showed it was
the only migration production lacked. Checked in production: one
`record_write` with all nine parameters, `writes_for` present, both refused to
`anon` and `authenticated` and executable by `service_role`, the three columns
added, the 327 existing rows intact. The security advisors raised only a
pre-existing Auth warning (leaked-password protection off), nothing for these
functions. The checkout was unlinked afterwards.

### 2. `update_row`: a task row changed by the server

A new action on `edit_onenote_page`, built exactly like `append_row`:

- The caller names the table, the row (by its task text as `map_notes` returned
  it), and what to set: `done: true` to tick it, and cells by header name.
- The server reads the table, refuses one it cannot carry (0017's allowlist),
  refuses unless exactly one row matches, records the row and the table as
  they were, writes with `If-Match`, then reads back and checks that every
  other row is unchanged and the target row says what was set.
- **Ticking follows `policy:tasks`**: the tag becomes `to-do:completed`, and
  the status cell becomes the page's own word for done only where the caller
  gives it, never inferred.
- It keeps a preview and token until step 3 is verified live. Then it commits
  in one call, by 0015's rule.

**Built on 2026-11-23.** `update_row` on both edit tools: `element_id` (the
table), `row` (its task text), `done`, and `set` (cells by header name; never
the task text itself, and never an empty cell). It reuses `append_row`'s table
reading and refusals, rebuilds the one row from its cells in order (two cells
reading `UNKNOWN` have identical markup, so a string replace would change the
wrong one), swaps it in by position, records the table and the row before and
after as a pending line, writes with `If-Match`, and reads back: every other
row against its read, and the changed row cell by cell, since the written and
read-back forms differ in shape. A token from `preview_onenote_edit` is bound
to the row as previewed, so a row edited in between is refused. Tests copied
from the round trip's markup; removing the token check, the rebuild by
position, or the read-back check each fails a test. Live on the scratch page: a
tick and a Frist change, each previewed and confirmed, every other row
unchanged and an earlier tick intact, read back through tasks mode.

### 3. `undo_write`

- Takes a `write_id`, reads the entry from this install's own log (local file,
  or `writes_for` hosted), and reverses it:
  - an added row: removed, if it still reads as written;
  - a changed row: restored to its previous cells and tag, if it still reads
    as the change left it;
  - an appended line below a table: replaced with `<p></p>`, which 0015 found
    live removes the element entirely, if it still reads as written.
- Refuses when the target has changed since, and says what it would have
  restored. Refuses an entry whose write may not have landed until the page
  shows which it was.
- Is itself a two-phase, logged write. Undoing an undo is not offered at first.
- **The operation table changes**, deliberately, in the same commit:
  `undo_write` is a row with effect `write`, and `test/operation-boundary` is
  updated with it. It registers only with `onenote-edit`, and each undo checks
  the grant behind the original write. No new capability, so no migration
  clearing `write_grants`.

**Built on 2026-11-23.** `undo_write`, registered with `onenote-edit`, takes a
`write_id` and reverses an `append_table_row` (the row removed), an
`update_table_row` (the row restored from the table captured before the
change) or a single-paragraph `append_onenote_page` (replaced with `<p></p>`),
each found by what was written — cells and tick, or text and tag — and only
while exactly one still reads that way. Anything else is refused before the
page is read: an undo, an already-undone write (found by an undo whose `wrote`
names it), and every other kind of write. The undo is two-phase itself, with
`If-Match` and a read-back. The dispatcher is given the log reader — the file
locally, `hostedWriteLog` on hosted — and the operation table gains
`undo_write`, deliberately. The write-shaped-export guard had never seen
`appendRows` or `updateRow`, because `append` and `update` were not in its
pattern; they are now, with `undo` and `remove`, and `tasks.ts` is scanned.

Verified with tests made from real writes, each guard failing a test when
removed — the tick state in the row match, the already-undone check, the
line's tag — and **live, locally, on the scratch page**: a Frist change and a
tick undone; a tool-added row ticked by hand-proxy, its undo refused, then
allowed once the tick was undone; an appended line removed; a second undo of
it refused; an earlier tick intact through eight writes.

**Verified on hosted after #270**, through ChatGPT on the `Claude Test` scratch
page: a line appended and named as write `97f52d84…`, undone by that id ("Read
back: it is gone"), and a second undo refused as already undone. Production's
`write_audit` holds exactly the four rows that should exist — the append's
pending and done two seconds apart with what was written, and the undo's
pending and done, each with the removed paragraph as its pre-image and naming
the write it undoes — and none for the refusal.

**`update_row` dropped its token the same day**, by this record's own
condition. It commits in one call, with `If-Match` on its own read and the
read-back as before; a preview is still there to show the row before and after.
That does not let anything run unattended: the tool descriptions and
`policy:patch` still allow an automation only to add, until step 4. Live
locally: a tick with no token, verified, then undone by its write id.

### 4. The digest may tick and re-date, on explicit evidence

A pack change, once steps 1–3 are verified on hosted:

- An unattended run may **tick** a task, or **set its Frist**, through
  `update_row` — and nothing else. No rewording, no removal, no status word it
  was not given.
- **Only on explicit evidence in a thread read in full**: the person the task
  concerns confirms it is done or sent, or states the new date. Anything less
  stays *zu bestätigen*, as now. "Vermutlich erledigt" on a row, or a reply
  that merely exists, is not evidence.
- Each change opens the digest under *Über Nacht geschrieben*, with the mail it
  rests on and its `write_id`, so one sentence undoes it.

## What it costs

- One new tool (`undo_write`) and one new action, measured with
  `context-budget` before and after.
- About three OneNote requests per change (read, write, read back), and the
  same per undo.
- A hosted migration, additive and append-only.

## How it would be verified

- **Step 1**: a pending line refusing the write when it cannot be recorded; a
  done line following; the hosted function returning only one user's rows,
  and refused to `anon` and `authenticated` — each test failing with its guard
  removed. Live: a write on the scratch page, its two lines read back locally
  and on hosted.
- **Step 2**: request-level tests copied from the round trip's markup, like
  0017's; live on the scratch page, a tick and a date, every other row read
  back unchanged.
- **Step 3**: live on the scratch page, each kind undone; a row edited by hand
  after the write, and the undo refusing and showing the pre-image; then on a
  real CL Aufgaben page in a watched run.
- **Step 4**: a watched digest that ticks one task from a real confirming mail,
  then undone by its `write_id`.

## Decisions this needs

1. **Scope** — *decided 2026-11-23*: OneNote task rows now. The calendar half
   of 0015 waits, because its payoff is removing the calendar previews, which
   needs 0015's open question 3 decided with it; it adds no work to step 1.
2. **What step 4 may change unattended**: the tick and the Frist only?
3. **The evidence bar**: explicit confirmation in a thread read in full, as
   above?
4. **Removing a line this tool appended** — *decided 2026-11-23: yes, within
   these limits.* The tool may remove a row or line only if the write log holds
   it as this tool's own addition, by `write_id`, and it still reads exactly as
   written; one at a time, by that id; itself recorded with what it removed.
   Never a page, never anything Ruben wrote, never a tool-added row Ruben has
   since ticked or edited, and never anything recorded before the two-phase log
   (Essen's first lines included). This is not the deletion "deleting stays
   out" forbids: that rule exists because a page delete leaves nothing in the
   recycle bin, and this removal is recoverable from the log. `CLAUDE.md` says
   so.
5. **Pre-image retention on hosted**, 0015's open question 4: kept indefinitely
   for now, as today, or a limit?
