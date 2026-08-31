# 0005 — What a patch is, now that one can be applied

Status: **accepted.** Governs `policy:patch`, which
[0004](0004-onenote-page-maintenance.md) built the capability for and
deliberately did not rewrite. Raised by the state 0004 left behind: a granted
install holds tools the playbook tells it not to use.

## The problem 0004 created

`policy:patch` opens by saying what it is:

> They paste it. The page is unchanged until they do, and nothing here can
> change it — so a patch is written as something to paste, never as something
> that has happened.

Every boundary in that policy descends from the clause in the middle. "Never
claim a page was changed" is not a rule about honesty in the abstract; it is
true because no page could be changed. "It is offered, and it stays offered
until they say otherwise" describes a fragment sitting in a file, not a
decision anybody declined.

0004 made the clause false for some pages. Applying a patch therefore does not
relax those lines — **it removes the reason most of them exist**, which is a
different and more dangerous thing, because a rule whose reason has gone stops
being followed in ways nobody notices.

## What does not change, and why it does not

Three of the policy's rules never depended on the tool being unable to write,
and they get stronger rather than weaker now that it can:

- **A patch records a decision the musician made.** A fragment for something
  they have not settled was a suggestion wearing the clothes of a record when it
  had to be pasted. Applied, it is simply a value nobody chose, written into the
  knowledge base by the thing that invented it.
- **Never invent a value.** `UNKNOWN` stays `UNKNOWN`, and the cells beside the
  one that changed stay as they are.
- **The smallest fragment that records it.** This was partly about sparing the
  musician a diff. It is now also mechanical: a replace overwrites the element
  it names, so a fragment larger than the decision destroys more than the
  decision touched.

## The rule that decides everything else: whose page is it

The capability reaches pages **this tool created** and no others. That is
Microsoft's boundary, not ours, and it does not need restating as policy. What
does need stating is that the model cannot discover it cheaply:

**Reading a page always works. Only writing is refused.** So a preview of an
edit to the musician's own page succeeds, shows a change, and invites a yes —
and the `401` arrives afterwards. Nothing in the product prevents an offer that
cannot be honoured, and `createdByAppId` does not close the gap:
[0003](0003-onenote-writes.md) established that it holds an opaque value which
can only be discovered rather than derived, and that "non-empty means ours" is
false.

So the policy rule is drawn where the model can actually see it:

> **Offer to apply a patch only to a page you can see this tool created** — one
> it created in this conversation, or one recorded as its own in this install's
> write log. Everywhere else, hand the fragment over to be pasted, exactly as
> before.

That is deliberately narrower than what the tool permits. A page created by this
app on another machine is editable and will not be offered, and that is the
right trade: the cost is a paste that was not strictly necessary, against an
offer that fails after the musician has already said yes.

It also lands the capability where it was actually wanted. A consolidated page,
a filled-out template — pages this tool made and is still holding — are exactly
the pages it can see it made.

## Applying is not a lighter kind of offering

The confirmation flow is not the musician's consent. It is a check that the
values are the ones that were shown, and it cannot tell whether anybody read
them. So:

- **Ask before applying, in words, every time.** The preview is shown and the
  yes is waited for. This is unchanged from creating a page and from every
  calendar write, and it is not softened because an edit is smaller.
- **Offer once.** Unchanged. A second offer read as chasing when it meant
  pasting; it reads worse when the tool could just do it.
- **A declined patch is declined.** Not re-offered in another form, and not
  applied later because the conversation moved on.

## What may be replaced, and what may only be added

`append` and `replace` are one grant because no scope separates them
(0004). Policy separates them, because their consequences differ:

- **Appending** adds to the end of a page and destroys nothing. Its failure mode
  is clutter the musician deletes.
- **Replacing** overwrites an element. OneNote keeps no version, so what it
  overwrote survives only in this install's write log — and that log is on this
  machine, not in the notebook where the musician would look for it.

So a replace is confined to **a value this tool itself wrote, which the musician
has now settled differently**. Correcting a fee on a page it generated is the
case this exists for. What it may not do is overwrite something the musician
typed into a page this tool created — that page is the tool's output right up
until they write on it, and their words are theirs wherever they put them.

Where a decision contradicts something already on a page and that something is
not this tool's own text, the original rule stands unchanged: **say both, and
let them choose what to do with the old one.**

## Never claim more than happened

The old rule was "never claim a page was changed". The new one is harder,
because now it sometimes was:

- Say a page was changed only when the tool reported changing it. Not when a
  patch was offered, not when a change was previewed.
- **Never call it undoable.** OneNote has no version history and no recycle bin
  for a Graph write. What was overwritten is in this install's write log; that is
  a real recovery and it is not one the musician can perform in OneNote, and
  saying "I can undo that" implies something the notebook cannot do.
- A page that looks patched is a page you have re-read. Unchanged, and now with
  a second reason: generated ids move after every write, so anything remembered
  about a page's structure is stale the moment it is changed.

## What does not change at all

`policy:divergence` still governs two pages recorded as one event, and nothing
here touches it. In particular the cross-reference is still **offered, never
applied**: it goes onto both pages, and the pages it names are the musician's
own. Nor may two pages be patched into agreement with each other — an ability to
write does not turn a disputed value into a settled one, and this is the failure
mode the whole divergence policy exists to prevent.

## What would reverse this

An applied patch the musician did not ask for, or one that overwrote their own
words on a page this tool had created. Either means the ownership rule above was
read as being about pages rather than about text, and the capability should go
back to offering only.
