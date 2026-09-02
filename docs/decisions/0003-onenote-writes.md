# 0003 — OneNote writes: create only, and let the provider enforce it

Status: **accepted; phase 1 shipped.** The create-only claim was observed
rather than quoted before any code was written, and the `createdByAppId` claim
corrected — see "What was verified". **Deleting and replacing are ruled out
permanently**, because a Graph write leaves nothing recoverable — not because
the scope is too broad, which turned out to be false. Appending is undecided and
is a different question. **The permanence claim did not hold**, and
[0004](0004-onenote-page-maintenance.md) says why: replacing was measured here
against the page body, where nothing can be salvaged, and a paragraph-level
replace is small enough to capture before it is overwritten. Read that record
alongside the "nothing can be undone" section below, which is correct about the
operation it tested and wrong about the operation that was available. Extends
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

Both halves of that paragraph turned out to be wrong, and the sections below
say how: `Notes.ReadWrite` is not the only door, and `createdByAppId` is not a
usable check. Neither matters in the end, because a Graph write leaves nothing
recoverable.

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

## Deleting and editing our own pages: ruled out, because nothing can be undone

This section was rewritten after being wrong twice. Both wrong versions are
worth stating, because the same mistakes are available to the next person.

**Wrong the first time:** that `createdByAppId` answers "did this tool create
this page?" It answers it, but that is not the question that matters. The field
identifies the creator, not the contents. A page this tool created, which the
musician then renames and writes three paragraphs into, still reports the tool's
app id — so a delete gated on it destroys their work while correctly reporting,
by its own logic, that it touched only its own page. `lastModifiedDateTime`
would have been the guard for that, and it does not move when a page is edited
in a OneNote client (see #122). Neither signal distinguishes "our page" from
"our page that is now partly theirs".

**Wrong the second time:** that the only door was `Notes.ReadWrite`, granting
edit and delete over every page in the notebook, so the restriction would become
ours to enforce again. That premise was false, and the evidence had been in hand
for hours inside a 403 body that was truncated before the end of the sentence.

## `Notes.ReadWrite.CreatedByApp` exists, and it works

Microsoft names it in its own refusal, for both operations:

```
Please make sure you are including one or more of the following scopes:
  Office.onenote_update, Notes.ReadWrite,
  Office.onenote_update_by_app, Notes.ReadWrite.CreatedByApp, ...
```

It is grantable on a consumer account — consent returned
`Notes.Read Notes.ReadWrite.CreatedByApp Notes.Create`, folding in create
without being asked — and it is enforced precisely. Tested in a real notebook:

```
PATCH a page the musician made by hand   -> 401  40003 Access Denied
PATCH a page another app created         -> 403  40006 "no permission to edit
                                                  the page created by a
                                                  different application"
PATCH a page this tool created           -> 204
DELETE a page this tool created          -> 204
```

It distinguishes *this* app from *another* app, not merely "some app". That is
the provider-enforced version of exactly what this record wanted, and it is the
strongest form available.

**It is absent from the documentation for the operations it enables.** The
permissions table on `page-delete` lists only `Notes.ReadWrite` and
`Notes.ReadWrite.All`, and says higher privileges are "not available" for a
personal account — while a personal account deleted a page with
`Notes.ReadWrite.CreatedByApp`. This is the third divergence between the OneNote
documentation and its behaviour found here, after `lastModifiedDateTime` and the
undocumented delete semantics below. **Treat the reference as describing intent,
and probe for behaviour.**

## What actually rules it out: nothing can be undone

The scope removed the objection. Recoverability closed the question anyway, on
0001's original grounds — *OneNote is the knowledge base and has no undo.*

Tested against a real notebook, on this account:

| Operation | Result | Recovery |
| --- | --- | --- |
| `DELETE` a page | `204` | **not in the notebook recycle bin** |
| `PATCH` replacing the body | `204` | **no page version retained** |

The Graph documentation says nothing at all about either — `page-delete`
specifies the verb, the `204`, and an empty body, and is silent on permanence.

0001 permitted calendar deletion because Google keeps a deleted event for 30
days, and said so explicitly: that recoverability is what moved delete from
"unrecoverable" to "closer to creating". There is no such bin here. **A wrong
delete is permanent, and a wrong replace destroys what it overwrote.** No amount
of provider-enforced scoping changes that, because the scope governs *which*
pages can be destroyed, not whether destruction can be undone.

One caveat, recorded rather than glossed: OneNote may create versions for edits
made in its own clients and not for API edits, and only the API path was tested.
"OneNote has no version history" would be the wrong summary. "A Graph write
leaves no recoverable trace" is the right one — and it is the API path this tool
would use.

## The line is additive versus destructive, not create versus edit

Both 0001 and the first draft of this record framed the boundary as create on
one side, edit and delete on the other. The evidence puts it elsewhere:

- **Additive** — creating a page, and `PATCH` with `action: append`. Nothing
  existing is lost. A mistake leaves something the musician deletes by hand,
  which is exactly the position phase 1 already ships in.
- **Destructive** — `PATCH` with `action: replace`, and `DELETE`. Content ceases
  to exist, with no bin and no version.

Phase 1 is on the additive side, which is why it was safe to ship. Deleting and
replacing are on the destructive side, and stay out **permanently, on
recoverability grounds** — not because the scope is too broad, which is no
longer true and will be rediscovered as untrue by whoever reads the permission
error next.

> Superseded for replacing by [0004](0004-onenote-page-maintenance.md), on the
> grounds this paragraph names as its own reversal condition. The recoverability
> objection was measured against a *body* replace, which rewrites the page and
> leaves no pre-image worth keeping. An element-level replace has one, and 0004
> makes capturing it mandatory. **Deleting stays out, permanently and on these
> same grounds.**

Appending is the interesting case this reframing exposes. It carries phase 1's
risk profile rather than delete's, so a future page-maintenance capability is
not automatically disqualified — but it needs its own record, and it must be
`append` with `replace` unreachable rather than "patch" as a general power. See
"What is still open".

## What is still open

- **Whether `data-id` targeting is survivable for an append.** `CLAUDE.md` says
  a bad patch corrupts a page permanently. A body-level `append` was tested and
  behaved; targeting a specific element by `data-id` was not.
- **Whether a maintenance capability is wanted at all.** It is a different
  proposal from an undo, needing no ownership check — under maintenance the
  musician editing the page is the expected case, not the danger sign. It
  collides with "one OneNote page is one working unit" and with `policy:patch`,
  so it wants its own record rather than an extension of this one. Nothing about
  it is decided, and phase 1 forecloses none of it: the scope it holds cannot
  patch at all.

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

The reverse, reopening delete or replace, needs one thing and it is not a
better scope: a way to undo them. If OneNote gains a recycle bin that catches a
Graph delete, or retains a version across a Graph patch, the argument changes
and this record should be revisited. Until then, `Notes.ReadWrite.CreatedByApp`
being available is not a reason — it was available all along.
