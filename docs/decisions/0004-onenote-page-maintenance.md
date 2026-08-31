# 0004 — Editing the pages this tool wrote, and only those

Status: **accepted in principle; not built.** Reopens what
[0003](0003-onenote-writes.md) closed "permanently", on evidence 0003 did not
have and could not have had — it ruled replacing out because nothing could be
undone, and an undo now exists. **Deleting stays out**, and this record does not
open a path to it. The scope of what may be edited is the provider's, not ours:
the same guarantee that made phase 1 safe to ship.

## What 0003 said, and what has changed

0003 ruled `replace` out and named its own reversal condition in one sentence:

> The reverse, reopening delete or replace, needs one thing and it is not a
> better scope: **a way to undo them.** If OneNote gains a recycle bin that
> catches a Graph delete, or retains a version across a Graph patch, the
> argument changes and this record should be revisited.

Neither of those happened. OneNote still keeps no version and no bin. What
changed is that the operation turns out to be far narrower than 0003 measured,
and narrow enough that the undo can be ours:

**0003 tested `replace` against the page body.** Body replace rewrites
everything, so a mistake costs the page and no pre-image worth capturing exists.
That is the operation it ruled out, and ruling it out was right.

**A page is not the unit.** `replace` addressed at a paragraph's generated id
overwrites that paragraph and nothing else, verified below with the rest of the
page intact either side of it. A mistake costs one paragraph, and the paragraph
that was there a moment ago is small enough to hold on to.

## What was verified

Against a real notebook, with a token holding exactly
`Notes.Read Notes.ReadWrite.CreatedByApp`, on a page created seconds earlier by
the same token. `scripts/spike-onenote-patch.mjs` is the probe and runs the
matrix again on demand.

| Operation | Result |
| --- | --- |
| `append` at a `data-id` div | `204`, landed, rest of page intact |
| `replace` at a paragraph's generated id | `204`, that paragraph only; siblings intact |
| restore the captured pre-image over it | `204`, **the overwritten content came back** |
| `PATCH` with a stale `If-Match` | **`412`** — a concurrent edit is detectable |
| `PATCH` a page a person wrote | `401 40003 Access Denied` |
| `DELETE` | not attempted, and not being attempted |

The ownership refusal is the one everything rests on, and it is now observed
rather than assumed. The probe finds a page whose `createdByAppId` is empty —
0003 established that means a person made it — and tries to `append` to it,
never to replace it, so a boundary that failed would leave a line to delete
rather than destroyed content. It did not fail.

## The two limits, stated rather than buried

**The undo is ours, not OneNote's.** It is a pre-image captured immediately
before the write and recorded on the install, which is where
[audit.ts](../../apps/mcp/src/audit.ts) already says the point of a write record
is recovery rather than compliance. It survives a bad write. It does not survive
a lost machine, and a hosted install must bind it to the user's row exactly as
0002 requires of everything else. This is weaker than the 30-day bin that
justified calendar deletion in 0001, and stronger than the nothing that ruled
OneNote replacement out in 0003.

**It restores content, not bytes.** OneNote rewrites the markup it stores, so a
restored paragraph came back carrying its text and not its exact HTML. For a
value in a table that is a restore. For something richly formatted it is a
near-restore, and it must not be described to a musician as putting the page
back exactly as it was.

## What would be built

One capability, not two. `append` and `replace` ride on the same scope —
Microsoft offers nothing that permits one and refuses the other — so splitting
them into separate grants would put the boundary back in our code while looking
like the provider-enforced kind, which is the confusion 0003 exists to prevent.
An install granted the capability can do both; the safety is in how each
operation is built, not in which name it was granted under.

- **Confined by scope to pages this tool created.** Not by a check of ours.
  `createdByAppId` remains unusable for this — 0003 established it holds an
  opaque WLID value, and that "non-empty means ours" is false.
- **Every replace captures a pre-image first, and fails if it cannot.** No
  capture, no write. An undo that is best-effort is not one.
- **Every replace carries `If-Match`.** A `412` is reported to the musician as
  the page having moved, never retried over the top of it.
- **Generated ids are re-read immediately before each command.** Microsoft:
  *"Generated id values might change after a page update, so you should get the
  current values before building a PATCH request that uses them."* Observed to
  be a live concern, not a caution: ids move after any update, so an id read
  before one write cannot be used for the next. Same shape as Gmail attachment
  ids, and the same rule — never hand one out to be quoted back.
- **`data-id` targets carry the `#` prefix.** Without it the target does not
  resolve and Graph answers `20134`, which reads like "this element cannot be
  edited" and is not. Two probe runs concluded from it, wrongly, that only the
  page body was updateable. `20138` is the different thing — the element
  resolved and does not support that action, which is what a paragraph returns
  for `append` and always will.
- **Audited**, with enough recorded to find the page and the pre-image again.

## What is still open

- **Whether the musician is shown the page before it is written.** The calendar
  writes preview and confirm, and a paragraph replace is a smaller thing than an
  event; whether it earns the same ceremony is not decided here.
- **Where the pre-image lives on a hosted install**, per 0002.
- **What `policy:patch` becomes.** It currently describes the musician pasting,
  and every boundary in it — "Never claim a page was changed", "offered, and it
  stays offered until they say otherwise" — is written for a tool that cannot
  write. Applying a patch does not merely relax those lines; it removes the
  reason they exist. That is a policy question, not an API one, and it wants its
  own record.
- **Deleting.** Still out. Nothing above bears on it: a delete has no pre-image,
  and the page is gone from a notebook with no bin.

## What does not change

One OneNote page is still one working unit. A page this tool created is still
its own output rather than the musician's record, and the capability reaches no
further than that — a page they wrote is unreachable at the provider, which is
the property that made this worth building rather than a rule we promise to
keep.

## What would reverse this

A page the musician wrote being changed. Under this scope that should be
impossible at the provider, so it happening at all means the grant was wider
than intended, and the capability should go back to not existing rather than
being repaired — the same reversal 0003 sets for phase 1.

A pre-image capture that fails silently, or a restore that does not return the
content, removes the entire basis of this record. The undo is not a feature
attached to replace; it is the reason replace is permissible.
