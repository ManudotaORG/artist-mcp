# 0003 — OneNote writes: create only, and let the provider enforce it

Status: **proposed, nothing built.** Extends
[0001](0001-opt-in-calendar-writes.md), which ruled OneNote writes out and said
so in terms this record has to answer. Raised by issue #117.

## What 0001 said, and why it said it

> OneNote writes are explicitly out of scope. OneNote is the knowledge base and
> has no undo — a bad `onenote-patch-content` against a `data-id` target
> corrupts a page permanently. A wrong calendar event is deleted in two seconds.
> Same reasoning as `policy:patch`: the recoverable side goes first.

And, in its list of decisions: *"OneNote writes stay out of scope, and this
record does not open a path to them."*

Both still hold for **editing**. What has changed is that creating and editing
turn out to be separable at the provider, which 0001 had no reason to check
because the Calendar work had just proved the opposite for Google.

## The two facts this rests on

1. **`Notes.Create` is a create-only permission** — "Create pages in OneNote
   notebooks on behalf of the signed-in user." It does not permit modifying or
   deleting existing pages. A token holding `Notes.Read` and `Notes.Create`
   cannot touch a page the musician wrote, whatever this code does.

   This is the exact inverse of the Calendar finding in 0001, where
   `events.insert` and `events.delete` accept the identical four scopes and the
   boundary therefore had to become our own code.

2. **Every page records `createdByAppId`**, set by Microsoft and readable on
   every page. Verified against a real notebook: a page made by hand carries an
   empty value. It is the `artist` id prefix that gates calendar deletion, but
   stronger — we do not set it, a user cannot remove it, and it survives the
   page being renamed, moved or edited.

## What would be decided

**Create only, at first, and possibly for good.**

- A `onenote-create` capability, opt-in per install and per hosted user, absent
  unless granted — the shape 0001 and 0002 settled and which does not need
  re-deciding here.
- Previewed and confirmed, the same way an event is: the page shown before it
  exists, and the confirmation token bound to the payload.
- Audited, with enough recorded to find the page again.
- **The guarantee is the provider's, not ours.** This is the whole point.
  0001 had to make the operation table security code because nothing at Google
  separated create from delete. Here the token cannot express an edit, so a bug
  in this repository cannot cause one.

**Editing and deleting are not decided here**, and should not be bundled in.
They need `Notes.ReadWrite`, which grants edit and delete over everything, and
at that moment the restriction becomes ours to enforce again — with
`createdByAppId` as the check, exactly as the `artist` prefix works today.

## What must be verified before that second step

- **Whether `createdByAppId` populates with our app id on a page we create.**
  Only the empty case has been observed.
- **Whether OneNote's recycle bin covers a Graph delete.** The calendar argument
  turned on Google keeping a deleted event for 30 days, which is what moved
  delete from "unrecoverable" to "closer to creating". If a Graph delete bypasses
  the notebook bin, delete should not ship.
- **Whether `data-id` patching is survivable in practice.** `CLAUDE.md` says a
  bad patch corrupts a page permanently. Editing looks riskier here than
  deleting, the reverse of the calendar.

## What does not change

`policy:patch` still describes the musician pasting. A created page is a new
page; it is not an edit to a working unit, and it does not make this tool the
thing that maintains the notebook. One OneNote page is still one working unit,
and the pages this tool writes are its own output rather than the musician's
record.

## What would reverse this

A page the musician wrote being changed or removed. Under create-only that
should be impossible at the provider, so it happening at all would mean the
scope granted was wider than intended — and the capability should go back to not
existing rather than being repaired.
