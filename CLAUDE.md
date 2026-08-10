# MVP brief

Build one thing: a multi-tenant web app where a user connects their Microsoft account, plus a Claude MCP server — published to npm — that can then read that user's OneDrive notes. Nothing else. If you find yourself building something that isn't in this document, stop.

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

- [ ] Node 20 or newer installed (`node -v`)
- [ ] pnpm enabled (`corepack enable`, then `corepack prepare pnpm@latest --activate`)
- [ ] Supabase CLI installed and logged in (`npm install -g supabase`, `supabase login`)
- [ ] npm account created and logged in (`npm login`)
- [ ] npm organisation created for the scope — package will be `@yourscope/artist-mcp`
- [ ] Claude Desktop installed and signed in

No Docker needed — we're using a hosted Supabase project, not a local one.

## 2. Supabase project

- [ ] Project created at supabase.com, nearby region, **database password saved** (shown once)
- [ ] Written down: Project URL, anon key, service_role key (Project Settings → API)
- [ ] Written down: project ref (from the URL)
- [ ] Email provider enabled (Authentication → Providers) — this is magic-link sign-in
- [ ] Site URL set to `http://localhost:3000` and `http://localhost:3000/**` added to redirect URLs

The built-in email sender is rate-limited but fine for testing. Don't set up SMTP yet.

## 3. Microsoft app registration

portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**.

- [ ] Scope question below answered — do this before registering anything
- [ ] Registration created with the right **supported account types**
- [ ] Redirect URI added: platform **Web**, `http://localhost:3000/api/auth/microsoft/callback`
- [ ] Application (client) ID written down (Overview)
- [ ] Client secret created, 24 months, **Value copied immediately** — not the Secret ID, it's never shown again
- [ ] Delegated permissions added: `Files.Read`, `offline_access`, `User.Read`

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

- [ ] `apps/web/.env.local` created with all seven values below
- [ ] `TOKEN_ENCRYPTION_KEY` generated (`openssl rand -base64 32`)
- [ ] Verified no secret carries a `NEXT_PUBLIC_` prefix
- [ ] `supabase link --project-ref <your-ref>` run
- [ ] Edge function secrets set (`supabase secrets set MS_CLIENT_ID=... MS_CLIENT_SECRET=... TOKEN_ENCRYPTION_KEY=...`)
- [ ] `.env.example` committed with keys and no values

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

- [ ] `npx @yourscope/artist-mcp init` run, key pasted, config written
- [ ] Claude Desktop restarted (it doesn't reload config on its own)

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

- [ ] Turborepo monorepo scaffolded with pnpm workspaces
- [ ] `apps/web` created with Next.js App Router, Tailwind, shadcn/ui initialised
- [ ] `apps/mcp` created
- [ ] `supabase/` directory with migrations and functions

## Database

- [ ] `connections` table — `id, user_id, provider, refresh_token, created_at, updated_at`
- [ ] `mcp_keys` table — `id, user_id, key_hash, created_at, last_used_at`
- [ ] RLS enabled on both, policy `auth.uid() = user_id`
- [ ] `refresh_token` encrypted with pgcrypto using `TOKEN_ENCRYPTION_KEY`
- [ ] Verified: signed in as user A, cannot read user B's rows

RLS keeps other users out; encryption is for a database dump. Store a key hash, never the key.

## The web app

- [ ] Supabase Auth magic-link sign-in working
- [ ] One page: **Connect Microsoft** button, status line, connection key display
- [ ] `GET /api/auth/microsoft` — redirect with client id, redirect URI, scopes, `state`, PKCE
- [ ] `GET /api/auth/microsoft/callback` — verifies `state`, exchanges code server-side, writes encrypted refresh token
- [ ] Connection key generated, shown once, revocable
- [ ] Verified: browser never receives a Microsoft token

Scopes: `Files.Read`, `offline_access`, `User.Read`. **`offline_access` is not optional** — without it Microsoft returns no refresh token and everything dies after an hour.

## The edge function

- [ ] `POST /functions/v1/graph` deployed
- [ ] Resolves connection key → user, reads that user's refresh token
- [ ] Exchanges refresh token with Microsoft for an access token
- [ ] Operations whitelisted: `list_notes`, `read_note`, `verify` — nothing else
- [ ] Graph URL built server-side; no URL or path accepted from the caller
- [ ] Rotated refresh token written back on **every** call
- [ ] Rate limiting per key
- [ ] `last_used_at` updated

Microsoft rotates refresh tokens — every exchange returns a new one and kills the old. Miss the write-back and the connection dies silently after the first request.

**Treat `/v1/` as a public contract.** Once the package is on npm, installed copies keep calling it on their own upgrade schedule. Don't change the request shape — add `/v2/`.

## The package

One package, one `bin` entry, three modes.

- [ ] No arguments → runs the MCP server over stdio
- [ ] `init` → the installer
- [ ] `uninstall` → removes the entry from the Claude config
- [ ] Tool: `list_notes` — files in the OneDrive notes folder, with name, path, modified date
- [ ] Tool: `read_note` — takes a path, returns text content
- [ ] Verified: no Graph calls made locally, no Microsoft token or service role key ever on the client

`init` steps:

- [ ] Prompts for the connection key
- [ ] Calls `verify`; on a bad key, says so and exits without writing config
- [ ] Finds the Claude Desktop config for the current OS, creates it if missing
- [ ] Adds the `artist-notes` entry, leaving other MCP servers untouched
- [ ] Tells the user to restart Claude Desktop

## Publishing

- [ ] `"publishConfig": { "access": "public" }` set — scoped packages default to private and first publish will fail
- [ ] `"engines": { "node": ">=20" }`
- [ ] Shebang on the entry point, built file executable
- [ ] `files` field or `.npmignore` so only `dist` ships
- [ ] Build runs on `prepublishOnly`
- [ ] Edge function URL baked in as a default, overridable by env for testing
- [ ] Published at `0.1.0`
- [ ] Verified: `npx @yourscope/artist-mcp init` works from a directory outside the repo
- [ ] No workspace-internal imports anywhere in `apps/mcp`

## Acceptance test

Run this end to end. Every box ticked, or it isn't done.

- [ ] 1. Sign in to the web app
- [ ] 2. Click **Connect Microsoft**, approve consent, land back showing connected
- [ ] 3. Copy the connection key, run `npx @yourscope/artist-mcp init`, paste it, restart Claude
- [ ] 4. Ask Claude Desktop to list the OneDrive notes — it does
- [ ] 5. Ask it to read one — it does
- [ ] 6. A second user, on a different machine, installs from npm with their own key and sees only their own notes

Step 6 is not optional. It's both the multi-tenancy test and the proof that distribution works from a clean machine.

## Not in scope

No agents. No project types. No calendar. No Google. No scheduled jobs. No teams or organisations. No billing. No web app deployment. No CI. No tests beyond the acceptance test above. No custom design. No error handling beyond showing "reconnect needed" when a refresh fails.

## Confirm before registering the Microsoft app

Are the notes **OneNote notebooks** or **files in a OneDrive folder**? This brief assumes files. If it's OneNote the scope becomes `Notes.Read` and it's a different API — ask before registering, because changing scopes later means dragging users back through consent.

Also: personal Microsoft accounts or work accounts? That decides supported account types in step 3.

- [ ] Both questions answered before anything in section 3 is ticked
