# 0006 — Replacing a whole table

Status: **accepted.** Extends [0004](0004-onenote-page-maintenance.md), which
built a paragraph-level replace, and amends the "smallest fragment" rule in
`policy:patch` that [0005](0005-patching-when-the-tool-can-write.md) left
standing.

## What was unreachable

0004 shipped a capability that could address paragraphs and headings sitting
outside tables, and nothing else. On the pages it exists for that is a small
fraction of the page: a filled-in "CL Aufgaben" template keeps almost everything
in tables — label/value blocks, a roster, and single-cell tables used as
free-text sections. The parts listing offered `p:` ids and no `table:` ids, so
there was no id to name, and the `text` parameter said of itself that markup is
not interpreted, so there was nothing to write into a table with even if one
could be named.

The result was a maintenance tool that could correct a stray line under a
heading and could not correct a fee.

## What Graph actually allows

Not what the limitation implied. `PATCH .../pages/{id}/content` takes an array
of `{target, action, position, content}`, and for `table` the reference lists
**replace**, with the generated id, and **insert** as a sibling. What it refuses
is finer than that:

> Replacing `tr` and `td` elements is not supported, but you can replace the
> entire table.

So the unit is the table. That is Microsoft's boundary and not a choice
available to us, and it is the fact everything below follows from.

## What this changes

- `table:` generated ids are enumerated alongside the paragraph ids. A paragraph
  that lives in a cell is still listed — it is on the page — and carries the id
  of the table it sits in, because a caller that aims a replace at a cell is
  about to get an error it cannot interpret.
- A table is replaced whole, with HTML, via `replace`.
- A block can be placed `before` or `after` a table with `insert`. Until now the
  only way to add content was `append`, which reaches the end of the body — so a
  new section added to a template landed after the signature block rather than
  where it belongs.

## The rule this breaks, and what replaces it

`policy:patch` says: "never hand back a rewritten page so that a single cell can
differ", and "a row that carries three unchanged cells to reach the fourth is
still one row; a second row nobody asked about is not."

A whole-table replace is exactly the thing that rule forbids. It cannot be
narrowed — there is no smaller operation — so the rule is amended rather than
quietly broken:

**The smallest fragment is the smallest fragment the tool can apply.** For a
table that is the whole table, and every cell not being changed has to be
carried across unchanged. A cell left out of the markup is not a cell left
alone; it is a value destroyed.

That is a real widening of what one confirmed change can destroy, and it is why
two other things had to change with it.

## Why the preview had to be rewritten first

The pre-image rule from 0004 — nothing is replaced unless what it destroys was
captured first — is mechanical and held without modification. The preview is not
mechanical, and it did not.

A paragraph replace could show the old text and the new text and be read in a
second. A table shown the same way is several hundred characters of markup, and
a preview nobody can read is not a safeguard; it is a wall that gets approved
unread, which is worse than no preview because everyone involved believes a
check occurred. So a table is rendered as its rows, padded into
columns, with the rows that differ marked — matched by longest common
subsequence, so a row inserted at the top does not flag everything under it. A
preview where every row is marked says as little as one where none is.

**Nothing is clipped**, and the first version of this got that wrong. It cut
each cell at forty characters, reasoning that the shape of a table is what a
reader checks. That holds for a roster and fails completely for the case these
pages are mostly built from: a single-cell table holding a paragraph of free
text, where the change lives past the fortieth character. Both halves of the
preview then rendered to the same truncated line, so it asserted in effect that
a destructive change was a no-op. Reported from use, not caught here — the test
asserted the ellipsis was present, which is how a defect gets a green tick.

Long cells wrap inside their column instead. A wrapped preview is longer to
read; a truncated one cannot be read at all, and the case where it truncates is
exactly the case where reading it matters.

The confirmation token still binds the **markup**, not the rendering. Two
different tables can render to the same rows.

## Where a new section may go

The first version of this could only put one beside a table, and could only
replace a paragraph with plain text. Between those two, a block whose
neighbours are both paragraphs — which is where the v1.1 `Ausfüllkonventionen`
belongs, between a page's intro line and its `Projektzustand` heading — had
nowhere to go at all. Pages could not be brought to v1.1, so their version
stamps had to stay v1.0.

Both restrictions were ours. Probed against a real page rather than read off
the reference, which this record has caught out four times
(`scripts/spike-onenote-anchors.mjs`):

- **`replace` on a `p` accepts markup, including several elements at once.** An
  intro paragraph can become itself, plus a heading, plus a table, in one
  command. That is the natural way to add a section mid-page, and it is now
  allowed.
- **`insert` anchors on a `p` as well as a `table`**, and lands on the side
  asked for.
- **`insert` accepts multi-element content**, so a heading and its table arrive
  together.
- **OneNote keeps no `h1`-`h6` on these pages.** A heading *is* a `p` holding
  one styled `<span>`. `h1`-`h6` are accepted as anchors anyway, unverified,
  because there was nothing to aim a probe at.

## What a replacement inherits, and why it must

Two silent losses, both observed rather than predicted:

- A bordered table replaced by a bare `<table>` comes back as
  `style="border:0px"`. The borders are not merely absent from the replacement;
  they are removed from the page.
- A heading replaced by a bare `<p>` comes back with no `<span>`. On these pages
  that span is the whole of what made it a heading, so the element survives and
  stops being a heading.

Neither is visible in a preview built from text, and neither is recoverable
except from the pre-image. So **formatting the target has and the replacement
does not specify is carried across** — the element's own presentational
attributes, and the styled span wrapper where the target is exactly one. A
caller that supplies styling of its own has decided, and inherits nothing.

The preview says when it happened. Silent inheritance would be a change nobody
was shown, which is the fault this record already has one entry for.

Inherited values are not re-validated. They come out of the musician's own page
rather than out of a model, which is the same reasoning
`scripts/copy-onenote-page.mjs` records for sending a page's markup back
verbatim. An `id` and a `data-id` are never copied: duplicating either would
make the page address two elements the same way.

## Several changes, one write

Applying changes one at a time meant one read per change, because the generated
ids move after *every* write. Restructuring one page was around eight round
trips, and each read between them was another chance for the page to have moved
under the sequence.

Graph's `PATCH` takes an array. Three things about it were probed before this
was built (`scripts/spike-onenote-batch.mjs`), because one confirmation would
now cover several destructive changes:

- **Every target resolves against the page as read.** A command whose target an
  earlier command in the same batch has already rewritten past still lands. One
  read covers a whole batch, which is the entire reason to batch.
- **A batch with one unresolvable target applies nothing.** `400`, page
  untouched — verified with a well-formed id naming nothing, sent between two
  commands that would otherwise have applied. This is the property that makes a
  batch safe to approve as one thing. A batch that half-applied would leave a
  page in a state nobody previewed and nobody agreed to, and the capability
  would not be worth having.
- A command *can* target what an earlier one in the same batch created, which
  nothing here relies on but which would otherwise be a surprise.

So the confirmation token binds every change **and every pre-image, in order**.
If any one element has moved or changed since the preview, the whole batch is
refused rather than the changes whose targets still match — the atomicity has to
hold in our code and not only in Graph's, or the token would quietly become a
per-change guarantee.

Two changes naming the same element are refused rather than ordered. Both would
resolve, and only the last would survive, with the other silently gone.

Twelve changes is the ceiling, and it is not a technical one. A batch is
approved as one thing, and a list nobody reads to the end is approved unread —
the same failure the truncated preview was.

## The listing is an index once a change is named

The preview returned every part of the page in full on every call, which on a
real page is 36 parts and about 13,500 characters — most of what a session
spends when it patches one page in several steps.

That listing exists so a caller can find an id. Once it has named one, what it
needs back is the diff for that change, and enough of the rest to look up an id
it does not have. So a preview that names a change returns a one-line label per
part instead: 3,100 characters against 13,500 on the page above, and it says
that it is abbreviated, because a shortened list that does not announce itself
is one a reader treats as the whole page.

The probe call — a replace with no `element_id`, whose whole purpose is showing
what the page holds — still returns everything.

**Nothing being decided is ever abbreviated.** The diff is rendered in full,
including a table's every row. Shortening the index is a different act from
shortening the thing under approval, and the distinction is the whole reason
the truncation defect is not being reintroduced here.

## Why markup is refused rather than sanitised

`text` is escaped on the way out, which is what makes it safe to compose from an
email. Markup cannot be escaped and still be a table, so something else had to
carry that weight, and it is refusal: a tag, attribute, style or structure
outside the allowed set stops the write with nothing sent.

Refusal rather than stripping, because the two fail in opposite directions. A
stripped attribute produces a page that was written and is subtly not what was
previewed. A refusal produces no change at all. OneNote keeps no version and no
recycle bin, so only the second is recoverable.

## What does not change

- The page must be one this tool created. Microsoft enforces it, our code does
  not restate it, and the `401` is surfaced as it arrives.
- Preview, then a yes in words, then apply, with the token bound to the exact
  values and to what they would overwrite.
- Ids are read immediately before the command that uses them and never carried
  across a write.
- Nothing is deleted. An `insert` adds and an `append` adds; a `replace`
  overwrites one element and keeps its pre-image.
- A table is still replaced whole and must still yield exactly one table. What
  changed is what a *paragraph* may be replaced with, not what a table may.

## What would reverse this

A page corrupted by markup this tool sent — a table that came back as something
other than a table, or content outside the target element changed. The allowed
set would go back to nothing rather than being extended one tag at a time.

A musician approving a table replace and losing a cell they had not been shown.
That is a preview failure, not a markup failure, and it would mean the rendering
is not doing the job this record claims it does.
