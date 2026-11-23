# 0019 — Retiring the previews

Status: **proposed, not built.** A build plan for the rest of
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

## The build, in six steps

OneNote first (steps 1–4), then the calendar (steps 5–6). Each step is verified
before the next; steps 1–4 ship in one promotion, 5–6 in another.

### 1. Replace and insert record before they write

The two-phase form from 0018: a `pending` line with the pre-image and what will
be written, keyed by `write_id`, before the `PATCH`; refused with
`UnrecordedWriteError` if that line cannot be made; a `done` line after. A
batch is one pending line per change, as the log is per element today. `wrote`
carries the element as sent, so undo can find it by content.

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
changes deliberately.

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

1. **The conversation rule**: the musician's request is the yes, and the model
   asks first only for a change it derived itself. Or keep asking for every
   replace in conversation, with the tool no longer enforcing it.
2. **Events with guests.** An edit or delete is visible to the guests before
   any undo; nobody is emailed, but their calendars change. Options: allowed
   like any other event, or refused for events with attendees (0015's open
   question 3). Recommended: refused, until it is seen to be needed.
3. **Grant wording.** `onenote-edit` and `calendar-delete` say "after showing
   you first". The text changes; whether existing grants are kept, as in 0009
   and 0015 by the owner's decision, or asked again.
4. **Pre-image retention on hosted** (0018 decision 5). With the previews gone
   the log is the only way back for every overwrite. Recommended: kept
   indefinitely for now, for an invite-only deployment, and revisited before
   it opens.
5. **Order**: calendar in this round, or after the OneNote half is verified on
   hosted. Recommended: after.
