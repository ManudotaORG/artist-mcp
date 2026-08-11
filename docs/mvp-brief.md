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
- [ ] Verified: signed in as user A, cannot read user B's rows — migration applied; anon key reads both tables as empty and both privileged functions return `42501 permission denied`. The two-real-users half still needs auth, so it lands with acceptance test step 6.

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
- [x] Tool: `list_notes` — OneNote pages, with title, section, modified date
- [x] Tool: `read_note` — takes a note id (not a path; OneNote pages are addressed by id), returns text content
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
- [ ] 6. A second user, on a different machine, installs from npm with their own key and sees only their own notes

Step 6 is not optional. It's both the multi-tenancy test and the proof that distribution works from a clean machine.

## Read-only workflow layer

- [x] Installable Markdown pack with Orchestrator, Archivist, Registrar, Project Manager, Envoy, Auditor, and Janitor roles
- [x] Starter project types: Concert, Large Concert, Studio Session, and Rehearsal
- [x] One OneNote page treated as one working unit
- [x] Registry generated during package build with SHA-256 checksums
- [x] Results shown only in chat; no write, send, sync, calendar, or background execution capability

## Not in scope

No autonomous agent processes. No OneNote writes. No message sending. No calendar. No Google. No scheduled jobs. No teams or organisations. No billing. No web app deployment. No copying or synchronizing source data. No workflow state in Supabase.

## Known gaps — deferred, not forgotten

Deliberately out of the MVP. Recorded so they aren't rediscovered as surprises.

1. **No way to disconnect Microsoft.** The page offers Reconnect but nothing
   deletes the `connections` row, so a user cannot revoke Microsoft access from
   the app — only at Microsoft's end, or by deleting the row directly. Revoking
   the connection key stops MCP access but leaves the refresh token stored.
   This is the one users will expect to find and won't.

2. **Rate limiter can't limit unauthenticated callers.** It keys on the sha256
   of the presented key, so garbage keys get a fresh bucket every request. Keys
   are 32 random bytes, so this is a cost and availability risk, not a data one.
   A real fix needs shared state. Internal to the function — fixable without
   touching the `/v1/` contract.

3. **Key→user isolation never observed.** Every test used one user. The code
   isolates by resolving the key to a `user_id`, and RLS covers the browser
   path, but no test has confirmed one user's key fails to reach another's
   notes. Cheapest meaningful check: a second Supabase user with their own key.

4. **One key per user.** Generating replaces the old, so two machines cannot
   hold separate keys.

## Confirm before registering the Microsoft app

Are the notes **OneNote notebooks** or **files in a OneDrive folder**? This brief assumes files. If it's OneNote the scope becomes `Notes.Read` and it's a different API — ask before registering, because changing scopes later means dragging users back through consent.

Also: personal Microsoft accounts or work accounts? That decides supported account types in step 3.

- [x] Both questions answered before anything in section 3 is ticked

**Answered 2026-08-10: OneNote notebooks, and both account types.**

So the scope is `Notes.Read`, not `Files.Read`, and the API is `/me/onenote/*`.
Supported account types = "any organizational directory and personal Microsoft
accounts". Sections 3, "The web app" and "The package" have been corrected
below to match — the original text assumed OneDrive files.
