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
