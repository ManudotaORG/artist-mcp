# 0015 — Recovery replaces confirmation

Status: **accepted; being built in parts.** Step 1's first move (an append
commits in one call) is built and verified on hosted, and the OneNote task-row
half is built by [0018](0018-undo-and-unattended-row-updates.md). The rest —
replaces, inserts and the calendar — is planned in
[0019](0019-retiring-the-previews.md). Originally written for review before any
code. Amends
[0004](0004-onenote-page-maintenance.md) (editing a page this tool created),
[0009](0009-confirm-by-reversibility.md) (confirm by what a write can destroy)
and [0013](0013-editing-any-calendar-event.md) (editing any calendar event), and
the paragraph in `CLAUDE.md` that begins "Confirmation follows what a write can
destroy". Nothing in it changes until it is accepted.

## Why

Three writes still need a preview and a confirmation token: `edit_onenote_page`,
`edit_calendar_event`, and deleting an event this tool did not create. Every
other write commits in one call since 0009.

The remaining three are friction exactly where the product is heading. The
musician wants the CL Aufgaben pages kept current by the tool rather than by
hand, because a page maintained manually drifts further the longer nobody has
time for it. Those pages are this app's own, so `onenote-edit` reaches them, but
every change to them is a preview, a token and a person saying yes — which a
scheduled task cannot do and a busy musician does not want to. The person this
is for has said, in effect, that they accept the risk.

0009 already contains the principle that resolves this. Its rule is "a write
that this tool can undo commits in one call", and it kept the edit preview for
one stated reason: "the pre-image in the write log is a recovery a musician
cannot perform in OneNote." The pre-image is captured and kept, locally and on
hosted. **Nothing can put it back.** The undo exists as data, not as something
the product can do.

So the proposal is not to accept more risk in the abstract. It is to make the
recovery real, and then let 0009's own rule move these writes to the side of
the line it already drew.

## What a preview does today

It is easy to read the preview as a person-shaped gate and nothing else. It does
four jobs, and only the first is friction.

1. **Puts the change in front of a person** before it is made.
2. **Guards against stale state.** The token binds the change *and* the
   pre-image. `applyEdit` re-reads the page, resolves the target again, and
   refuses if what it would overwrite differs from what was previewed; the
   page's ETag then goes out as `If-Match`, so the musician typing in OneNote
   between the two calls is a refusal rather than a silent overwrite. The
   calendar token binds the event's etag the same way (0013).
3. **Delivers the house markup for a OneNote table** — `preview_onenote_edit`'s
   output carries it, one call before the markup is composed (see "A rule the
   tool applies" in `CLAUDE.md`).
4. **Shows a deleted event in full** before it goes.

Jobs 2–4 have to survive the preview. Only job 1 is being retired.

## The decision

**A write may commit in one call when this tool can reverse it itself.**
"Can reverse it itself" means a tool call, not data a person would have to
reassemble by hand. Where that is not yet true, the preview stays.

### 1. The pre-image is saved before the write, or there is no write

Today the audit line is written after the write, and a failed record is
swallowed on purpose (`hostedAudit`, and the local sink alike): the write has
already happened, and reporting it as failed would invite a duplicate. That is
right while a person confirms every destructive write. It is wrong once the log
is the only way back — a replace whose pre-image failed to save is a write with
no undo, which is the exact thing this record exists to prevent.

So destructive writes become two-phase: the pre-image is recorded as pending
before the write, and the write is refused if that record cannot be made; the
line is completed with what was written once the write returns. A pending line
with no completion is a write that may or may not have landed, and undo treats
it as such — by looking at the target, not by trusting the log.

Non-destructive writes keep today's order. Recording an appended line before it
exists buys nothing, and the reason the order was changed once (an audit line
for a write that then failed) still holds for them.

### 2. Stale-state guards stay, without a person

- **OneNote.** `read_note` already returns the element ids an edit needs. Each
  part also gets a short fingerprint of its current content, and a replace
  carries the fingerprint of what it means to overwrite. `applyEdit` re-reads,
  compares, and sends the page ETag as `If-Match`, exactly as now. A page that
  moved since it was read is a refusal with the current content, not an
  overwrite.
- **Calendar.** `edit_calendar_event` and deleting another's event take the
  etag the caller read, and send it as `If-Match`. Google answers 412 for an
  event that changed; that is already how the commit path works.

This is job 2 of the preview, kept whole. It never needed a human.

### 3. An undo tool

`undo_write` takes an entry from this install's write log — locally the file,
hosted the user's own rows — and reverses it. It refuses when the target has
changed since this tool wrote it, and says what it would have restored, so an
undo can never destroy an edit the musician made in between. The undo is itself
a write: logged, with its own pre-image, and undoable.

| Write | Undo | Status |
| --- | --- | --- |
| Replace a OneNote element (incl. a whole table) | Find the element by what was written — generated ids move after any page update, so the id alone is not enough — and replace it with the pre-image | Buildable now |
| Edit a calendar event | Patch the previous fields back, `If-Match` on the etag the edit produced | Buildable now |
| Create a calendar event | `delete_calendar_event`, which exists | Exists |
| Delete an event this tool did not create | Patch the cancelled event's `status` back to `confirmed`: verified live to restore it with its id and details, while Google still retains it | Buildable now |
| Append or insert on a page | Replace the added element with `<p></p>`: verified live to remove the element entirely, leaving no empty line | Buildable now — for a paragraph; see open question 1 |
| Create a OneNote page or section | Not undoable by this tool; `Notes.Create` cannot delete | Unchanged: removed by hand |

The two open rows decide scope, not direction. A write whose undo is not built
keeps its current behaviour until it is.

### 4. The table rule moves into the edit

The house markup for a table is enforced where it is broken: an edit whose table
markup departs from it is refused, and the refusal carries the shape. That is
sent once, when a table is actually being written wrong — the same economics
`CLAUDE.md` asks of any rule moved into output, and cheaper than the preview,
which paid for it on every table edit.

### 5. The result carries what the preview used to

Each committing result says exactly what changed, before and after, and the
write-log entry that undoes it. A deleted event's result shows the whole event.
This is the move 0009 made for the other writes, for the same reason: a wrong
write is visible in the message that reports it.

### 6. Then the previews go

`preview_onenote_edit` is removed. `edit_onenote_page`, `edit_calendar_event`
and `delete_calendar_event` take no `confirmation_token`. Each class goes only
once its undo (3) and guard (2) are built and verified live — a write keeps its
preview until then.

## Order

1. Two-phase recording, the hosted migration, and a way to read the log back.
2. Fingerprints and etag guards on the commit paths.
3. `undo_write` for the two buildable rows, verified live on a CL Aufgaben page
   and a hand-made event.
4. The table rule into the edit.
5. Remove the previews and tokens, one class at a time.

Ship order matters more than anything else here. Previews removed before undo
exists would mean accepting the risk without the recovery that justifies it.

One step can go first, and [0014](0014-tasks-on-map-notes.md) depends on it: an
**append** to a page commits in one call. It destroys nothing, so 0009's rule
already allows it, and the token `edit_onenote_page` asks for on an append today
is friction rather than protection. Replaces and inserts keep the token until
steps 1–3 are done.

**Built on 2026-11-21, and verified on hosted after #261** (through ChatGPT, on
a scratch page in `Claude Test`). `edit_onenote_page` takes `confirmation_token` only
when a change is a replace or an insert; a change made only of appends commits
in one call, and a batch mixing an append with either still needs the token as
a whole. An append also no longer reads the page first: the read captured a
pre-image and an ETag, and an append has neither to protect, so it cost one of
the musician's OneNote requests for nothing. The cost of that, accepted by the
owner until it is seen to happen: a caller retrying after a timeout in which the
write landed appends the line twice, and nothing in the tool notices. The result
carries what was added and that it is removed by hand in OneNote, as 0009 asks of
every one-call write. Existing `onenote-edit` grants were kept rather than
cleared, by the owner's decision — the same exception 0009 made, for the same
reason, and not a precedent. The custom pack's `policy:patch`, which shadows the
bundled one on hosted, says the same, and goes one step further for 0014: in an
automation the musician set up, the CL Aufgaben page `list_notes` names is the
only page written to, and only by appending, each line with its source. Anything
that would change an existing line goes into the result to be confirmed.

**Its OneNote half has a build plan**: [0018](0018-undo-and-unattended-row-updates.md),
proposed on 2026-11-23, which undoes at the level of one table row rather than
a whole table, following 0017.

The rest — replaces, inserts and the calendar previews — is planned in
[0019](0019-retiring-the-previews.md), proposed on 2026-11-23.

## What has to change, and what does not

- **The hosted table.** `write_audit` is insert-only, exposes nothing, and has
  no column for what was written or the etag a write produced. A migration adds
  them, a status for pending lines, and a function returning one user's own
  rows. The "nothing amends a row" rule needs one narrow exception — completing
  a pending line — or a second, completing row instead; the second keeps the
  table strictly append-only and is the better default.
- **The operation table.** `undo_write` is a row with effect `write`, so
  `test/operation-boundary` changes deliberately, in the same commit.
- **Grants.** No new capability. `undo_write` registers when an install holds a
  grant whose writes it can reverse, and each undo checks the grant behind the
  original write. Because `WRITE_CAPABILITIES` does not change, no migration
  clearing `write_grants` is needed — the rule in `CLAUDE.md` applies to a new
  capability, and this is not one.
- **The tool list.** Smaller: 0009 measured `preview_onenote_edit` alone at
  4,301 characters on every request, against one new tool. Measured with
  `context-budget` before and after.
- **Unattended writes.** A scheduled task may edit, which is the point. 0009's
  rule for automations ("setting up the automation is the decision; the result
  is still reported back") covers it unchanged.

## What this knowingly accepts

- **A wrong edit is seen before it is reversed.** On a CL Aufgaben page that is
  the musician noticing; on a calendar others watch, they may see it first. 0009
  named the shared calendar as the case for a stronger gate and accepted it for
  creates; this accepts it for edits.
- **Restores are content, not bytes.** OneNote rewrites what it stores
  (`audit.ts` says so), so a restored paragraph returns with its words and
  structure, not its exact markup.
- **An undo can be refused.** If the musician edited the same element after the
  tool did, undo will not overwrite them, and the pre-image is shown for a
  person to merge. That is the safe failure, and it will happen.
- **Pre-images are content held server-side on hosted.** Already true since
  0004's migration; this makes them used rather than merely kept. Retention is
  currently unlimited.

## What would reverse it

- An unattended edit that was wrong, acted on before anyone noticed, and cost
  something real. The answer 0009 named stands: a person in the loop, for that
  class of write.
- Undo refused often enough in practice that it is not a recovery anyone can
  rely on.
- MCP gaining a way to put a question in front of a person rather than a model.
  A real gate is better than a recovery, and should come back where it matters.

## How it would be verified

- Request-level tests for each guard: a stale fingerprint refused, a 412 not
  retried, a failed pending record refusing the write, an undo refused when the
  target moved — each failing with the guard removed.
- Live, on a CL Aufgaben page: replace a table, undo it, confirm the rows match
  the pre-image; edit the page by hand after a tool write and confirm the undo
  refuses and shows the pre-image.
- Live, on a hand-made calendar event: edit, undo, and confirm the fields and
  the absence of any email.
- On hosted, the same, reading the log back through the new function.

## Open questions

What the providers document, checked on 2026-11-21:

- **OneNote** ([Update OneNote page content](https://learn.microsoft.com/en-us/graph/onenote-update-page)):
  the PATCH actions are `append`, `insert`, `prepend` and `replace` — there is
  no delete. `replace` targets `p`, `li`, `h1`–`h6`, `ol`/`ul`, `table` and a
  `div` inside a div, by generated id only (`tr` and `td` cannot be replaced,
  the whole table can). Generated ids "might change after a page update". What
  replacing an element with empty content leaves behind is not documented.
- **Google Calendar** ([Events](https://developers.google.com/calendar/api/v3/reference/events)):
  a deleted event becomes `status: cancelled`, is always returned by `get`, and
  "will eventually disappear", with no period stated. On the organizer's
  calendar it keeps its details "so that they can be restored (undeleted)", but
  no call for doing so is documented, and there is no trash API. `scope.md`
  already records, from a live run, that inserting an event with a deleted
  event's id fails while it sits in the bin — so a recreation needs a new id.

Then tested live on 2026-11-21, on items this tool created for the purpose:

- **OneNote**, on a scratch page in the `test` notebook: a paragraph appended to
  the body, then replaced. Replacing it with empty content is refused — `400`,
  error `20121`, "The PATCH argument $content: is invalid." Replacing it with
  `<p></p>` removed the paragraph entirely: the page read back with only its
  original paragraph and no empty line where the appended one had been.
- **Google Calendar**, on a scratch event on `primary` with no guests: deleted
  through `delete_calendar_event`, read back as `cancelled` with its details,
  then patched to `status: confirmed` with `sendUpdates=none`. It came back with
  the same id, summary and time, a new etag, and in the ordinary event list.
  Deleted again afterwards.

1. **Undo of append and insert — mostly settled.** Removing an appended
   paragraph works. Not yet tested: an appended list item, heading or table, and
   an insert inside a table cell. And it still has to be said explicitly that
   removing an element this tool itself added is not the page deletion
   "deleting stays out" refers to.
2. **Restoring a deleted event — settled for this case.** It works while Google
   retains the cancelled event, which it documents only as "eventually"; the
   undo must say so and fall back to recreating from the logged event under a
   new id once the original is gone. Not tested: an event with guests, or on a
   calendar shared with others.
3. **Whether any class keeps a preview anyway.** Events on calendars other
   people actively work from are the candidate.
4. **Retention of pre-images** on hosted, now that they are a working undo rather
   than a record.
