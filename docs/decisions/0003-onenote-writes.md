# 0003 — OneNote writes: create only, and let the provider enforce it

Status: **accepted; phase 1 shipped.** The create-only claim was observed
rather than quoted before any code was written, and the `createdByAppId` claim
corrected — see "What was verified". Phase 2 remains undecided and its open
questions are listed below. Extends
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

   **This one did not survive contact.** It holds an opaque identifier rather
   than our app id, and a non-empty value means *some* app, not this one. See
   "What was verified" below before building anything on it.

## What would be decided

**Create only, at first, and possibly for good.** This is what shipped:

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

## What was verified, once the probe was run

Issue #117 called for the create-only claim to be observed rather than quoted,
because everything above rests on it. It was, against a throwaway notebook, with
a token holding exactly `Notes.Read Notes.Create` — the scope Microsoft
confirmed granting. Both attempts targeted a page the token had created seconds
earlier, so the only page at risk was our own:

```
CREATE  -> 201
PATCH   -> 403  40004: requires Office.onenote_update, Notes.ReadWrite, ...
DELETE  -> 403  40004: same
```

**The first fact holds as written.** The token cannot express an edit or a
delete, so a bug in this repository cannot cause one. Phase 1 needs no
code-enforced boundary, which is the entire reason to prefer it.

**The second fact does not.** `createdByAppId` does populate, but not with our
app id: the page came back as `WLID-000000004D91A800`, a legacy Windows Live
identifier bearing no relation to the client id `4e484257-...` this product
configures. Two consequences, and the second is the serious one.

- The value cannot be derived from anything we configure. It can only be
  *discovered*, by creating a page and reading it back — so a Phase 2 check has
  no constant to compare against unless one is recorded at create time. Whether
  the value is stable across accounts is unknown; it has been seen on one.
- **"Non-empty means ours" is false.** Any app's pages carry a non-empty value,
  not merely ours, so that check would authorise touching pages this tool did
  not create. Only equality against our own value is sound. 0003 originally
  said only the empty case had been observed, and that framing invited the
  unsound check.

Observed in the same section: 8 pages carrying a third app's id
(`WLID-00000000418CF202`), alongside 2 handmade pages at `""` and our 1. Those 8
were generated by the notebook's owner through another MCP server while testing,
so they are not evidence about what a typical notebook contains — they are a
demonstration that the unsound check misfires on a real account.

**A real notebook is assumed to hold pages created by other apps, always.** Not
measured, and deliberately not going to be: the assumption is the conservative
one, since assuming their presence can only make the check stricter and never
laxer, and it costs nothing because equality against our own value is required
regardless. Treating "no other app has written here" as a possible state would
be the only way this becomes dangerous, so it is ruled out by assumption rather
than left to a survey nobody will run.

## What must still be verified before that second step

- **Whether `createdByAppId` is stable across accounts,** or must be recorded per
  page when we create it. The audit log already records enough to find a page
  again and is the natural place for it.
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
