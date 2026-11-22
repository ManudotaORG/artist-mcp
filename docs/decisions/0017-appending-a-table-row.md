# 0017 — A task row is added to the table by the server, and commits in one call

Status: **accepted, built, and verified on hosted on 2026-11-22** (see "Built"
below): four rows added to three real CL Aufgaben tables in a watched digest,
every earlier task read back unchanged. The three open questions were answered by the owner
(below). Written for review before any code, after a round-trip test
on a scratch page. Reverses one rule in
[0014](0014-tasks-on-map-notes.md) ("Not into the table") and narrows
[0006](0006-replacing-a-whole-table.md) for one shape of change. Depends on
[0009](0009-confirm-by-reversibility.md)'s rule and takes the first step 0015
describes for a table ([0015](0015-recovery-replaces-confirmation.md)).

## Why

The digest adds tasks it finds in mail to the project's CL Aufgaben page. Since
0014 it appends them below the table under "Neu, automatisch ergänzt", because
OneNote supports no update to a row or a cell: adding a row means replacing the
whole table (0006), and a whole-table replace is the most destructive write this
tool has. It keeps a preview and a token, which an unattended run cannot give.

The owner decided on 2026-11-22 that the tasks belong in the table, unattended.
A second table for automatic tasks was considered and not chosen: adding a row
to it is still a whole-table replace, so it narrows the exposure without
removing it, and it splits the record into two places the musician and the
digest both have to read.

What makes a whole-table replace dangerous is not the replace. It is that the
model rewrites every cell from what it read, and a cell it leaves out or
retypes is a value destroyed. If the server builds the replacement — every
existing row carried across as OneNote returned it, one new row added at the
end — the model writes no existing cell at all, and the change destroys nothing
by construction. That puts it on the one-call side of 0009's line.

## What the round trip showed

Tested on 2026-11-22 on the scratch page "artist-mcp live test 0009 (delete
me)", with a table in the house shape whose rows held an open task, a ticked
one, italic, coloured text, a link, a cell of two paragraphs and an empty cell.
The table was read with `includeIDs`, one `<tr>` inserted before `</table>`, and
the whole table replaced with `If-Match` on the ETag just read. Every original
row was then compared before and after: its text, its tags, and its markup with
ids removed.

| What was sent back | Rows identical | What was lost |
| --- | --- | --- |
| The markup exactly as read | text only | **every to-do tag, the tick included**, and every border (`1px solid` became `0px`) |
| Translated, ids kept | all | nothing — but the ids came back as `data-id`s, and the next replace could not find its target |
| **Translated, ids stripped** | **all, over two further rounds** | nothing |

Three facts follow, and the operation is built on them:

1. **OneNote writes tags differently from how it reads them.** It returns a
   tag on a `<span>` inside the cell and accepts one only on a `<p>`; a tag sent
   on a span is dropped without an error. So a naive append-row would untick
   and untag every task in the table and report success.
2. **A border is honoured only as the attribute.** The table comes back with a
   CSS border and no `border` attribute; sent that way, every cell loses its
   border. `TABLE_MARKUP` already says this for tables the model composes.
3. **Ids must not be sent back.** OneNote keeps a sent `id` as a `data-id` and
   generates a new one, so ids sent back accumulate on every row and cell with
   each append.

Translated — tags moved back onto `<p>`, `border="1"` restored, `id` and
`data-id` stripped — every original row came back identical in text, tags and
markup, and stayed identical over two more appends to the same table.

Not tested: a picture, ink, an attachment or an embedded file in a cell, and
merged cells.

## The decision

**A new change, `append_row`, adds one row to the end of a task table. The
server builds the replacement; the model supplies only the new row's cells. It
commits in one call.**

### What the caller gives

- The table's `element_id`, from `read_note`.
- The new row's cells **by header name**, as plain text:
  `{"Aufgabe": "…", "Frist": "15.12.2026 (laut Mail)"}`. A header the caller
  does not name is written as `UNKNOWN`, the templates' convention for a field
  nothing states. A name that is not a header is refused.
- Nothing else. No markup, and no existing cell.

The task column — the header that is a task word (`Aufgabe`, `Aufgaben`,
`Task`, `To-do`), as tasks mode finds it — gets `<p data-tag="to-do">`. A table
with no such header is refused (step 2) rather than guessed at. Every other cell is a `<p>`
in the house cell style.

### What the server does

1. **Reads the page** immediately before, with `includeIDs`, and takes the
   table by its id.
2. **Refuses a table it cannot carry.** A CL Aufgaben task table holds text
   and tags and nothing else — the owner's rule, and what the round trip
   tested — so the check is an allowlist, not a list of known dangers: text,
   paragraphs, line breaks, links, bold, italic, underline, coloured or styled
   spans, and the two to-do tags. Anything else in the table — a picture, ink,
   an object or attachment, a list, merged cells, a nested table — and a table
   with no header row or no task column, is refused with the reason, writing
   nothing. The digest then appends below the table as
   today, and says why.
3. **Translates the table back into what OneNote accepts**: tags from `<span>`
   onto `<p>`, `border="1"`, `id` and `data-id` removed. Inserts the new row
   before `</table>`.
4. **Records the pre-image** — the table as read — in the write log, as every
   replace does.
5. **Writes** with `If-Match` on the ETag from step 1, so a page the musician
   changed in between is a refusal, not an overwrite.
6. **Reads the page again and checks every original row**: text and tags must
   match what step 1 read. A mismatch is reported in the result, loudly, naming
   the rows that differ and saying that the previous table is in the write log.
   It is not retried and not rolled back automatically — the undo is 0015's,
   and it is not built.

That last check is what turns "destroys nothing by construction" into
something verified on every write rather than once on a scratch page.

### Confirmation

None: the change commits in one call, with or without a person. It writes no
existing cell, and the check proves it each time. In a conversation
`policy:patch` still has the change shown first and a yes waited for; in an
automation the musician set up, it may run directly. The page rule is
unchanged: an unattended run writes only the CL Aufgaben page `list_notes`
names.

A change that alters an existing row — a tick, a date, a status — is not this
operation. It is a model-composed replace and keeps its preview and token, as
0006 and 0015 have it.

## What changes elsewhere

- **0014's "Not into the table"** is reversed for additions. The digest adds a
  new task as a row. It still changes no existing row unattended.
- **`role:digest`** step 4: `append_row` into the page's task table, with the
  source in the task cell (`… — aus Mail „…" (…), 21.11.2026`); below the table
  under "Neu, automatisch ergänzt" only when `append_row` refuses the table.
- **Lines already appended below the table** stay where they are. Moving them
  in means removing them afterwards, and removing even an element this tool
  added is 0015's open question 1. Folding them in is a separate step.
- **`onenote-edit`'s description** gains "add a row to a task table" among what
  it does without asking first.
- **The operation table** gains no row: `append_row` is a change inside
  `edit_onenote_page`, which is already a write. `test/operation-boundary` does
  not move.
- **No new capability**, so the rule in `CLAUDE.md` that a new capability needs
  a migration clearing `write_grants` does not apply. What `onenote-edit` may do
  without asking widens, as it did for appends; existing grants are proposed to
  be kept, as then, by the owner's decision.

## What this knowingly accepts

- **Formatting the round trip did not cover.** The test covered bold, italic,
  colour, a link and paragraphs. A cell with a highlight, a font change or a
  list may differ after the write; the check compares text and tags, so a lost
  highlight would not be caught. The refusal list is what bounds this, and it
  can only name what is known.
- **A wrong row is seen after the fact.** It is one row at the end of the table,
  named in the digest, and deleted by hand until 0015's undo exists.
- **A failed check is reported, not reversed.** The pre-image is there; putting
  it back is a person's job until `undo_write`.

## How it would be verified

- Request-level tests: the translation (a span tag reaches the write on a
  `<p>`, the border attribute is set, no `id` or `data-id` is sent); every
  refusal writing nothing; `If-Match` sent; the check reporting a changed row;
  a missing header written as `UNKNOWN`; each failing with its guard removed.
- Fixtures copied from the round trip's read-back markup, not composed by hand.
- Live on the scratch page: the round trip repeated through the built
  operation.
- Live on a real CL Aufgaben page in a watched digest: one row added, the
  table read back identical apart from it.
- On hosted after promotion, the same.

## Decided with it, 2026-11-22

1. **Existing grants are kept**, as they were for appends — the same exception,
   not a precedent.
2. **A task table holds text and tags only.** So the server's check is the
   allowlist in step 2, and a table holding anything else is refused rather
   than carried. No survey of the live tables was needed to decide it.
3. **The source goes in the task cell**, after the task, as the appended lines
   carry it.

## Built, 2026-11-22

`edit_onenote_page` with `action: append_row`, `element_id` (the table) and
`rows` (cells by header name), in `appendRows` in `onenote-patch.ts`, exactly
as decided. `preview_onenote_edit` turns it away, since it needs no preview. The
write log line is `append_table_row`, one per row, each carrying the table as it
was.

- **Tests** use the round trip's read-back markup. They pin the translation
  (no tag on a span, the tick on a `<p>`, bold inside a task kept inside its
  paragraph, `border="1"`, no `id` or `data-id`), the server-built row and
  `UNKNOWN` for an absent column, `If-Match`, the read-back check reporting
  rows by number, and each refusal writing nothing. Removing the translation,
  the allowlist or the check each fails a test.
- **Live, locally, on the scratch page.** A table headed `Aufgabe SPIKE-TABLE-B`
  was refused after one read, nothing written — its header cell is not a task
  word, and that strictness is intended. A table in the real shape then took
  two rows in two calls, three OneNote requests each (read, write, read back),
  each reporting the existing rows unchanged. Read back independently through
  tasks mode: the tick intact, both new rows open with their cells, borders
  kept, no `data-id`s.
- **`role:digest`** (custom pack at `2a100b2`) adds tasks with `append_row`,
  falls back to the appended lines only where the table is refused, and opens
  the digest with any WARNING. `policy:patch`, in both packs, counts a row added
  this way among the writes that remove nothing.

