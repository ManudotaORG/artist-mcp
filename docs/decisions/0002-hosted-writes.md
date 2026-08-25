# 0002 — Hosted writes are per user, or they are not worth having

Status: accepted, not yet built. Extends
[0001](0001-opt-in-calendar-writes.md) to the hosted custody model. Raised by
issue #98.

## Why 0001 does not settle this

0001 allows an install to create and delete Google Calendar events, and rests
its security argument on one sentence:

> the security boundary is filesystem permissions on that file — the OAuth
> tokens already sit under the same trust on the same machine.

That is true of the published package, where the user's tokens live on the
user's own machine and nothing server-side can read them. **It is false of the
hosted server**, which holds many users' refresh tokens encrypted in
`connections`, decryptable by a maintainer holding the service role and the
encryption key. Hosted users are told so before they connect; see "Hosted
credential storage" in [operations.md](../operations.md).

So the grant string is not the interesting part here. On a laptop a grant widens
nothing that was not already reachable by anyone who could read the tokens.
Hosted, **the grant widens the tokens themselves**: today a compromise of that
service reads calendars, and after a write scope it can delete them.

Conflating the two models is the mistake this record exists to prevent, and it
would have been easy — the code is shared, so the change looks like passing a
parameter.

## What is decided

1. **The grant is per user, stored server-side, and off by default.** Not a
   deployment-wide setting and not an environment variable. A deployment-wide
   grant would make every user's token write-capable to serve the few who asked.
2. **The write scope is requested only for a user who has opted in.** This is
   the whole argument. A user who never opts in holds a read-only token, so a
   compromise of the service cannot write their calendar. The blast radius
   becomes "users who asked for it", which is the same bargain the local model
   makes rather than a weaker one.
3. **Opting in requires reconnecting.** A refresh token carries the scopes it
   was granted with and cannot be widened, so this is a real step for the user,
   not a checkbox that quietly takes effect. Saying so up front is part of the
   consent.
4. **The audit becomes durable server-side state.** `apps/mcp/src/audit.ts`
   appends to `~/.artist-mcp/writes.log`, which on a serverless host is a file
   nobody will ever read. "Detectable and reversible" is the entire
   justification for calendar writes existing in 0001; hosted shipping without
   the detectable half would be strictly worse than the local case, not
   equivalent. It must record enough to reverse a write by hand.
5. **The capability names are the same ones.** `calendar-create` and
   `calendar-delete` mean what they mean in 0001, including that delete only
   reaches events this tool created. One vocabulary across both models, or the
   playbooks and the docs need two.
6. **Grants are a parameter, never process state.** Done in `f860fbe`, ahead of
   the rest: one process serves many users there, and a grant held in a module
   and set per request would let one user's capability reach another's session.
   It would have passed every test in the suite, because they all run one user
   at a time.

## Timing, which is the reason this is not deferred

A token's scopes cannot be widened after the fact. Every hosted user who
connects before the grant exists holds a read-only token and must reconnect to
gain a write. Building this before the first real user is a design decision;
building it after is a migration that reaches every account.

That is the whole argument for doing it now rather than when it is wanted.

## What is deliberately not decided here

- **Whether hosted offers create, delete, or both at launch.** The narrow case
  for delete-only is that it can only reach events this tool made, so a leaked
  write-capable token is bounded by what the product itself created. The case
  against is that creating is the feature users want and deleting alone is odd.
  Worth deciding with a real user in mind rather than in the abstract.
- **Where exactly the grant is stored.** `connections` is per user *per
  provider*, while a grant is per user. A column there would repeat itself; a
  separate table is one more thing to keep in step. Either is defensible and
  neither is interesting enough to settle in advance of writing it.
- **Whether to record the granted scope.** `connections` has no scope column,
  which is why the hosted refresh now sends none — the correct fix, since
  omitting it returns exactly what was granted. Storing it would let the app
  show a user what their connection can do, which is a reporting feature rather
  than a boundary.

## What would reverse this

A hosted user's calendar changed by anything other than that user's own
confirmed request. That would mean either the per-user grant did not bound what
it was supposed to, or a write reached a session that was never granted one, and
the capability should go back to not existing on the hosted surface.
