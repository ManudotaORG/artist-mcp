# Scope

What this project is, what shipped, what is deliberately out, and what is
deferred. The setup checklists and the architecture snapshot that this file
began as are in [history.md](history.md) — they are a record of how it was
built, not a description of what it is.

## What it is

A multi-tenant web app where a user connects their Microsoft account, plus an
MCP server — published to npm — that reads that user's OneNote notes and applies
musician workflow playbooks. One OneNote page is one working unit, and every
result stays in Claude or Codex chat. Reading is the default; four write
capabilities exist and each is granted by name at install time.

## What shipped

The last stale entry here is corrected in place rather than quietly dropped, so
the correction stays visible.

- [x] Installable Markdown pack with Orchestrator, Archivist, Registrar, Project Manager, Envoy, Auditor, and Janitor roles
- [x] Starter project types: Concert, Large Concert, Studio Session, and Rehearsal
- [x] One OneNote page treated as one working unit
- [x] Registry generated during package build with SHA-256 checksums
- [x] Results shown only in chat; no send, sync or background execution capability. This originally also said "no write" and "no calendar": four write capabilities have since shipped, each opt-in per install — see "Not in scope" below.

### Playbooks a user can edit — beyond the original brief, deliberate

The brief said the pack is installable, not that it is the user's to change. It
became worth doing once the playbooks were the thing being tuned per musician:
a fixed pack means every adjustment is a package release.

- [x] Two installs and nothing between them: the default runs the shipped checksummed pack, and `init --editable [directory]` copies all of it somewhere the user owns, where every playbook is theirs — per-file opt-in was built first and removed, because it kept ids tracking the package only by making the user remember which files were theirs
- [x] The editable install is re-runnable, which is what replaces that bookkeeping: playbooks new in a later version are added, edited files are left alone and named in the summary, and nothing is ever overwritten — verified on a seeded directory with one file edited and one removed to stand in for a new release
- [x] `init --editable` records an absolute path in the Claude Desktop entry's args and seeds before writing the config — verified: a directory it cannot use fails with the config byte-for-byte untouched
- [x] Local entries shadow the bundled pack by id, so an edit to one project type neither forks the other twelve nor blocks a playbook added by a later version
- [x] `agents status [directory]` prints every entry with its source, and `list_agent_workflows` names the entries that are the user's own, with the file to edit, so a transcript never presents edited rules as shipped ones
- [x] A playbook that cannot be read is reported as NOT IN FORCE rather than falling back to its one-line summary — the old behaviour dropped a project type from the classification silently, which is what this layer exists to prevent
- [x] The layout is exact — `<.artist|artist>/<roles|project-types|policies>/<name>.md` — and a misfiled file is refused by name rather than silently becoming a policy; a standalone directory gets the visible container so the folder does not look empty in a file browser
- [x] A missing or broken local directory fails loudly rather than falling back to the bundle the way an unreachable remote registry does
- [x] Files capped at 64 KiB, empty files refused, paths contained against the local root
- [x] Derivation shared by the build script and the runtime, with a test asserting the committed registry still matches it — two copies would give the same file different ids, and a user's edit would then shadow nothing
- [x] Policies that must hold unprompted load in full, not as summaries: `answering`, `evidence`, `divergence`, `patch` alongside `intake`. Found the hard way — the rule protecting the user's mailbox lived in `AGENTS.md`, which the server never loads, and a Desktop session read Gmail and Calendar unasked. A rule in a role is not in force; see "Editing the pack" in `docs/agent-pack.md`
- [x] The MCP handshake tells the client to load the playbooks, so they are in force on a client with no repository to read `AGENTS.md` from — which is Claude Desktop, the surface `init` configures. Without it `list_agent_workflows` was a tool nothing called, and a session read the notebook, reasoned well, and followed no policy at all. A day of testing was spent diagnosing playbook wording on that basis; the stdio test fails without the fix
- [x] `AGENTS.md` restates no rules. It is the one copy nothing checksums and nothing loads, and every summary in it drifted — three always-loaded policies after there were five, and phrasing `policy:divergence` was rewritten to forbid, months stale. It now names where the rules are and stops
- [x] `policy:patch` closes the loop from an agreed recommendation to the page: the smallest fragment that records the decision, the destination named as the page words it, unsettled fields left `UNKNOWN` including the cells beside the one that changed, and never a claim the page was updated. Verified in Claude Desktop against the messy notebook — a cross-reference offered unprompted on a suspected twin and adapted to a pair whose identity facts conflict, and a consolidated page carrying two settled values with the two the musician was unsure of left `UNKNOWN`, every fact naming its source page, both originals untouched. Each pasted into OneNote with its bordered tables intact
- [x] Constraints on when a tool may be called live in the tool's own description, not only in a playbook — `list_events` described the calendar as corroborating "what a page claims about a date", and a model facing two pages disagreeing about a date read that as an instruction while the policy forbidding it was loaded and lost
- [x] Verified end to end in Claude Desktop, following the documented four-step workflow against a deliberately messy 11-page notebook holding three planted near-duplicate pairs: pages listed, each classified with evidence (a three-line page called too thin rather than labelled, two pages named as supporting evidence rather than working units, a wedding named as a missing playbook rather than forced into Concert), three HTML templates derived one per matched playbook with every field UNKNOWN and no page data in them, and the messiest page filled onto its template with 64 gaps left visible, a disputed seat count carried as disputed with both sources named, and a computed rehearsal date kept out of the artefact and marked in chat as worked out. No Gmail or Calendar call at any step

Checksums mean something narrower for a local file: derived from the directory as
it is read, they prove only that it did not change between being listed and being
loaded. The user is the authority on their own files. **The boundary does not
rest on the Markdown** — an edited playbook can make the analysis worse, but it
cannot reach a tool that was never registered.

That sentence used to read "it holds because no write tool exists". It does not
hold that way any more, and the weaker true version is worth stating plainly:
the boundary is a capability check plus a closed operation union, both of which
are this repository's own code rather than something Google enforces. See
[decisions/0001-opt-in-calendar-writes.md](decisions/0001-opt-in-calendar-writes.md).

## Opt-in Calendar writes (issue #85)

Off by default. A grant at install time, one event, previewed and confirmed.
Decisions and their cost: [decisions/0001-opt-in-calendar-writes.md](decisions/0001-opt-in-calendar-writes.md).

- [x] A decision record written before any code, because `CLAUDE.md` told a
      contributor to stop on seeing a write and would otherwise sit beside the
      new behaviour with no way to tell which was current
- [x] The operation table is enforced, not asserted: `test/operation-boundary`
      fails on any edit to it, and on any non-GET beyond the single sanctioned
      POST. This matters more than it reads — Google publishes no insert-only
      Calendar scope, `events.insert` and `events.delete` take the identical
      four, so the scopes stopped separating create from delete and this table
      is what replaced them
- [x] `calendar.calendarlist.readonly` added to both scope lists, guarded
      against drift, so absence can mean something: `list_calendars` names what
      was covered, and degrades to a stated limitation on a connection made
      before it rather than reporting an empty result
- [x] A 403 for a missing scope says which grant is missing rather than "this
      connection predates Calendar", which was about to be false and alarming
      for someone whose calendar reading works perfectly
- [x] The grant is one install argument naming capabilities, in the Desktop
      entry's args; an unknown name is refused by name, and `init`, `status` and
      the workflow briefing each report what is in force
- [x] An ungranted write tool is not registered at all — verified: 12 tools
      without the grant, exactly those two more with it. Those counts are what
      that run measured, before the page-attachment tools and the OneNote
      capabilities existed; the property they check still holds, against 14
      ungated tools and four capabilities today.
- [x] Preview then create, with the create bound to the previewed payload by a
      token; unsettled values (`UNKNOWN`, `TBC`, a disputed date) refused in
      code rather than only in a playbook; timed events refused without an IANA
      zone; no retry on create; a 409 reported as already there; an audit line
      per write in `~/.artist-mcp/writes.log`
- [x] The pack and the docs corrected in the same work, not deferred — every
      "read-only" claim across `CLAUDE.md`, `README.md`, `PRODUCT.md`, the brief,
      `agent-pack.md` and four pack files
- [x] Deleting, narrowed to events this tool created: the `artist` id prefix is
      the whole basis, checked before the event is even fetched, so a gig the
      musician typed in or one shared onto their calendar is unreachable. The
      confirmation token is over the event as Google returns it rather than as
      anyone described it, and the audit records the whole event, because nobody
      notices an absence. No new scope and no reconnect — Google has one scope
      for insert and delete
- [x] **Verified against a real calendar.** Not done. Every test is a `fetch`
      stub, so Google's actual behaviour for a client-set id, a 409 on a
      duplicate, and the 403 shape when a token lacks the write scope were all
      assumptions. Creating is now verified against a real calendar: the
      client-set id is accepted, the duplicate 409 is reported as already there,
      and the zone survives the round trip. Deleting is verified too: a real
      event the musician made was refused by the prefix check, a stale token was
      refused, the delete removed only what it showed, and recreating the same
      event afterwards fails because the trashed event still holds the id — now
      reported as "it is in the bin, restore it there" rather than as "already in
      the calendar", which was false and unactionable. Four bugs came out of
      running it for real: the audit sat above the write, the suite polluted the
      real audit log, the deletion preview showed a UTC instant labelled with the
      event's zone, and the duplicate message was wrong after a delete
- [ ] Verified end to end in Claude Desktop with the grant, against the
      disputed-date pair, confirming a write is refused while a page is in that
      state

## Not in scope

No autonomous agent processes. No writes to Gmail, ever. No message sending. No scheduled jobs. No teams or organisations. No billing. No copying or synchronizing source data. No workflow state in Supabase.

This line originally read "No writes to any source — not OneNote, Gmail, or Calendar", and then "No writes to OneNote or Gmail, ever". Both are corrected here rather than quietly left standing, and the OneNote half had already been stale for a release:

- **Creating a Calendar event** shipped as an opt-in, and deleting one this tool created followed. Updating and moving an event are still out: rescheduling creates the replacement and deletes the original precisely so that no `PATCH` is needed. See [0001](decisions/0001-opt-in-calendar-writes.md).
- **Creating a OneNote page** shipped as an opt-in under [0003](decisions/0003-onenote-writes.md), which is what made "no OneNote writes, ever" stale.
- **Editing a page this tool itself created** is opt-in under [0004](decisions/0004-onenote-page-maintenance.md), on a scope Microsoft enforces per application: a page the musician wrote is refused `401`, not merely unrequested. A replace captures what it overwrites first, because OneNote keeps no page version and that capture is the only undo there is. [0006](decisions/0006-replacing-a-whole-table.md) extends it to tables — where a filled-in page actually keeps its content — because OneNote supports no update to a `tr` or a `td` and the whole table is therefore the unit. A table is written as markup, previewed as its rows, and every cell not being changed has to be carried across unchanged.
- **Deleting a OneNote page is still out**, and not for want of a scope. A Graph delete leaves nothing in the notebook recycle bin, so there is nothing to capture and nothing to restore.

This line originally also read "No calendar. No Google. No web app deployment." All three have since shipped, so it is corrected here rather than quietly left standing:

- **Google is connected**, and Gmail and Calendar are read as **supporting evidence only** — they corroborate or fill gaps in a OneNote page and are never themselves a working unit. Reads only: `list_emails`, `read_email`, `list_events`, `read_event`, and the attachment pair. That asymmetry is what kept the one-page-one-unit rule intact when the sources grew; see [CLAUDE.md](../CLAUDE.md).
- **The web app deploys** to two Vercel projects, staging and production, connected to the repository through the Vercel GitHub App. See [operations.md](operations.md).

Each new source means re-deciding the rule, not repeating it. Google Tasks was considered and deliberately left out: a task list is a rival system of record for the work itself, not evidence about it.

## Known gaps — deferred, not forgotten

Deliberately out of the MVP. Recorded so they aren't rediscovered as surprises.

1. **Microsoft disconnect implemented and verified in staging.** The dashboard
   exposes a confirmed disconnect action backed by `disconnect_microsoft()`,
   which atomically deletes the user's encrypted Microsoft refresh token and
   every MCP key. A rollback-only authenticated staging fixture proved both
   rows disappear together and left no test user behind. The connection-key
   action is disabled while Microsoft is disconnected.

2. **Rate limiter can't limit unauthenticated callers.** It keys on the sha256
   of the presented key, so garbage keys get a fresh bucket every request. Keys
   are 32 random bytes, so this is a cost and availability risk, not a data one.
   A real fix needs shared state. Internal to the function — fixable without
   touching the `/v1/` contract.

3. **Key→user isolation was observed at the API, on a design since retired.**
   Verified 2026-08-12 against production with two real Supabase users, two real
   Microsoft accounts, and a temporary key per user, all revoked afterwards.
   Kept as a record rather than a live concern: connection keys and server-side
   token resolution are gone, so the mechanism these results describe no longer
   runs. What replaced it cannot leak between users because nothing holds both
   users' credentials.

   The results were:

   - A key resolves to its own user. A user holding no connection is refused
     — "No Microsoft connection" — rather than served another user's notes, on
     both the Microsoft and Google paths.
   - User B's page list excludes a page private to User A.
   - User B presenting User A's private page id to `read_note` is refused with
     a Graph 404. User A reading the same page succeeds, so the refusal is
     isolation, not a broken id.

   The clean-machine half is closed: the two-user test was run on two machines,
   and the published package has since been installed from npm and exercised
   directly. Neither is a database fixture, which was the original objection.

   **A shared notebook makes overlapping page lists meaningless as evidence.**
   The two accounts here shared sixteen of seventeen pages, so a naive "the
   lists must not intersect" check reports a leak where Microsoft is correctly
   honouring its own sharing. Any future isolation check needs a private page
   with a unique marker; the assertion needs a page the other account genuinely
   cannot reach, not merely a different list.

4. **One key per user.** Generating replaces the old, so two machines cannot
   hold separate keys.

5. **One Google OAuth client serves every environment.** Local, staging, and
   production all present the same `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`,
   differing only in `GOOGLE_REDIRECT_URI`. This is the opposite of how the
   Supabase and Microsoft credentials are handled, where the environment matrix
   in [operations.md](operations.md) keeps production values out of staging, so
   it is a deliberate exception rather than an oversight: a leaked staging
   secret would be usable against production.

   Accepted because `gmail.readonly` is a restricted scope, and a second client
   means a second Google verification review — weeks of it — for an environment
   that holds no real data. Split them before Gmail reaches production users,
   not before it reaches staging. Splitting costs one new client, its own
   redirect URI, and the staging values in Vercel and the edge function; no code
   changes, since nothing hardcodes a client id.

6. **Email is read one message at a time, never as a thread.** `list_emails`
   returns a `thread_id` and nothing consumes it, so a negotiation has to be
   reassembled from separate reads and only if the model thinks to look.

   The failure is quiet and in the wrong direction: a fee, date, or lineup
   agreed in the first message and revised three replies later reads as settled,
   because the message carrying it looks complete on its own. Intake's rule is
   to surface contradictions with both sources named — a half-read thread hides
   the contradiction instead, which is worse than not reading the mail at all.

   Deferred rather than dismissed. A `read_thread` operation is a small addition
   on the same connection and scope; what needs deciding first is how a thread
   is summarised without pouring quoted history into chat.

7. **`apps/mcp/dist/` is no longer tracked.** Resolved. It had drifted from
   `src/`: release-please rewrites the `x-release-please-version` line in `src/`
   and `package.json`, nothing rebuilt the committed copy, so on `main` at
   v1.0.1 the source said `1.0.1` and the committed `dist/server.js` said
   `0.8.0`.

   **No published version was ever affected**, which is worth stating because
   the opposite was assumed at first. The release job's test step runs
   `pnpm run build` before publishing and `prepublishOnly` builds again; the
   v1.0.1 tarball on npm was pulled and checked, and reports `1.0.1`. The drift
   existed only in git.

   What it cost was local: generated files turning up as diffs and conflicts,
   and `init --local` running stale code for anyone who checked out without
   building. Fixed by untracking it rather than by building in the release job —
   CI already builds, which is precisely why users never saw it. `files` in
   `package.json` is an allowlist that overrides `.gitignore`, so the tarball is
   unaffected; verified with `npm pack --dry-run`, and the suite passes with
   `dist/` deleted outright.

   `agent-pack/registry.json` stays tracked despite also being generated. It is
   small, reviewable, and regenerating it is part of changing executable policy,
   so a test asserts the committed copy still matches what the derivation
   produces — a review signal rather than noise.

8. **Node 20 reaches Vercel's build cutoff on 1 October 2026 — settled for the
   deployments, open for the repo's own versions.** Vercel emailed on
   14 August 2026: Node 20 is end-of-life, and after that date new builds using
   it fail. The mail named one affected project, `nextjs` in
   `highnets-projects` — **not** `artist-mcp` or `artist-mcp-staging`.

   Confirmed on 2 September 2026: `vercel project ls --scope highnets-projects`
   reports both `artist-mcp` and `artist-mcp-staging` on **24.x**. Neither was
   ever on 20, and the cutoff is no longer a risk to either deployment. The
   version is a dashboard setting, so that command — not this repository — is
   where to read it.

   Nothing here overrides it, which is the part worth knowing. Vercel warns that
   an explicit `engines.node` in `package.json` beats the dashboard, and
   `apps/web` sets none — so whatever the dashboard says is what builds, and a
   repo change would not fix a project left on 20.

   Separately, the versions this repo names still disagree: `.nvmrc` pins
   `22.22.2`, CI, the release workflow and both Vercel projects use `24`, the
   root and `apps/mcp` `engines.node` say `>=20`, and the README tells users
   "Node 20 or newer". `.nvmrc` is now the odd one out against everything that
   actually builds.
   The `engines` floor is a real compatibility promise about *users'* machines
   rather than untidiness, so raising it decides who can still install the
   package — but it currently promises support on a runtime with no security
   updates. Aligning `.nvmrc` with the 24 that CI actually uses is the smaller,
   separate half.

   Remaining action, no longer dated: decide whether `.nvmrc` should follow the
   24 that CI and both Vercel projects actually run, and whether `engines.node`
   should still promise a runtime with no security updates. Nothing is failing
   on either count.

9. **Staging builds misreported their own version over MCP.** Fixed. `set-staging-version.mjs`
   rewrites `package.json` and nothing else, while `src/server.ts` carries the
   version as a Release Please `extra-file` updated on `main` only. So a staging
   build announces whatever `release` last committed: `1.0.2-staging.51` reported
   `1.0.0` in the MCP handshake, checked by pulling the published tarball.

   Same shape as gap 7 and a different mechanism, which is why fixing that one
   did not fix this. Production is unaffected — Release Please updates both files
   together — so this only misleads while testing staging, exactly when the
   version is what you are trying to confirm.

   The script now sets both, matching the `x-release-please-version` marker
   Release Please looks for, and throws if that marker is missing rather than
   skipping — a silent skip is what produced the bug. It rewrites files in CI
   before the build, so the value reaches `dist/` and the tarball and is never
   committed. Verified against the real package: `1.0.2-staging.99` landed in
   `package.json`, `src/server.ts`, and the built `dist/server.js`.

   The next staging publish is the first that will report itself correctly; worth
   a glance then, since this gap was found by checking a tarball rather than by a
   test.

