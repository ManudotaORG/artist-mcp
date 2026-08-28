# 0003 — OneNote writes: create only, and let the provider enforce it

Status: **accepted; phase 1 shipped.** The create-only claim was observed
rather than quoted before any code was written, and the `createdByAppId` claim
corrected — see "What was verified". Phase 2's delete half is **ruled out**, on
evidence rather than on cost; its edit half is untested and undecided. Extends
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

That last clause was wrong, and finding out how wrong is what settled the
question. See "Deleting our own pages" below: the check it names cannot be
built.

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

## Deleting our own pages: ruled out, because the check cannot be built

Phase 2 assumed one question could be answered — "did this tool create this
page?" — and that `createdByAppId` answered it. Tested, it does not answer the
question that matters.

**`createdByAppId` identifies the creator, not the contents.** A page this tool
created, which the musician then renames and writes three paragraphs into, still
reports the tool's app id. 0003 listed that durability as a strength — the field
"survives the page being renamed, moved or edited" — and it is precisely the
failure. A delete gated on it would destroy the musician's work while correctly
reporting, by its own logic, that it touched only its own page. That risk is far
sharper than the calendar's: an event holds a line of text, while a page is the
working unit, and a page this tool wrote about a gig is exactly the page a
musician would then work in.

**The obvious fix does not exist either.** "Refuse if the page has been modified
since we created it" would have been a sound guard and cheap, since
`lastModifiedDateTime` is already read for `list_notes`. It does not move when a
page is edited in a OneNote client. Observed across three pages, three clients
including a phone, and two kinds of edit — Graph serving the edited content and
the original timestamp from the same resource, still unchanged 18 minutes later.
See #122, which is a bug in the read path quite apart from this record.

So there is no field distinguishing "a page we created" from "a page we created
that is now partly the musician's". Not a weak signal — none. **Delete is ruled
out on that ground**, which is stronger than the cost argument: even granted
`Notes.ReadWrite`, and even with the audit log recording every id we ever wrote,
the guard could not be written.

The recycle-bin question is therefore moot and was never run. It only mattered
as a way to make a wrong delete recoverable, and there is no delete to make
recoverable.

## What is still open

- **Whether `data-id` patching is survivable in practice.** Untested, and now
  the only phase 2 experiment worth the `Notes.ReadWrite` risk. `CLAUDE.md` says
  a bad patch corrupts a page permanently; that claim has never been observed
  either way.

  It is worth keeping open for a reason that is not "editing is phase 2's other
  half". A tool that *maintains* a page across sessions is a different proposal
  from an undo, and it does not need the ownership check that just failed —
  under maintenance the musician editing the page is the expected case, not the
  danger sign. It would collide with "one OneNote page is one working unit" and
  with `policy:patch`, so it needs its own record rather than an extension of
  this one. Nothing about it is decided, and phase 1 forecloses none of it: the
  scope it holds cannot patch, so no path has been opened by shipping.
- **Whether `createdByAppId` is stable across accounts.** Unanswered, and now
  largely academic — two consents on one account produced the same value, and
  nothing turns on it while no capability checks the field. The audit log
  records it at create time regardless, because it can only be learned then.

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
