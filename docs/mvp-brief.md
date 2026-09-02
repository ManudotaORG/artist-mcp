# MVP brief

Build one thing: a multi-tenant web app where a user connects their Microsoft account, plus an MCP server — published to npm — that can read that user's OneNote notes and apply read-only musician workflow playbooks. One OneNote page is one working unit, and every result stays in Claude or Codex chat.

(This line originally said OneDrive. The confirmation question at the bottom was answered "OneNote notebooks" — see the note there.)

## How to use this document

This is a working checklist, not a reference. **Edit this file as you go and tick each box when it's done.**

- Part 1 boxes are for the **human**: accounts, keys, tooling. Nothing in Part 2 can be tested until these are ticked.
- Part 2 boxes are for whoever writes the code, **human or agent**.
- Tick when it's done *and verified*, not when it's started. A ticked box means someone can rely on it.
- Don't tick ahead. If something is blocked, leave the box empty and write `BLOCKED —` and the reason next to it.
- **Agent:** after each unit of work, edit this file to tick what you completed, then carry on. Don't wait until the end. If you finish a section, say which boxes you ticked.

---

# Part 1 — Set this up first (human)

Nothing will run until this is done. Keep a scratch file open and paste every value into it as you go.

## 1. Local tooling

- [x] Node 20 or newer installed (`node -v`) — v24.19.0
- [x] pnpm enabled (`corepack enable`, then `corepack prepare pnpm@latest --activate`) — 11.21.0
- [x] Supabase CLI installed and logged in — 2.113.0, authenticated. (Note: `npm i -g supabase` is no longer supported; use `brew install supabase/tap/supabase`)
- [x] npm account created and logged in (`npm login`) — `manudota`
- [x] npm organisation created for the scope — not needed: `@manudota` is the personal scope, which publishes fine with `publishConfig.access: public`. Package is `@manudota/artist-mcp`
- [x] Claude Desktop installed and signed in

No Docker needed — we're using a hosted Supabase project, not a local one.

## 2. Supabase project

- [x] Project created at supabase.com, nearby region, **database password saved** (shown once) — `artist-mcp`, eu-west-2
- [x] Written down: Project URL, anon key, service_role key (Project Settings → API) — pulled via CLI into `apps/web/.env.local`
- [x] Written down: project ref (from the URL) — `zxiemadwrkcoovvpscfb`
- [x] Email provider enabled (Authentication → Providers) — this is magic-link sign-in — proven: a sign-in email was delivered
- [x] Site URL set to `http://localhost:3000` and `http://localhost:3000/**` added to redirect URLs — proven: the emailed link reached `/auth/confirm`

The built-in email sender is rate-limited but fine for testing. Don't set up SMTP yet.

## 3. Microsoft app registration

portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**.

- [x] Scope question below answered — do this before registering anything
- [x] Registration created with **supported account types** = any org directory + personal Microsoft accounts
- [x] Redirect URI added: platform **Web**, `http://localhost:3000/api/auth/microsoft/callback` — Web is required; a client secret cannot be used with the SPA platform type
- [x] Application (client) ID written down (Overview)
- [x] Client secret created, **Value copied immediately** — validated against Microsoft before use
- [x] Delegated permissions added: `Notes.Read`, `offline_access`, `User.Read` — consent granted; a refresh token came back, so `offline_access` took

## 4. Environment

### Why there's an env file at all

The app needs values that can't live in the code: the Microsoft client secret, the Supabase service role key, the encryption key. If those sit in a source file they end up in git, and git history is permanent — rotating a secret that's been pushed means revoking it at the provider, not deleting a commit.

`.env.local` is gitignored by Next.js out of the box. That's its whole job: values that stay on the machine they're on.

It's also how the same code runs in different places. Your machine points at `localhost:3000`; production will point at a real domain. Nothing in the code changes, only the env.

And in Next.js the prefix is load-bearing. Anything named `NEXT_PUBLIC_*` gets baked into the JavaScript sent to the browser, where anyone can read it. Everything else is server-only. That split is why the client secret and the service role key must not have the prefix — it's a security boundary, not a naming convention.

### Why three separate places

Three runtimes, three environments, none of which can see each other's variables:

- **Next.js** runs on your machine. Reads `.env.local`.
- **Edge functions** run on Supabase's servers. No access to your laptop, so their secrets are set with the CLI.
- **The MCP server** runs on the *end user's* machine. One variable, written by the installer.

Same secret in two runtimes means setting it in both. There's no shared file.

### Tasks

- [x] `apps/web/.env.local` created with all seven values below — all seven set; client id + secret validated against Microsoft
- [x] `TOKEN_ENCRYPTION_KEY` generated (`openssl rand -base64 32`)
- [x] Verified no secret carries a `NEXT_PUBLIC_` prefix
- [x] `supabase link --project-ref <your-ref>` run
- [x] Edge function secrets set — all three set

Watch for AADSTS53003: a Conditional Access policy blocks app-only
(`client_credentials`) token issuance for this app. The delegated flow this app
actually uses is a different path and may be unaffected — but if consent fails
with 53003, sign in with a personal Microsoft account rather than a work one.
- [x] `.env.example` committed with keys and no values

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_REDIRECT_URI=http://localhost:3000/api/auth/microsoft/callback
TOKEN_ENCRYPTION_KEY=
```

## 5. Connecting Claude Desktop

Do this last — the connection key doesn't exist until the web app is running and Microsoft is connected.

(Recorded as it happened. There is no connection key now: `init` asks for nothing, and `connect` signs in on this machine. The steps below are history, not instructions — follow [installation.md](installation.md).)

- [x] `npx @manudota/artist-mcp init` run, key pasted, config written
- [x] Claude Desktop restarted (it doesn't reload config on its own) — restarted after the `npx` entry was written; `list_notes` works from the published package

Config file locations, if you need to look:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

---

# Part 2 — What to build

## Stack

```
apps/web        Next.js (App Router), Tailwind, shadcn/ui
apps/mcp        Node MCP server + install CLI, published to npm
supabase/       migrations and edge functions
```

- [x] Turborepo monorepo scaffolded with pnpm workspaces
- [x] `apps/web` created with Next.js App Router, Tailwind, shadcn/ui initialised
- [x] `apps/mcp` created
- [x] `supabase/` directory with migrations and functions

## Database

- [x] `connections` table — `id, user_id, provider, refresh_token, created_at, updated_at`
- [x] `mcp_keys` table — `id, user_id, key_hash, created_at, last_used_at`
- [x] RLS enabled on both, policy `auth.uid() = user_id`
- [x] `refresh_token` encrypted with pgcrypto using `TOKEN_ENCRYPTION_KEY`
- [x] Verified: signed in as user A, cannot read user B's rows — migration applied; anon key reads both tables as empty and both privileged functions return `42501 permission denied`, after the `PUBLIC` grant was revoked. The two-real-users half was going to come from acceptance step 6; it is moot instead, because both tables are dormant and unwritten. There are no rows to isolate, and no deployed credential that could read them.

Note: the first migration's `revoke ... from anon, authenticated` was a no-op —
Postgres grants EXECUTE to PUBLIC on every new function and both roles inherit
it, so the `security definer` functions were callable with the anon key.
Migration `20260810010000` revokes from PUBLIC and grants to `service_role`
only. Caught by testing the endpoint, not by reading the SQL.

RLS keeps other users out; encryption is for a database dump. Store a key hash, never the key.

## The web app

- [x] Supabase Auth magic-link sign-in working — signed in as manolotelleria@gmail.com. Handles both link shapes: `?code=` (Supabase's default email template, PKCE) and `?token_hash=` (custom template). The default template sends `code`, which an earlier version rejected.
- [x] One page: **Connect Microsoft** button, status line, connection key display — both signed-out and signed-in states render correctly
- [x] `GET /api/auth/microsoft` — redirect with client id, redirect URI, scopes, `state`, PKCE — redirects home when signed out; `state` and verifier set as httpOnly cookies
- [x] `GET /api/auth/microsoft/callback` — verifies `state`, exchanges code server-side, writes encrypted refresh token — forged `state` and denied consent both rejected with an error, no exchange attempted
- [x] Connection key generated, shown once, revocable — generated (`amcp_` + 43 chars), shown once, revoked. Verified the DB stores only sha256: the browser-computed hash of the displayed key matched `key_hash`, and no column holds the plaintext.

Rate limits: the built-in email sender allows very few messages per hour. For
testing, mint a link with the admin API instead — no email, no limit:
`POST /auth/v1/admin/generate_link {"type":"magiclink","email":...}` with the
service role key, then visit `/auth/confirm?token_hash=<hashed_token>&type=magiclink`.
That path also skips PKCE, so it works in any browser.
- [x] Verified: browser never receives a Microsoft token — the code exchange is server-side in the callback route; the stored value is pgcrypto ciphertext (`\xc30d0407…`) and decrypts to a 437-char `M.C5…` token only via the service role

Built against Next.js 16.3.0, which differs from older conventions in two ways
that mattered: `cookies()` and `searchParams` are async, and the `middleware`
file convention is renamed to `proxy` (`src/proxy.ts`, exporting `proxy`).
This shadcn `Button` also has no `asChild` slot — use `buttonVariants()` on an
anchor instead.

Scopes: `Notes.Read`, `offline_access`, `User.Read`. **`offline_access` is not optional** — without it Microsoft returns no refresh token and everything dies after an hour.

## The edge function

- [x] `POST /functions/v1/graph` deployed — live; bad key → 401, unknown op → 400, missing key → 401 all verified by curl
- [x] Resolves connection key → user, reads that user's refresh token
- [x] Exchanges refresh token with Microsoft for an access token
- [x] Operations whitelisted: `list_notes`, `read_note`, `verify` — nothing else
- [x] Graph URL built server-side; no URL or path accepted from the caller
- [x] Rotated refresh token written back on **every** call
- [x] Rate limiting per key — 30/min, in-isolate (see note in the function)
- [x] `last_used_at` updated

Exercised end to end against a real Microsoft account: `verify` returns ok,
`list_notes` returns real OneNote pages with sections and modified dates, and
`read_note` returns readable text. Token rotation confirmed — the stored
ciphertext changed after a call, so the write-back works.

Gotcha worth keeping: edge functions verify a Supabase JWT by default, and the
caller presents a connection key instead. `supabase/config.toml` sets
`verify_jwt = false` for this function, or every request 401s before our code
runs. Auth is the sha256 lookup against `mcp_keys` inside the function.

Microsoft rotates refresh tokens — every exchange returns a new one and kills the old. Miss the write-back and the connection dies silently after the first request.

**Treat `/v1/` as a public contract.** Once the package is on npm, installed copies keep calling it on their own upgrade schedule. Don't change the request shape — add `/v2/`.

## The package

One package, one `bin` entry, three modes.

- [x] No arguments → runs the MCP server over stdio
- [x] `init` → the installer
- [x] `uninstall` → removes the entry from the Claude config
- [x] Tool: `list_notes` — OneNote pages, with title, section, modified date; narrows by notebook, by `since`, and by `limit` — verified over a real MCP client, which passed `{notebook, since}` to the tool rather than fetching everything and filtering, and got back the 2 pages of 11 modified in the window
- [x] Tool: `map_notes` — the opening of every page in one notebook, from Graph's page previews, so a notebook can be triaged before anything is read. Measured against two real notebooks: 4 KB against 349 KB and about half the wall-clock, but still one call per page, so the saving is context rather than calls. A page with no usable preview is read in full instead and the answer says which — the preview is capped near 300 characters and is always a plain prefix, verified across 17 pages
- [x] Tool: `read_note` — takes a note id (not a path; OneNote pages are addressed by id), returns text content, in parts when the page exceeds the attachment text cap. Parts rather than page ranges, because a OneNote page records no pages; a normal page is unaffected byte for byte
- [x] `status` reports the install, not only the connections: which config, whether the entry exists, published package or local build, and whether the recorded playbook directory still resolves — the failure it exists for is a moved checkout, which used to surface as every workflow tool failing inside Claude
- [x] Tools: `list_agent_workflows`, `load_agent_workflow` — discover and load checksummed Markdown roles and project types, with a bundled offline fallback
- [x] Verified: no Graph calls made locally, no Microsoft token or service role key ever on the client — driven with a real MCP client over stdio: both tools listed, `list_notes` returned 6 pages, `read_note` 2,358 chars, malformed id rejected

OneNote's Graph endpoints return transient 503/504 often — roughly one call in
three failed. `graphGet` now retries 5xx and 429 twice with backoff; 6/6 clean
after. Slightly beyond the brief's "no error handling" line, and deliberate:
without it `read_note` fails intermittently for no reason.

`init` steps:

- [x] Prompts for the connection key
- [x] Calls `verify`; on a bad key, says so and exits without writing config — verified against the live endpoint; config left untouched
- [x] Finds the Claude Desktop config for the current OS, creates it if missing
- [x] Adds the `artist-notes` entry, leaving other MCP servers untouched — `google` and `onenote` survived init and uninstall; config byte-identical to the pre-test backup afterwards
- [x] Tells the user to restart Claude Desktop

## Publishing

- [x] `"publishConfig": { "access": "public" }` set — scoped packages default to private and first publish will fail
- [x] `"engines": { "node": ">=20" }`
- [x] Shebang on the entry point, built file executable
- [x] `files` field or `.npmignore` so only `dist` ships
- [x] Build runs on `prepublishOnly`
- [x] Edge function URL baked in as a default, overridable by env for testing — real project URL baked in; `ARTIST_MCP_ENDPOINT` overrides
- [x] Published at `0.1.0` — publish confirmed by npm's email and by `npm access` (package exists, owner `manudota`, status `public`). Required 2FA; a security key means no `--otp` code, so it goes through `npm publish` and its browser handshake, not `pnpm publish`.
- [x] Verified: `npx @manudota/artist-mcp init` works from a directory outside the repo — run from an empty temp dir with no checkout: bad key refused without writing, valid key wrote the `npx` entry, and the installed package served `list_notes` and `read_note` over a real MCP client

Registry propagation lagged well behind the publish: `npm access` reported the
package public while the packument and tarball still 404'd for ~15 minutes.
`npm access` is the reliable signal right after publishing, not `npm view`.
- [x] No workspace-internal imports anywhere in `apps/mcp`

## Acceptance test

Run this end to end. Every box ticked, or it isn't done.

- [x] 1. Sign in to the web app
- [x] 2. Click **Connect Microsoft**, approve consent, land back showing connected
- [x] 3. Copy the connection key, run `npx @manudota/artist-mcp init`, paste it, restart Claude
- [x] 4. Ask Claude Desktop to list the OneNote notes — it does
- [x] 5. Ask it to read one — it does (full page: milestones, tasks, musician table)
- [x] 6. A second user, on a different machine, installs from npm and sees only
  their own notes — run with two real Microsoft accounts on two machines, and
  confirmed done by the maintainer

The runbook that used to sit beside this has been deleted, and step 6 no longer
means what it originally did. It was written for the hosted design: a connection
key pasted at install, resolved server-side to that user's refresh token. The
multi-tenancy question was whether one key could reach another user's notes.

There is no such path now. Each machine holds its own tokens and calls the
providers directly, so there is no shared credential and no server-side
resolution to isolate — see [#22](https://github.com/ManudotaORG/artist-mcp/issues/22).
Two users are two independent installs. What the test proved is recorded in the
known gaps below; what remains worth checking is that the published package
installs and runs, which is ordinary release verification rather than a security
gate, and which `npm pack` plus running the published binary covers.

## Read-only workflow layer

- [x] Installable Markdown pack with Orchestrator, Archivist, Registrar, Project Manager, Envoy, Auditor, and Janitor roles
- [x] Starter project types: Concert, Large Concert, Studio Session, and Rehearsal
- [x] One OneNote page treated as one working unit
- [x] Registry generated during package build with SHA-256 checksums
- [x] Results shown only in chat; no write, send, sync, calendar, or background execution capability

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
- [x] Policies that must hold unprompted load in full, not as summaries: `answering`, `evidence`, `divergence`, `patch` alongside `intake`. Found the hard way — the rule protecting the user's mailbox lived in `AGENTS.md`, which the server never loads, and a Desktop session read Gmail and Calendar unasked. A rule in a role is not in force; see "Editing the pack" in `docs/releases-and-agents.md`
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
      without the grant, exactly those two more with it
- [x] Preview then create, with the create bound to the previewed payload by a
      token; unsettled values (`UNKNOWN`, `TBC`, a disputed date) refused in
      code rather than only in a playbook; timed events refused without an IANA
      zone; no retry on create; a 409 reported as already there; an audit line
      per write in `~/.artist-mcp/writes.log`
- [x] The pack and the docs corrected in the same work, not deferred — every
      "read-only" claim across `CLAUDE.md`, `README.md`, `PRODUCT.md`, the brief,
      `releases-and-agents.md` and four pack files
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

8. **Node 20 reaches Vercel's build cutoff on 1 October 2026.** Vercel emailed
   on 14 August 2026: Node 20 is end-of-life, and after that date new builds
   using it fail. The mail named one affected project, `nextjs` in
   `highnets-projects` — **not** `artist-mcp` or `artist-mcp-staging` — so on the
   evidence available neither of this project's deployments is on 20. That has
   not been confirmed: the Node version is a Vercel dashboard setting and cannot
   be read from this repository.

   Nothing here overrides it, which is the part worth knowing. Vercel warns that
   an explicit `engines.node` in `package.json` beats the dashboard, and
   `apps/web` sets none — so whatever the dashboard says is what builds, and a
   repo change would not fix a project left on 20.

   Separately, the versions this repo names disagree: `.nvmrc` pins `22.22.2`,
   CI and the release workflow both use `24`, the root and `apps/mcp`
   `engines.node` say `>=20`, and the README tells users "Node 20 or newer".
   The `engines` floor is a real compatibility promise about *users'* machines
   rather than untidiness, so raising it decides who can still install the
   package — but it currently promises support on a runtime with no security
   updates. Aligning `.nvmrc` with the 24 that CI actually uses is the smaller,
   separate half.

   Action before 1 October 2026: read the Node version on both Vercel projects
   and upgrade either one still on 20 from the dashboard.

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

## Confirm before registering the Microsoft app

Are the notes **OneNote notebooks** or **files in a OneDrive folder**? This brief assumes files. If it's OneNote the scope becomes `Notes.Read` and it's a different API — ask before registering, because changing scopes later means dragging users back through consent.

Also: personal Microsoft accounts or work accounts? That decides supported account types in step 3.

- [x] Both questions answered before anything in section 3 is ticked

**Answered 2026-08-10: OneNote notebooks, and both account types.**

So the scope is `Notes.Read`, not `Files.Read`, and the API is `/me/onenote/*`.
Supported account types = "any organizational directory and personal Microsoft
accounts". Sections 3, "The web app" and "The package" have been corrected
below to match — the original text assumed OneDrive files.
