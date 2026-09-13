# 0009 — Confirm by what a write can destroy

Status: **accepted and built.** Creating a page verified live on 2026-09-13 through
the tool path — one call, a refused `TBC` title, placement by `source_page`.
The calendar writes are verified through hosted ChatGPT after deploy, not
locally. Amends [0001](0001-opt-in-calendar-writes.md)
"How a write is confirmed" and the confirmation line of
[0003](0003-onenote-writes.md). Leaves [0004](0004-onenote-page-maintenance.md)
and [0006](0006-replacing-a-whole-table.md) as they are.

## What happened

A scheduled task in ChatGPT did everything right and wrote nothing. It found a
labelled email, read the PDF attached to it, extracted *CLOUD TEST - KAIN Probe,
14 September, 18:00–19:00*, reached the right shared calendar, and stopped:
"Artist-Mcp requires fresh human confirmation after previewing each calendar
write." It then paused itself, so as not to stop at the same step every day.

Nothing in the server stopped it. `create_calendar_event` requires a token from
`preview_calendar_event` for the same values, and a model can call the two back
to back — 0001 said so in its first paragraph on confirmation: nothing inside
MCP can prove a human read something. What stopped it was the wording around
the mechanism: "SHOW THE MUSICIAN WHAT IT RETURNS AND WAIT FOR THEIR YES", a
capability described as "after showing it to you first", and a pack that said
the same. A careful agent obeyed all three.

So the requirement was a rule stated to the model, dressed as a mechanism, and
paid for on every request.

## What it cost

With every write granted, the tool list is sent with every request and is about
38,700 characters. The five preview/commit pairs are 20,190 of it — **52%**:

| Write | Preview | Commit | Pair |
| --- | --- | --- | --- |
| `edit_onenote_page` | 4,301 | 2,814 | 7,115 |
| `create_calendar_event` | 1,970 | 1,995 | 3,965 |
| `reschedule_calendar_event` | 1,924 | 1,629 | 3,553 |
| `create_onenote_page` | 1,730 | 1,780 | 3,510 |
| `delete_calendar_event` | 888 | 1,159 | 2,047 |

[0007](0007-the-token-carries-the-payload.md) tried to shrink the pairs by
making the token carry the payload, and rejected itself on the measurements.
0001 had already named the cheaper retreat — stop requiring the token — and
shaped the committing tools so that it would stay cheap.

## The decision

**A write that this tool can undo commits in one call. A write that overwrites
the musician's content keeps the preview and the token.**

- **Commit directly:** `create_calendar_event`, `reschedule_calendar_event`,
  `delete_calendar_event`, `create_onenote_page`. Their preview tools —
  `preview_calendar_event`, `preview_calendar_reschedule`,
  `preview_calendar_delete`, `preview_onenote_page` — are removed, and none of
  the four takes a `confirmation_token`.
- **Keep the pair:** `preview_onenote_edit` and `edit_onenote_page`. A replace
  overwrites text on a page, OneNote keeps no version of it, and the pre-image in
  the write log is a recovery a musician cannot perform in OneNote. That is the
  write where a mistake destroys something, and the token there binds the
  pre-image as well as the change.

Why each of the four is on the reversible side:

- **Create** leaves an extra event anyone can see and remove, and
  `delete_calendar_event` can remove it because the id carries the `artist`
  prefix.
- **Delete** reaches only events with that prefix, Google keeps a deleted event
  in the calendar's bin for 30 days, and the audit line records the whole event
  rather than a reference to it. It is the weakest of the four — a wrong delete
  leaves a gap, and nobody notices absence — which is why its result has to say
  what was removed in full.
- **Reschedule** is create-then-delete (0001), so it inherits both.
- **A new OneNote page** cannot overwrite anything; `Notes.Create` cannot edit or
  delete, including the page it just made (0003). A wrong page is an extra page —
  but the only one of the four this tool cannot undo itself: the musician
  removes it by hand in OneNote.

## What stays exactly as it was

- **The grant.** A capability not granted registers no tool.
- **The refusal of unsettled values.** `UNKNOWN`, `TBC` and the rest are refused
  by the committing tool itself, as they were by the preview. The rule that a
  disputed value is never written as settled stays in the briefing.
- **The double-booking guard,** derived from the payload independently of any
  token, as 0001 required so that this retreat would not take it with it.
- **The `artist` prefix check** on delete and reschedule.
- **The audit log,** including the full event on a delete.

## What moves into the committing tools

A preview was not only a token. `preview_calendar_event` listed everything
already on the calendar in the event's range, and 0001 calls that listing "the
only honest form of 'is this missing'" this product has. It cannot simply go.

So each committing result now carries what its preview used to:

- exactly what was written, in the same plain language the preview used;
- for an event, everything else already in that range on that calendar, so a
  near-duplicate is named in the result rather than discovered later;
- for a delete, the whole event that was removed;
- how to undo it — the delete tool for a created event, the bin for a deleted
  one, and for a page, that it has to be removed by hand in OneNote.

A write that turns out wrong is then visible in the one message that reports it,
which is what "detectable and reversible" (0001) needs to mean without a person
reading a preview first.

## In a conversation, and in an automation

The tool descriptions and the pack say what to do in each, and the tool enforces
neither — as it never did.

- **In a conversation,** show the musician the event or page and wait for a yes
  before calling the tool. That is the same rule as before, now stated as a rule.
- **In an automation the musician set up** — a scheduled task, a recurring
  check — the tool may be called directly, because setting up the automation is
  the decision. The result is still reported back.

## What this knowingly accepts

- **Unattended writes.** [scope.md](../scope.md) said "No autonomous agent
  processes… No scheduled jobs." That stays true of this product: it runs no
  jobs and holds no schedule. What changes is that a job someone else runs can
  now complete a write, and the scope line is corrected to say so.
- **A shared calendar sees a mistake before anyone checks it.** 0001 named "an
  unwanted event reaching a calendar other people watch" as the case for a
  *stronger* gate. The first automation this unblocks targets exactly such a
  calendar. A misread PDF lands where others see it, reversibly, until someone
  notices. If that happens and costs something, see below.
- **Disputed values are now guarded only by the model** when nobody reads the
  result. The placeholder refusal still runs in code; "these two sources
  disagree" cannot be checked by one.
- **Existing grants are not cleared.** `CLAUDE.md` asks for a migration clearing
  `write_grants` whenever a capability comes to mean more than was agreed, and
  "after showing it to you first" is dropped from three descriptions — kept on
  `onenote-edit`, which still previews. It is
  not done here, by the maintainer's decision: the hosted install has one
  musician, who made this decision. This is an exception, not a precedent — with
  a second hosted user it would have to be done, and the rule in `CLAUDE.md`
  stands for the next capability.

## What would reverse this

- An event on a shared calendar that was wrong, written unattended, and acted on
  by someone before it was noticed. That is the failure 0001 predicted, and the
  answer it named — out-of-band confirmation, or the pair back — becomes the
  right one for calendars other people watch.
- A delete, unattended, of an event that should have stayed. The prefix makes
  that an event this tool made; it does not make it one nobody needed.
- MCP gaining a way to put a question in front of a person rather than a model.
  Then a gate could be real, and it should be.
