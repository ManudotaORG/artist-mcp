# 0019 — Retiring the previews

Status: **proposed, decisions taken 2026-11-25 for the OneNote half (steps
0–4); not built.** The calendar half (steps 5–6) is deferred to
[0022](0022-google-requires-mcp-for-agents.md). A build plan for the rest of
[0015](0015-recovery-replaces-confirmation.md), written for approval before any
code. It follows [0018](0018-undo-and-unattended-row-updates.md), which built
the write log, `undo_write` and the server-built row that every step here
reuses. Amends 0004, 0006, 0009 and 0013 where they require a preview, and the
paragraph in `CLAUDE.md` that begins "Confirmation follows what a write can
destroy". Nothing in it changes until it is accepted.

## Why

The owner wants to move away from previews in general (2026-11-23). 0015
already says how: a write commits in one call once this tool can reverse it
itself, and keeps its preview until then. Appends, `append_row` and `update_row`
crossed that line in 0015 and 0018. Three classes are left:

| Write | Preview today | Logged today |
| --- | --- | --- |
| OneNote **insert** | `preview_onenote_edit`, then a token | after the write, no pre-image (nothing destroyed) |
| OneNote **replace**, a whole table included | `preview_onenote_edit`, then a token bound to the pre-image | after the write, pre-image kept |
| Calendar **edit** (`edit_calendar_event`) | a first call returns a token bound to the etag | after the write, pre-image kept |
| Calendar **delete of an event this tool did not create** | a first call shows it and returns a token | after the write, pre-image kept |

All four log *after* the write, in the single-phase form 0018 replaced for the
other writes. A replace whose log line fails today still lands, and its
pre-image is then nowhere. That is tolerable while a person confirms each one;
it is the first thing to fix once nobody does.

Retiring them also shrinks the tool list, which every request pays for:
`preview_onenote_edit` goes entirely, and three tools lose their token
parameter and the text explaining it. Measured with `context-budget` before
and after.

## What does not change

- **Unattended stays as 0018 left it.** A scheduled run may append, add a row
  with `append_row`, and set a Frist a mail states. It never ticks, never
  replaces, never inserts, never edits or deletes an event. Removing a preview
  removes a step between a person and a write; it is not a widening of what
  runs without a person. `policy:patch` and `role:digest` keep saying so.
- **Which pages and events can be reached.** `Notes.ReadWrite.CreatedByApp`
  still limits edits to this tool's own pages, and invitations from others and
  whole recurring series are still refused.
- **No page is ever deleted.** `undo_write` removes only what this tool added
  and only while it reads as written (0018, decision 4).
- **Grants.** No new capability, so no migration clearing `write_grants`.

## What replaces each job of the preview

0015 listed four jobs. Only the first is retired.

1. **Putting the change in front of a person** — retired. In a conversation,
   the musician's request is the yes: "set the Honorar to 1450" is done and
   reported, not shown and asked about. The model asks first only when it is
   deriving a change nobody asked for — a value it read in a mail, a tidy-up it
   thinks is due. That is a rule for the model, and lives in `policy:patch`.
   The result says what changed, before and after, and the `write_id` that
   undoes it, which is 0009's rule for every one-call write.
2. **Guarding against stale state** — kept, without a person. See step 2.
3. **Delivering the house table markup** — moved into the edit. See step 4.
4. **Showing a deleted event in full** — moved into the result, which shows the
   whole event and its `write_id`.

## The build, in six steps and a move

OneNote first (steps 0–4), then the calendar (steps 5–6). Each step is verified
before the next; steps 0–4 ship in one promotion, 5–6 in another. **Only steps
0–4 are in this round** (decision 5); 5–6 are kept below as written, to be
re-planned against Google's MCP servers once 0022's spike can run.

### 0. Split `onenote-patch.ts` first, changing nothing

`onenote-patch.ts` is 2,627 lines and three modules in one file: element
editing and its helpers (to about line 1,700), task rows (`appendRows`,
`updateRow`, `previewRowUpdate`, `readTaskTable`, `asWritten`), and
`undoWrite`. Steps 1–4 add 300–500 lines of the most security-sensitive code
here — recording before a replace, `expect`, two more undo kinds — and they
should land where a reviewer can read them, not at line 2,400.

The layering is already clean: rows and undo use the editing helpers (18 and 16
of them), and almost nothing points the other way — `cellsOf`, which rows also
use, moves to the core. So the split is a move:

- `onenote-patch.ts` keeps the core and `applyEdit`, which routes to the others;
- `onenote-rows.ts` takes the task-row functions;
- `onenote-undo.ts` takes `undoWrite`, importing from both.

One commit, before step 1, with no behaviour change: the suite passes
unchanged, and `test/operation-boundary`'s sanctioned `file:function` entries
move with the functions, in the same commit, as that guard requires. Done only
as part of this build — on its own it is churn in security code. Found through
the graphify rebuild on 2026-11-23, where these five functions are five of the
eight the docs cite most.

**Done on 2026-11-25.** `onenote-patch.ts` keeps the core and the two routers
(1,811 lines), `onenote-rows.ts` has the task rows (557) and `onenote-undo.ts`
has `undoWrite` (261). `cellsOf` moved to the core as planned. The core
imports the row functions it routes to, so the core and the row module import
each other; that is safe because neither uses the other's exports while
loading, only inside functions. `dispatch.ts` imports `undoWrite` from its
new module, and only that import line changed. The suite passes (755 tests),
with only the import lines of three test files changed. The boundary guard
scans both new files, and its sanctioned entries moved with the functions.

### 1. Replace and insert record before they write

The two-phase form from 0018: a `pending` line with the pre-image and what will
be written, keyed by `write_id`, before the `PATCH`; refused with
`UnrecordedWriteError` if that line cannot be made; a `done` line after. A
batch is one pending line per change, as the log is per element today. `wrote`
carries the element as sent, so undo can find it by content.

In the same step, a Microsoft disconnect forgets that user's OneNote rows —
hosted through a migration alongside `forget_my_google_writes`, locally in
`artist-mcp disconnect microsoft` — because the log is about to become the
only way back and should not outlive the consent behind it (decision 4).

**Built on 2026-11-25.** A replace, an insert, and an append in a batch with
either now record a `pending` line per change, before the `PATCH`. Each line
carries its own `write_id`, the pre-image (a replace only) and `wrote`, the
element as sent. If any of those lines cannot be made, nothing is sent. A
`done` line follows each one, and the result names the write ids. The token
is unchanged until step 2. Tests check the order (pending, `PATCH`, done)
and that nothing is sent when the pending line fails, for both a replace and
an insert; each fails with the pending line moved after the `PATCH`. Two
older tests that counted one line per change now count pending and done.

The disconnect half: `forgetMicrosoftWrites` removes every line that is not
a calendar line from the local log, on `artist-mcp disconnect microsoft`, the
undo of a OneNote write included. Migration `20261125130000_forget_onenote_writes.sql`
adds `forget_my_onenote_writes()` and a Microsoft branch to
`disconnect_provider`. Exercised on a throwaway Postgres 16 with every
migration applied and Supabase's default grants reproduced:
- a Microsoft disconnect removed exactly one user's three OneNote rows,
  leaving their calendar row and another user's rows;
- a Google disconnect then removed the calendar row;
- `anon` is refused the function, and a caller with no user is refused too.

The custody test now reads whichever migration defines `disconnect_provider`
last, and requires both branches there; it fails with the Microsoft line
removed. **Not yet applied to production.** The deployed code does not
depend on it, so it can go in before or after the deploy, but the decision is
not true on hosted until it does.

### 2. The stale-state guard without a token

Today the token binds the captured pre-image, so a page Ruben edited between
the preview and the commit is refused. Without a token, the commit path does
the same thing against what the *caller* read:

- `read_note` already returns the element ids an edit needs. A replace also
  names what it means to overwrite: `expect`, the element's text as read.
  `applyEdit` re-reads the page, compares the target's text with `expect`
  (whitespace-normalised), and refuses with the current text if they differ.
  The page ETag still goes out as `If-Match`.
- For a whole table, `expect` is its rows as read, compared cell by cell — the
  same comparison `update_row`'s read-back already does.
- An insert names its anchor's text the same way, so it cannot land beside the
  wrong element after the ids moved.

This is preferred over 0015's fingerprints because the caller already holds the
text and nothing is added to `read_note`, whose element index has already once
cost more than it saved. If `expect` turns out to cost too much on large tables,
a fingerprint per table is the fallback, measured first.

**Built on 2026-11-25, alongside the token rather than in place of it.** The
token stays required until step 4, because 0015 says the previews go only
once undo exists (step 3). Until then `expect` is optional and, when given,
checked. In step 4 it becomes required.

`edit_onenote_page` takes `expect` on a single change and on each change in
a batch. For a paragraph, heading or list item it is the element's text as
read. For a table, or an insert anchored on one, it is the table's rows, each
a list of cell texts. The re-read page is compared with whitespace collapsed,
and a line break inside a cell counts as a space. Any difference refuses the
whole batch, with what each moved element says now. The shape is checked
against the target: an append refuses an `expect`, a table refuses a string,
and a paragraph refuses rows. `expect` is outside the token, so a preview
made without it still confirms. The preview checks it too, but its tool
schema does not take it, and the preview tool goes in step 4.

Tests (`edit-expect.test.mjs`) hold the token fixed and vary only `expect`,
so the token cannot be what catches the change:
- a paragraph, a whole table and an insert anchor are each refused when they
  have moved;
- a table that has lost a row is refused;
- a batch is refused whole, naming only the change that moved.

Each refusal test fails with the check disabled. The tool list grew by a few
hundred characters, the `expect` parameter on one tool; the before-and-after
measurement is taken across the whole promotion in step 4.

### 3. `undo_write` for inserts and replaces

- **Insert**: remove the inserted element by what was written, exactly as an
  appended line is removed today — one match required, still reading as
  written. Verified for `p` and headings; a list item and a table are tested
  live before they are allowed, and refused until then.
- **Replace of an element**: find the element by what was written, and replace
  it with the pre-image. Refused if it no longer reads as written, or matches
  more than once.
- **Replace of a whole table**: the table goes back to its pre-image, only if
  every row still reads as the replace left it. An edit Ruben made anywhere in
  that table afterwards makes the undo refuse and show what it would have
  restored. That is coarser than a row undo, and is the reason task tables keep
  using `append_row` and `update_row`.

Each undo is itself two-phase and recorded, as in 0018. A restore returns words
and structure, not exact markup (0015).

**Built on 2026-11-25, and verified live locally the same day.** `undo_write` now reverses
`insert_onenote_element` and `replace_onenote_element`, besides 0018's three
kinds:
- **Insert:** a single paragraph or heading is found by its text and to-do
  tag, outside any table, and replaced with `<p></p>`, as an appended line
  is. An inserted table, list or run of elements is refused as removed by
  hand.
- **Replace:** the element is found by what was written (`wrote`, recorded
  in step 1): a paragraph or heading by its text, a table by its rows cell by
  cell. It is then replaced with the pre-image, with its old `id` and
  `data-id` stripped. A table pre-image is normalised as `append_row` writes
  one, and refused if it holds something that isn't carried. A pre-image this
  tool would not write is not restored; the refusal shows its text for a
  person to put back.

Both read back by content, since the restored element has a new id. Both
are refused, with nothing sent and nothing recorded, when the target no
longer reads as written or matches more than once. Each undo is two-phase,
and its pending line keeps what the undo overwrites. The already-undone and
undo-of-an-undo refusals apply unchanged. Results and the tool text now say
a replace is put back by `undo_write`, instead of "only in this install's
write log".

Tests (`undo-edit.test.mjs`) make each write through the real edit path and
undo it against the page as OneNote returns it, with new ids. They cover a
paragraph and a table put back, each refused after a later edit, a duplicate
refused, an insert removed, an inserted table refused, an unwritable
pre-image shown rather than restored, and a second undo refused. Four fail
with the content match removed. One 0018 test used a replace as its example
of a kind that cannot be undone; it now uses a created page, which never can
be.

**Live, locally, on `artist-mcp live test 0009 (delete me)`**, driving the
rebuilt dispatcher with the owner's Microsoft connection. Each step was read
back through `read_note`, and each result reported `verified: true`.
- **Paragraph:** a paragraph appended, replaced (1200 → 1400) with `expect`,
  and undone: it read 1200 again.
- **Insert:** a line inserted after it, then undone, and it was gone.
- **Table:** a two-row non-task table appended, replaced whole (1200 → 1450)
  with `expect` as rows, and undone: it read 1200 again.
- **Edited since (by proxy):** one replace (1200 → 1500), a second on top of
  it standing in for the musician's own edit, then an undo of the first. It
  was refused with what the paragraph then read, and nothing was sent.
  Undoing the second, then the first, brought back 1200.
- **Stale `expect`:** refused with the element's current text, and the page
  unchanged.
- **Cleanup:** the appended paragraph was undone. The appended table is still
  on the page, because removing a table is by hand until that has been tried.

One failure on the way, and it was the token, not this step. A preview and
its commit, a few seconds apart and shortly after an undo had rewritten the
same paragraph, captured different markup. The token, which hashes the raw
pre-image, stopped matching and nothing was written; the same call landed
first time when run again. OneNote apparently goes on rewriting an element
for a moment after a write. `expect` compares text rather than markup, so it
does not trip on this, which is one more reason for step 4.

Found on the way, and fixed: `test/onenote-tools.test.mjs` spawned the
server with the developer's own token file and write log. On a machine
connected to Microsoft, its append to `a-page-id` reached Graph, and every
test run since 0018 left a pending line in `~/.artist-mcp/writes.log` (29 of
them). The spawned server now gets a temporary token file and log. The lines
already there are inert, pending lines for a page that does not exist, and
were left in place.

### 4. The table rule moves into the edit, then the OneNote previews go

What is mechanical is applied, not refused: the `asWritten` normalisation that
`append_row` already uses — `border="1"`, a tag on a `<p>` rather than a
`<span>`, ids stripped. What is not mechanical — a table whose header no longer
matches the one read — is refused, and the refusal carries the house markup.
That is sent only when a table is being written wrong, which is when it is
read.

Then `edit_onenote_page` takes no `confirmation_token`, and
`preview_onenote_edit` is removed, `update_row`'s preview with it. The
operation table changes in the same commit, so `test/operation-boundary`
changes deliberately. `onenote-edit`'s grant text (decision 3) and
`policy:patch`, bundled and custom, with the conversation rule (decision 1),
change with it.

**Built on 2026-11-25, and verified live locally the same day.**

- **The edit:** `edit_onenote_page` takes no token. A replace or insert
  without `expect` is refused before the page is read, and a token sent by a
  client following the old flow is ignored. The result carries what the
  preview did, now after the write: before and after (a table as marked
  rows), what formatting was kept, and the write ids, with how `undo_write`
  reverses them. `update_row`'s result now shows the row before as well as
  after, for the same reason.
- **The table rule:** two parts.
  - The `border` attribute is added to any table sent without one. It is the
    only part of 0017's normalisation left to apply, because
    `validateFragment` already refuses an `id` and a to-do tag on a `<span>`
    in markup a caller writes.
  - A whole-table replace that rewrites the header row is refused, and the
    refusal carries the house shape (`HOUSE_TABLE`, moved from the server
    into the core). A header row is a first row, with another row below it,
    whose cells are all bold or shaded. A single-cell free-text table has
    none and is rewritten freely; checking its first row would refuse every
    edit.
- **What went:**
  - `preview_onenote_edit`, its operation (so `test/operation-boundary`
    changed deliberately), `previewEdit`, `editToken`, the preview's
    parts reader, `previewRowUpdate` and its token;
  - `TABLE_MARKUP`, the preview's copy of the house shape.
- **What replaced the preview's parts listing:** `read_note` gained
  `all_parts`, registered only with `onenote-edit`. The index stays capped,
  and the preview was the only way to an id the cap left out; without it, a
  paragraph past the twelfth could not have been edited at all.
- **Text:** the `onenote-edit` grant text is as decision 3 records, and the
  consent line printed after `connect` follows it. The bundled
  `policy:patch` carries the conversation rule (decision 1), `expect`, the
  header rule and the wider undo, and its registry was regenerated.
  `CLAUDE.md`'s paragraph on confirmation now says only the calendar keeps
  a preview.
- **Tests:** rewritten around the one-call edit, so each that used a preview
  now passes `expect`. The table rendering is checked in the result rather
  than the preview. New tests:
  - a replace or insert without `expect` refused, with no read made;
  - a header rewrite refused with the house shape, and a table without a
    header rewritten freely;
  - the border added, and a table's own border left alone;
  - `all_parts` listing every part;
  - the spawned-server tests calling `edit_onenote_page` with `expect`.

  Those spawned-server tests had called `preview_onenote_edit` and passed
  vacuously once it was gone, because an unknown tool is not a schema
  refusal. They now fail on an unknown tool, and one checks that the preview
  is gone. With the header check off, the header test fails; with the border
  fix off, two tests fail.
- **Size,** with `context-budget`, against `2a2670c` (before 0019): with
  `onenote-edit` alone the tool list is 25,407 characters a request, down
  from 30,188 (−4,781, 16%). With every grant it is 36,929, down from 41,735.
  That covers all of steps 0–4: `expect` and `all_parts` added, the preview
  tool removed, and the edit tool's description rewritten shorter.

**The custom pack, done the same day.** Every Markdown file in both packs was
searched for previews, tokens, confirmation, undo and edits. Outside
`policy:patch`, only the custom `policy:tasks` needed changing: a handover is a
table replace carrying `expect`, and a tag added in passing is mentioned when
the change is reported. The custom `policy:patch` got the bundled pack's
changes, along with its own: "An update from chat" reads the page right before
the edit and passes `expect`, and one edit covers a date and a task together.
Its rules for automations are unchanged. Committed to
`artist-mcp-custom-pack` as `8e8e7f6` and synced into `vendor/artist-pack`.
Loaded through the resolver, the four new rules came back in force and nothing
names `preview_onenote_edit` or a token. Left as they were, deliberately:
`role:digest` step 5, where lifting the cap on new pages needs each one shown
first (a guard on bulk creation, not a preview of an edit), and the
`ORCHESTRATOR` line about showing a change to a calendar event first, since the
calendar keeps its preview.

**Live, locally, on `artist-mcp live test 0009 (delete me)`**, through the
rebuilt dispatcher:
- **One-call replace:** a paragraph replaced with `expect` and no token, its
  result showing before, after and the write id.
- **Refusals:** a replace without `expect`, and one with a stale `expect`, each
  refused with nothing written.
- **The border:** a table appended without a `border` attribute went out with
  one. OneNote stored `style="border:1px solid"`, not the `border:0px` 0017
  found without the attribute, so it took effect.
- **The header rule** recognised the header in OneNote's own stored markup: a
  bold `<span>` in a shaded cell, not the `<b>` that was sent. Rewriting it was
  refused with the house shape; keeping it went through, and was undone.
- **`update_row`:** a Frist changed on a task table, its result showing the
  row before and after, every other row read back unchanged, then undone.
- **Cleanup:** every paragraph and table replace undone. The two appended
  test tables stay on the page, to be removed by hand.

The run also caught one awkwardly worded result line, about the formatting
kept, which is fixed.

**Still to do for this step:**
- **The production migration** from step 1.

### 5. Calendar edit and delete record before they write, and can be undone

- Two-phase, as step 1. `wrote` holds the event as Google returned it.
- **Undo of an edit**: patch the previous fields back, with `If-Match` on the
  etag the edit produced, `sendUpdates=none`. A 412 means the event moved since
  this tool wrote it, and the undo refuses and shows the pre-image.
- **Undo of a delete**: patch `status` back to `confirmed`, `sendUpdates=none` —
  verified live on 2026-11-21 to restore the event with its id. Once Google has
  dropped the cancelled event, the undo says so and offers to recreate it from
  the pre-image under a new id, as `create_calendar_event`.
- The stale guard: an edit or delete carries the etag the caller read, sent as
  `If-Match`.

### 6. The calendar tokens go

`edit_calendar_event` and `delete_calendar_event` take no
`confirmation_token`. `reschedule_calendar_event`, a create then a delete of
this tool's own event, is unchanged.

## How it would be verified

- Request-level tests for each guard: a stale `expect` refused, a 412 not
  retried, a failed pending line refusing the write, an undo refused when the
  target moved, a table undo refused after one cell changed — each failing with
  the guard removed.
- Live, locally, on a scratch page: replace a paragraph and a non-task table,
  insert a line, undo each; edit the page by hand after a replace and confirm
  the undo refuses.
- On hosted, through ChatGPT: one replace, its undo, and the production rows.
- Live on a hand-made event without guests: edit, undo, delete, undo; confirm
  no email.
- `context-budget` before and after each promotion.

## What it costs

Roughly 0018's size for OneNote: `expect` on two paths, two undo kinds, the
normalisation moved, one tool removed. The calendar half is smaller — two undo
kinds over calls that already exist — plus its live run.

## Decisions this needs

1. **The conversation rule** — *decided 2026-11-25: the musician's request is
   the yes, and the model asks first in two cases only*: a change it derived
   itself (a value read in a mail, a tidy-up nobody asked for), and a request
   that does not pin down its target — two elements that could be "the
   Honorar", or a whole-table replace that would change more than the cell
   named. Otherwise it writes and reports before and after with the
   `write_id`. The second case was added to 0019's draft because the risk left
   once the token goes is not a missing yes but a write other than the one
   asked for, and ambiguity is where that happens. Keeping a question before
   every replace was rejected: with nothing enforcing it, it is the rule
   dressed as a mechanism that 0009 retired. Lives in `policy:patch`, bundled
   and custom.
2. **Events with guests.** An edit or delete is visible to the guests before
   any undo; nobody is emailed, but their calendars change. Options: allowed
   like any other event, or refused for events with attendees (0015's open
   question 3). Recommended: refused, until it is seen to be needed.
   *Deferred 2026-11-25* with the calendar half (decision 5).
3. **Grant wording** — *decided 2026-11-25 for `onenote-edit`; existing grants
   kept.* Its text becomes "add to or change a page that artist-mcp itself
   created, reporting each change with how to undo it. It cannot touch a page
   you wrote, and it never deletes a page." That also corrects two things the
   current text had already got wrong: it did not mention `update_row`, and
   "it cannot delete anything" stopped being strictly true when `undo_write`
   began removing rows this tool added (0018 decision 4). Existing grants are
   kept rather than cleared, by the owner's decision — the third exception of
   the kind 0009 and 0015 made, on the same condition 0009 set: hosted has one
   musician holding `onenote-edit`. What the grant reaches does not change,
   since Microsoft still limits it to this app's pages; only whether a change
   is shown first does. Not a precedent, and with a second hosted holder it
   would have to be asked again. `calendar-delete`'s "after showing it to you
   first" stays until the calendar half (decision 5).
4. **Pre-image retention on hosted** (0018 decision 5). With the previews gone
   the log is the only way back for every overwrite. *Decided 2026-11-25, in
   part:* **a Microsoft disconnect deletes that user's OneNote rows**, as a
   Google disconnect already deletes their calendar rows
   (`forget_my_google_writes`, 0022 step 1), and the local log does the same
   on `artist-mcp disconnect microsoft`, by parity. An undo is lost with them;
   it could not have run without a Microsoft token anyway. This is a second
   exception to `write_audit`'s "nothing removes a row", of the same kind:
   the person withdrawing their data. Built in this round, with its own
   migration.

   Size, measured 2026-11-25: the owner's local log held 587 lines in three
   months, 2.2 MB, 3.9 KB a line on average and 30 KB at most (a whole table
   as pre-image); hosted held 327 rows on 2026-11-23. That is about 10 MB a
   year per musician at today's pace, and 50–100 MB at the worst once the
   digest re-dates up to five tasks a night, before Postgres compresses large
   values. So, *decided 2026-11-25*: **no window while connected, yet.** The
   remedy is recorded rather than built: when it is needed, clear
   `pre_image` and `wrote` on rows older than a set age and keep the rows, so
   the audit trail stays and only the undo goes, which then says the write is
   too old to undo. It is applied when `write_audit` passes about 100 MB, or
   before hosted opens beyond its invite list, whichever comes first.
5. **Order** — *decided 2026-11-25: OneNote only in this round.* Steps 5–6
   wait on [0022](0022-google-requires-mcp-for-agents.md): from 1 February
   2027 Google requires its MCP servers, whose `update_event` takes no etag,
   so step 5's stale guard (`If-Match` on the etag the caller read) cannot be
   built as written there and has to be re-planned once 0022's spike can run.
   Calendar edit and delete keep their tokens and previews until then.

## What would change the plan

MCP elicitation, if the clients in use support it, puts a question in front of
the musician rather than the model — the one thing 0015 names as better than a
recovery. [#155](https://github.com/ManudotaORG/artist-mcp/issues/155) is the
spike. *Decided 2026-11-25: not a gate on step 4.* Decision 1 already asks no
question for most replaces, so elicitation would add a question back on every
write; whether ChatGPT, which hosted is used through, supports it is unknown;
and a scheduled run has no person to answer. Its natural place is decision 1's
two ask-first cases, where it can be added later without a preview tool.
#155 stays open for that.
