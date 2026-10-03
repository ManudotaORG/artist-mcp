# 0013 — Editing and deleting any calendar event, and event colours

Date: 2026-10-03

Status: **built and verified live on 2026-10-03** through Claude Desktop, on an
event the musician made by hand in their primary calendar. Colours were read
across a week of events, all correctly "calendar default". The event was
recoloured Tomato and then deleted. Each write went through its confirmation,
and the write log holds both pre-images. Not exercised live: colour on create,
and the refusals of invitations, recurring series and special entries, which
run in tests only. Amends [0001](0001-opt-in-calendar-writes.md)
(the `artist` prefix as the delete boundary) and
[0009](0009-confirm-by-reversibility.md) (which writes commit in one call).

## Decision

- **Delete reaches any event you organise.** `calendar-delete` no longer stops
  at events with the `artist` prefix. An event artist-mcp created still goes in
  one call. Any other event needs a confirmation first.
- **A new write, `edit_calendar_event`, changes one event in place:** title,
  times, location, notes or colour. Every edit needs a confirmation, because it
  overwrites what was there.
- **Event colours.** `list_events` and `read_event` show each event's colour by
  name. `create_calendar_event` and `edit_calendar_event` take one of Google's
  11 event colours, by name. `reschedule_calendar_event` keeps the old event's
  colour.
- **No new capability, and no regrant.** Editing is gated on holding both
  `calendar-create` and `calendar-delete`, the way rescheduling already is.

## Why

The owner wants the calendar to be maintainable from a conversation, including
the events the musician made. The `artist` prefix kept those out of reach, and
it is exactly what this decision removes.

## What stops a mistake now

The prefix was the boundary, and it was in our code. Google's
`calendar.events` scope always allowed editing and deleting any event, so this
needs no new scope or reconnect. What replaces the prefix is still our code:

- **Confirmation by what a write can destroy (0009, applied again).** An edit,
  or a delete of an event this tool did not create, is two calls to the same
  tool. The first, without `confirmation_token`, writes nothing. It returns the
  event as it stands, what would change, and a token. The second, with that
  token, commits. One tool rather than a preview tool beside it, because the
  tool list is paid on every request and 0009 removed four preview tools for
  that reason.
- **The token binds the event's current `etag` and the exact change.** If the
  event changed after the preview, the token no longer matches and nothing is
  written. The PATCH also sends `If-Match`, so a change landing between the
  check and the write is refused by Google (`412`).
- **Pre-image.** Every edit and delete records the whole event as it was in the
  audit's `pre_image`, locally and hosted, so it can be put back by hand.
- **Nobody is notified.** Every write sends `sendUpdates=none`, so no email goes
  out. Message sending stays out of scope. Attendees' copies of an event the
  musician organises still change, because that is what an organiser's edit
  does, and the confirmation says so when there are attendees.
- **Refused outright:**
  - an invitation someone else organises. Editing your copy does not change
    theirs, and deleting it is declining, which is a message.
  - a whole recurring series. One occurrence can be edited or deleted; the series
    cannot. A mistake there rewrites every week at once.
  - special event types (birthdays, focus time, out of office, working location).
  - an unsettled value (`TBC`, `UNKNOWN`), checked on the fields being changed
    only, so an edit is not refused for something already on the event.

## Existing grants carry over

0011 said a capability that widens what a permission can do clears grants. The
owner has decided against that here: nobody is asked again.

- **Hosted users** who switched writes on hold every capability, so they get
  editing and the wider delete with no migration.
- **Local installs** holding both calendar grants get editing. An install with
  only `calendar-delete` gets the wider delete.
- **The consent wording changes** (`WRITE_CAPABILITIES`, the READMEs, the hosted
  page) to say what the grant now does. Existing users agreed to the narrower
  wording. That gap is the owner's call, made knowingly, and it is why every
  edit and every delete of the musician's own event is confirmed first.

**Not a precedent** for widening a grant without asking. It rests on this being
an invite-only deployment and on the confirmation above.

## Colours

Google's event palette is 11 colours with fixed ids. Its `/colors` endpoint
returns only hex values, so the names (Lavender, Sage, Grape, Flamingo, Banana,
Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato) are written in code, as
the Calendar UI shows them. An event with no colour of its own shows its
calendar's colour, from a different palette of 24. Reads say "calendar default"
rather than guess a match, and `edit_calendar_event` takes `default` to clear a
colour.

Colour is not part of the `artist` id hash, so every existing id is unchanged.

## Cost

- **A wrong edit is no longer removable by this tool.** Recovery is the
  pre-image, applied by hand or by a second edit.
- **Editing an event this tool created breaks its id-as-content.** The id stays
  the hash of the original. A later create of that original content collides
  with it and is reported as already there.
- **The tool list grows** by 1,820 characters (about 455 tokens, 5%) on every
  request with every write granted: one tool, a colour field on two tools, and a
  confirmation field on delete. Measured with `context-budget`.
- **Users with the old schema** do not see the new tool or fields until they
  refresh their tool list.
