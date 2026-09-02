# 0001 — Writes are allowed, per tool, opt-in, to Google Calendar only

Status: accepted. Supersedes the unqualified "no writes" rule for Google
Calendar and only for Google Calendar. Raised by issue #85.

## What the old rule said

`CLAUDE.md` said: "If you find yourself adding writes, sends, or
synchronization, stop." `docs/mvp-brief.md`, now split into `docs/scope.md` and
`docs/history.md`, said the read-only boundary **does
not rest on the Markdown**, because no write tool exists.

Both were true and both were load-bearing. Every "never write, send, book" line
in the agent pack descends from the first, and the second is what made an edited
playbook harmless — a user could rewrite a policy and still not reach their own
OneNote.

## What changed

A gig lives on a OneNote page and never reaches the calendar, so the musician is
the sync layer. That is the thing this product exists to stop being true. The
read-only rule was protecting against a class of harm — durable, external,
un-undoable change made on the agent's own judgement — and one write does not
belong to that class:

- A wrong calendar event is deleted in two seconds. A bad
  `onenote-patch-content` against a `data-id` target corrupts a page
  permanently, with no undo. Same reasoning as `policy:patch`: the recoverable
  side goes first.
- The calendar was already the derivative surface. OneNote is the knowledge
  base; Gmail and Calendar are supporting evidence. Writing to the evidence
  layer does not create a rival system of record for the work itself, which is
  the reason Google Tasks was left out.

## What is decided

1. **One operation: create an event.** Not update, not delete, not move, not
   respond, not sync. "Add all the gigs" is not a feature; one event per call.
2. **OneNote writes stay out of scope**, and this record does not open a path to
   them. `policy:patch` does not change — the musician still pastes page
   updates.

   > Since revisited, and only for creating: Microsoft publishes a create-only
   > permission, so a page the musician wrote cannot be touched by a token that
   > can create one. That is the inverse of the Calendar finding below and is
   > argued on its own terms in [0003](0003-onenote-writes.md). Editing was
   > revisited in turn: [0004](0004-onenote-page-maintenance.md) allows an
   > element-level change to a page this tool created, on a recoverability
   > argument this record did not have, and
   > [0006](0006-replacing-a-whole-table.md) extends it to whole tables.
   > Deleting a page stays out.
3. **Grants are opt-in at install time, named by capability, in one
   argument.** See "How the grant is expressed" below.
4. **A write tool that is not granted is not registered at all** — absent, not
   registered-and-refusing. A tool that exists is a tool a model will try, and a
   refusal in a tool result reads as an obstacle to route around.
5. **A disputed or `UNKNOWN` value may never become a calendar event.** Two
   pages disagreeing on a date is exactly what `policy:divergence` refuses to
   decide; a write would decide it silently, durably, and where other people see
   it. The write is refused and the refusal says why.

   **A choice made in chat does not settle it.** Offering the musician the two
   dates and writing whichever they pick leaves the notebook recording both
   while the event is durable and seen by other people: the calendar is a
   derivative of the page, and a page that contradicts itself has nothing to
   derive from yet. Observed in Claude Desktop — the model refused to guess,
   correctly, and then offered a menu of the two dates, which nothing in the
   tools would have stopped it acting on. `refuseUnsettled` cannot catch it,
   because by then the value is a clean date; the divergence lives in the pages,
   and no tool knows about pages. So it is stated in `policy:divergence` and in
   both calendar tool descriptions instead.
6. **The boundary is now a capability check, not the absence of a write path.**
   And the capability check is our code, not Google's — see "The scope layer
   stops being a guarantee" below.
7. **The tool never claims an event is missing.** It has no definition of
   "missing" and does not need one; see "What makes an event missing" below.
8. **A write is never offered unprompted.** This follows from 7: offering to add
   an event *is* the claim that one is absent, which is the claim we cannot
   make. The musician asks, or nothing happens.

## How the grant is expressed

One install argument carrying a list of capability names:

```
npx artist-mcp init --allow-writes=calendar-create
```

Today the list has exactly one legal value. An unrecognised name is refused by
name rather than ignored, the way a misfiled pack file is.

**Not a boolean, and not named for a harm category.** `--destructive` was
considered and rejected on two grounds:

- Creating a calendar event is not destructive — that is the whole argument for
  doing it first. A flag named for the category collapses the recoverable /
  unrecoverable distinction this record exists to draw, and inverts it: the day
  a genuinely destructive tool ships, everyone who typed the flag for a calendar
  insert has already granted it. No new consent moment, no reconnect, nothing in
  the config diff to notice.
- A boolean cannot tell `init` which scope to request. `scope` in
  `apps/mcp/src/oauth.ts` is a constant read at connect time, and a refresh
  token carries the scopes it was granted with — widening one later is a new
  consent, not a config change. A boolean therefore forces `init` to request
  every write scope the product has ever defined, for anyone who passes it.

**Not per tool either.** One flag, not one flag per tool. The list is the grant
set; a second write tool means the user edits that string, which is exactly the
consent moment worth keeping and the only cost the list has over a boolean.

## Where the grant lives, and what secures it

> **This section is about the published package only.** The hosted server holds
> many users' decryptable tokens, so the reasoning below does not transfer to
> it; see [0002](0002-hosted-writes.md).


In the `args` array of the Claude Desktop configuration file. **The security
boundary is therefore filesystem permissions on that file**, and this is chosen
rather than inherited: the OAuth tokens for every connected provider already sit
under the same trust on the same machine, so a grant string there widens nothing
that was not already reachable by anyone who could read them.

It follows that the grant is a property of an install, not of a user or an
account. Two installs on one machine can hold different grants, and copying a
configuration file copies the grant with it.


## What makes an event "missing"

Nothing, decided deliberately. Absence from a calendar search is exactly the
"cheap look that found nothing is not a finding" trap `policy:evidence` exists
for, and `list_events` has five separate ways to return nothing while the event
exists: free-text `q` missing a differently-worded title, `thinRecurring`
dropping occurrences past three per series, the page cap of 25, the default
window of −7 days to +365 days, and the calendar not being the one searched.
Cancelled instances are also dropped before the caller sees them, so "cancelled"
and "absent" arrive looking identical while wanting opposite responses.

Requiring several queries to all come back empty was considered and rejected: N
cheap looks that found nothing is the same trap in a bigger hat, and it fails
all five hazards at once rather than one at a time.

So the tool asserts nothing. Instead:

- **The day is enumerated, not queried.** Given a settled date, every event on
  that date is listed and shown to the musician. Absence becomes something a
  person observed rather than something a search reported. A settled date is
  required regardless, by rule 5.
- **That listing is the preview.** It costs no call that was not already being
  made, and it puts the evidence next to the claim.
- **The preview names its own limits** — which calendars were covered, and that
  the look was bounded. A preview that shows an empty day without saying
  "`primary` only" makes the strong claim while displaying the weak evidence.
- **A client-generated id, derived from the source page, guards duplicates.**
  Google accepts client-set event ids (base32hex, unique per calendar), so a
  retry collides instead of double-booking. This is a duplicate guard and not a
  definition of absence: an event the musician typed in by hand carries no such
  id, which is precisely the first-write case.

To make the calendar disclosure honest, `calendar.calendarlist.readonly` is
added to the **read** scopes. `calendar.events.readonly` does not authorise
`calendarList.list`, and secondary calendar ids are opaque addresses, so without
it "the day as it stands" silently means "the day on `primary`" for every
musician who keeps gigs on a separate calendar — and we could not detect that
such a calendar exists in order to say so. It is read-only, it is the narrowest
scope that closes the hole, and the reconnect it forces is one this issue
already requires.

## How a write is confirmed

Nothing inside MCP can prove a human read something. A tool result goes to the
model, not to the person, so a preview tool and a create tool can be called in
one breath with nobody in between. This is a limit of the protocol, not of the
design, and pretending otherwise is how a guarantee becomes a slogan.

So the defence is the one that got Calendar chosen over OneNote in the first
place: a wrong event is **detectable and reversible**, not prevented. What the
mechanism must deliver is that the exact event reaches the transcript before it
is written, that what is written is what was shown, and that a record survives.

**Two tools, with the second bound to the first.** `preview_calendar_event`
renders the event in plain language and returns a token derived from the exact
payload. `create_calendar_event` takes **the full event payload and that
token**, and the server recomputes the token from the payload and refuses any
mismatch. The create cannot happen for values that were never previewed, and
previewing one event and creating another is not expressible.

Carrying the whole payload on the create call, rather than the token alone, is
deliberate on three counts:

- Stateless. Nothing is held between calls, so there is no session store to
  expire, leak, or lose across a restart.
- Legible. A client that prompts before running a tool shows the arguments; a
  token-only call shows a meaningless hash, which is the moment a human most
  needs to see a date.
- Self-verifying. The token proves the payload was previewed *as these exact
  values*, not that some preview happened at some point.

### What this is not

Not a consent proof, and not a client behaviour. Claude Desktop's own approval
prompt is a real second layer for the users who have it, and it is worth having
— but it is not what this rests on. It offers "always allow", which is exactly
the case where a bad event would slip through silently; it renders raw RFC3339
and IANA names, which is not something a musician can check a gig against; and
the package is published to npm, where other clients need not prompt at all. A
boundary built on it could not be tested in this repository.

A `confirmed: true` argument the model supplies was considered and rejected
outright. The model sets it, so it constrains nobody, and it is a
refusal-shaped obstacle in a tool result — the exact thing this record says a
model reads as something to route around.

Out-of-band confirmation — the preview writes a pending event, the musician
runs `artist-mcp confirm` in a terminal — is the only option with a genuine
human gate, and it was not chosen. It breaks the musician out of the
conversation to complete the thing they just asked for in the conversation. It
is the fallback if an unwanted event ever reaches a calendar other people watch.
A code typed back into chat is not a substitute: it would be in the transcript,
where the model can read it.

### Degrading later

If preview-then-create proves more friction than it is worth, the intended
retreat is to stop requiring the token: one comparison deleted, one field made
optional, one sentence in the tool description, one line in the pack.
`preview_calendar_event` stays either way — as a read-only tool it earns its
place by rendering the event and naming which calendars were covered.

That retreat is only cheap because the create tool takes the payload. It is the
whole reason for that shape, and it is why two couplings are avoided:

- **The idempotency id is derived from the payload independently of the
  confirmation token**, from a different prefix. Were the double-book guard to
  ride on the token, dropping the token requirement would silently drop
  double-booking protection with it.
- **The mechanism is not a user-facing setting.** A per-install switch means two
  installs behave differently, the pack can no longer state one truth about what
  happens before a write, and every support conversation opens by establishing
  which mode someone is in. It is a decision changed in a release — reversible
  for the maintainer, not configurable for the user.

The direction matters too. Removing friction people have accepted is easy;
adding it to something they have got used to living without is not. That
asymmetry argues for starting here even if the destination turns out to be
simpler.

Pack wording therefore describes **what the tool requires**, not what a session
must always remember to do, so that it stays true under either mode.


## The scope layer stops being a guarantee

Stated plainly because the previous version of this boundary leaned on it.

`events.insert` is authorised only by `calendar`, `calendar.events`,
`calendar.app.created`, or `calendar.events.owned`. The realistic choice is
`calendar.events` — which is **read and write over all events, including update
and delete**, and which supersedes the read-only scope held today. Google
publishes no insert-only scope.

So the moment any write ships, the scope layer no longer constrains what the
code could do; it only constrains what it can reach. Nothing but our own closed
operation union and the registration-time capability check stands between this
product and a deleted event — and both of those are our code, not the provider's
enforcement.

Verified rather than assumed: `events.insert` and `events.delete` accept the
*identical* four scopes. Not overlapping lists — the same list. Google's scope
table splits by reach and by read-versus-write, never by which write, so there is
no create-without-delete grant to reach for.

`calendar.events.owned` — "see, create, change, and delete events on calendars
you own" — was considered. Identical power, strictly narrower reach: it excludes
calendars shared with the musician but owned by someone else, which is where a
wrong event does the most damage, since other people see it before the musician
does. It was set aside for now in favour of the wider `calendar.events`, to keep
the first write simple; reads stay on `calendar.events.readonly` regardless.
Worth revisiting if a musician turns out to keep gigs on a band or venue
calendar they do not own, or on the first wrong event written anywhere but their
own calendar.

`calendar.app.created` was considered, because it would keep a hard,
provider-enforced floor. It confines the app to a calendar the app itself
created, which is not the musician's calendar, so it defeats the purpose: the
gig has to land where they already look. Rejected on that basis, not overlooked.

The consequence is that the operation union and the capability check are now
load-bearing in a way they were not, and must be treated as security code:
adding an operation to that union is a boundary change, not a feature.


## What the guarantee is now

Weaker, and it has to be stated as weaker. Before, the boundary held because no
write path existed anywhere in the codebase. Now it rests on four layers:

1. Scopes granted to the token. These bound which *products* are reachable, but
   from the first write onward they no longer bound read against write within
   Calendar — see above. This layer is weaker than it was and is no longer the
   floor.
2. A closed operation union, each operation mapped to a provider.
3. A capability check at registration, against the grant set: an ungranted write
   tool is never exposed.
4. The playbooks, which describe 1–3 and add the disputed-value rule.

Layer 4 is the only one a user can edit. Layers 2 and 3 are now the real floor,
and they are ours to hold. The sentence in what is now `docs/scope.md` claiming the boundary
does not rest on the Markdown becomes false the moment the first write tool
ships, and is replaced as part of issue #85 rather than as a follow-up. An
unreplaced version is the `AGENTS.md` drift again.

Because a description outranks a playbook at the moment of a call, each write
gate lives in the tool's own description as well as in the pack.

## Deleting: only what this tool created

Added after the first real-calendar run, and narrower than it sounds.

`create_calendar_event` sets the event id itself, prefixed `artist`. That prefix
is the whole basis of this: **an event whose id does not begin with it cannot be
deleted**, so the capability is "undo what this tool did", not "manage this
calendar". A gig the musician typed in by hand is unreachable, and so is
everything shared onto their calendar by anyone else.

Two facts make this materially safer than it first reads:

- Google keeps deleted events in a per-calendar bin for **30 days**, restorable
  by anyone with edit access. Deleting is therefore closer to creating than to
  an `onenote-patch-content` against a `data-id`, which is what the whole
  recoverable-goes-first argument turned on.
- No new scope, and no reconnect. `calendar.events` already authorises
  `events.delete` — that is exactly the property this record complains about
  under "the scope layer stops being a guarantee". Here it means the expensive
  half of adding a write does not recur.

### What is different from create

The confirmation inverts. A create token binds to a payload the model composed;
a delete token binds to an event that **already exists**, so the preview fetches
the event and renders what would be removed. The server controls that payload
rather than trusting a description of it, which is stricter than create, not
looser.

The failure mode is also harder to notice. A wrong create leaves an extra event
someone can see; a wrong delete leaves a gap, and nobody notices absence. So the
audit line for a delete records **the whole event**, not a reference to it — 
enough to put it back by hand if the bin has expired.

### The bin holds the id

Deleting an event and then creating the same one again fails: the client-set id
is taken by the trashed event, and Google refuses to reuse it. Confirmed against
a real calendar rather than assumed.

The idempotency guard and the bin therefore work against each other, and the
answer that matters is which of the two "already taken" cases this is. "Already
in the calendar" is reassuring and, here, false — it sends someone looking for
an event they cannot see. So a 409 is followed by reading the event: a status of
`cancelled` means the bin, and the refusal says to restore it there and that
Google keeps it for 30 days. That is something a musician can act on.

### What would reverse this

An event deleted that this tool did not create. That would mean the prefix check
failed or was removed, and the capability should go back to not existing.


## Rescheduling: the pair, not an update

Added when moving a deadline turned out to be the commonest maintenance a
project-management sweep produces, and delete-then-create-by-hand turned out to
cost four confirmations and lose track of which event was which.

**It is deliberately not an update.** Google grants `PATCH` under the same
`calendar.events` scope, and this refuses it, because `idempotencyId` is a hash
of every field of the event. Identity here *is* content. Patch the date and the
event keeps an id that no longer describes it: the double-book guard stops
matching, and the next create of that same task lands a second copy nobody asked
for. Deriving the id from the content is what makes a retry safe and what makes
deleting safe to offer, and neither survives an in-place edit. `PATCH` and `PUT`
stay absent from `api.ts`, asserted by `test/operation-boundary`.

So `reschedule_calendar_event` writes the replacement and removes the original.

### The order is the design

New first, old second. Interrupted between the two, that leaves a **visible
duplicate**, which anyone looking at the calendar can see and clean up. The
other order leaves a gap, and — as the delete section above says — nobody
notices absence. A failed delete is therefore reported rather than swallowed,
naming the event left behind and the calendar it is on, because the musician is
now looking at two events and has to be told which is which.

Both halves are audited under their own operation names, so the log stays a
record of what actually reached Google rather than of an intention. A
half-completed move is two rows saying so.

### No new capability

It is gated on holding **both** `calendar-create` and `calendar-delete`. It is
exactly those two writes and can reach nothing either could not reach
separately, so a third grant would buy no safety — and would make every hosted
user consent again for permission they had already given. The operation table
carries it as one `write` row; the boundary test names it as such.

### What it costs, and callers must say so

The replacement is a new event with a new id. Reminders the musician set on the
old one, and notifications other people on a shared calendar arranged for it, do
not come across. The tool descriptions say this and the preview repeats it,
because it is invisible at the moment of confirming and only noticed later, when
a reminder does not arrive.

### Moving back hits the bin

The bin problem above applies with a twist. Move an event from A to B, then
move it back to A, and the create half is asking for an id the trashed original
still holds — so it fails, and `describeDuplicate` explains that it is in the
bin and restorable for 30 days. That is the correct answer rather than a
workaround: the original event is still there, and restoring it is cheaper than
writing a third one.

### What would reverse this

A `PATCH` or `PUT` appearing in `api.ts`, or an id that is not derived from the
event's own contents. Either means the invariant this rests on has been
abandoned, and rescheduling should go back to being two separate confirmed
operations.


## Consequences

- **Every existing Google connection must reconnect.** A refresh token carries
  the scopes it was granted with; adding a scope later does not widen it. The
  403 handling in the hosted path must tell "predates
  Calendar writes" apart from "read-only by choice" — different user actions.
  Two scopes are added at that reconnect, not one: `calendar.calendarlist.readonly`
  for everyone, and `calendar.events` only where a write is granted.
- Verification needs a disposable calendar. The MESSY notebook stays read-only.
- Preview then confirm, idempotency via a client-generated id so a retry cannot
  double-book, an audit line per write, and time zones stated explicitly.

## What would reverse this

If a created event is ever wrong in a way the musician does not catch before
someone else acts on it, the preview-and-confirm step failed, and the grant
model — not the wording — is what needs revisiting.
