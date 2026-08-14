# Development guide

This guide is the maintainer path from a fresh clone to a verified staging or
production change. Read [mvp-brief.md](mvp-brief.md) for product scope and
[operations.md](operations.md) for infrastructure ownership and external
state.

## Repository layout

```text
apps/web        Next.js App Router web app
apps/mcp        npm package, installer, and stdio MCP server
supabase        database migrations, and dormant schema from the hosted design
docs            product, user, developer, and operations documentation
```

The MCP package owns everything to do with a user's accounts: it runs the
loopback PKCE sign-in, stores the refresh tokens on that machine, rotates them,
and calls Microsoft Graph, Gmail and Google Calendar directly. The web app owns
email sign-in, the install instructions, and `/api/client-config`, which serves
Google's client secret openly because Google refuses a Desktop-client exchange
without one.

Nothing here holds a credential that can read a user's account. That is the
result of [#22](https://github.com/ManudotaORG/artist-mcp/issues/22) and the
reason the hosted design was retired; `connections` and `mcp_keys` survive in
the schema, dormant and unwritten, for the case where hosted custody is ever
needed again.

The system is deliberately stateless with respect to artist content. OneNote
remains the source of truth, and the optional agent workflow state stays locally
in the artist's project.

## Prerequisites

- Node.js 20 or newer (`.nvmrc` records the preferred version).
- pnpm 11 through Corepack.
- Supabase CLI authenticated to the intended project.
- A Supabase project.
- A Microsoft Entra app registration supporting organizational and personal
  Microsoft accounts.

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install
```

## Environment

Create the local web environment:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Set every variable:

| Variable                        | Runtime        | Purpose                             |
| ------------------------------- | -------------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser/server | Supabase project URL                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Public Supabase API key             |
| `NEXT_PUBLIC_SITE_URL`          | Browser/server | Absolute base for magic-link redirects |
| `GOOGLE_DESKTOP_CLIENT_SECRET`  | Server only    | Served by `/api/client-config`      |
| `DEPLOY_ENV`                    | Server only    | Optional; `staging` shows staging metadata |

Only the first two may use the `NEXT_PUBLIC_` prefix. Never commit `.env.local`
or real values.

The provider client secrets that used to live here are gone: the web app no
longer performs OAuth, and no deployment holds a credential that can read a
user's account. `GOOGLE_DESKTOP_CLIENT_SECRET` is the exception and is not
really a secret — it is served to anyone who asks, because every install needs
it and PKCE is what makes it harmless. Without it, `/api/client-config` returns
503 and `artist-mcp connect google` cannot complete.

The MCP package reads three optional overrides during development:
`ARTIST_MCP_TOKENS` to point the token store somewhere other than
`~/.artist-mcp/tokens.json`, `ARTIST_MCP_SITE` to fetch client configuration
from a site other than the one its version implies, and
`ARTIST_MCP_AGENTS_DIR` to read playbooks from a directory instead of the
bundled pack.

## Run the app

From the repository root:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The root command starts all
workspace development tasks through Turborepo.

Local pages intentionally show no deployment metadata. Their installation
commands use the checked-out source instead of npm:

```bash
pnpm --filter @manudota/artist-mcp build
node apps/mcp/dist/index.js init --local
node apps/mcp/dist/index.js agents install
```

The build is not optional: `apps/mcp/dist/` is generated and untracked, so a
fresh checkout has no `dist/index.js` to run at all. The tarball still carries
one — `files` in `package.json` is an allowlist that overrides `.gitignore`, and
`prepublishOnly` rebuilds before every publish.

`init --local` writes an absolute Node entry point into Claude Desktop, so a
restart continues to run this checkout rather than silently switching to npm
`latest`. To exercise the staging presentation locally, build with:

```bash
DEPLOY_ENV=staging VERCEL_GIT_COMMIT_SHA=localtest \
  pnpm --dir apps/web exec next build --webpack
```

On the deployed staging site, all installation examples use the npm staging
channel:

```bash
npx @manudota/artist-mcp@staging init
npx @manudota/artist-mcp@staging agents install
```

Production documentation uses `@manudota/artist-mcp` without a tag, which
resolves to npm `latest`.

## Validate changes

```bash
pnpm lint
node --test scripts/*.test.mjs
pnpm --filter @manudota/artist-mcp test
pnpm build
git diff --check
```

If local Turbopack fails because the sandbox cannot bind an internal port, use
the supported webpack build for verification:

```bash
pnpm --dir apps/web exec next build --webpack
```

The MVP intentionally relies on the acceptance test instead of a separate test
suite. For auth or database changes, repeat the relevant live
flow and record verified results in [mvp-brief.md](mvp-brief.md).

## Database

The migrations create `connections` and `mcp_keys`, enable RLS, and restrict
privileged functions to `service_role`. Do not grant their execution to
`PUBLIC`, `anon`, or `authenticated` — Postgres grants EXECUTE to `PUBLIC` on
new functions, so revoking from `anon` and `authenticated` alone is a no-op.

Both tables are dormant. Nothing writes to them, they hold no rows, and the
credentials that could read them are no longer deployed anywhere. They are kept
against the possibility of needing hosted custody again; see the dormant-storage
section of [operations.md](operations.md) before reviving either.

The Graph edge function is gone. Its source remains under `supabase/functions`
for reference, and it is not deployed — an installed copy calls the providers
directly and there is nothing for it to resolve.

See [operations.md](operations.md) before deploying migrations or a new npm
package.

## Branch and deployment workflow

- Develop and commit on `release` using Conventional Commits.
- Push early to `origin/release`; CI runs lint, tests, and builds there.
- Pull-request CI runs only when the target is `staging` or `main`.

**Verify on `release`. Do not promote in order to test.** Promotion is for
shipping, and using it as a test loop is expensive in both Actions minutes and
attention: each round trip is two pull requests, four workflow runs, and a
published npm prerelease that can never be reused. Since 1.0.x shipped there is
also a real cost to churning the staging dist-tag.

Cheapest sufficient check first:

1. `pnpm test` — lint, both test suites, and every build. This is exactly what CI
   runs, so a pass here means a pass there.
2. The CLI directly, against the built output:
   `node apps/mcp/dist/index.js agents status ~/artist-mcp`. Most behaviour is
   observable here without a client at all.
3. Claude Desktop on the local build, when the behaviour needs a model to
   exercise it: `pnpm --filter @manudota/artist-mcp build` then
   `node apps/mcp/dist/index.js init --local` (add `--editable` to keep an
   editable pack registered). This runs the same code an npm install would.

Restart rules for that third loop, which are not symmetrical: a **code** change
needs Claude Desktop fully quit and reopened, because the server process loaded
its modules at spawn. A **playbook** edit needs nothing — the directory is re-read
on every tool call — but a conversation already holding a `list_agent_workflows`
result will not notice a playbook you add mid-conversation, so start a new one.

### Staying on the local build

Since 1.0.x shipped, the normal state is to sit on `release` for a while — days,
not minutes — with Claude Desktop pointed at this checkout. Register it once:

```bash
pnpm --filter @manudota/artist-mcp build
node apps/mcp/dist/index.js init --local --editable
```

To go back to what users have, and to return:

```bash
npx @manudota/artist-mcp init --editable      # published, npm latest
node apps/mcp/dist/index.js init --local --editable   # back to this checkout
```

To see which of the two is registered right now, read the entry rather than
guessing — a local one names an absolute path into this repository:

```bash
node -e "const {configPath,readConfig}=await import('./apps/mcp/dist/config.js');
console.log((await readConfig(configPath())).mcpServers['artist-notes'].args.join(' '))"
```

**`init` records absolute paths, so moving anything breaks the entry.** Renaming
the playbook directory or moving the checkout leaves Claude Desktop launching a
path that no longer exists, and nothing complains until a workflow tool is called
and fails with a directory the user has never heard of. Re-run `init` after moving
either. This is not hypothetical: renaming `~/artist-playbooks` to `~/artist-mcp`
left every workflow tool in a working Desktop failing for exactly that reason.

**Sync the release bump immediately after a release, not before the next
promotion.** Release Please bumps the version on `main` only, so until `main` is
merged back, every local build on `release` reports the previous version — while
testing, on the branch, which is precisely when the version has to be trustworthy.

Promote only when the thing you need to check cannot be checked locally:

- **The published artifact** — that `dist/` and `agent-pack/` arrive in the
  tarball, that `npx` resolves and runs. Worth doing after packaging changes
  (`files`, build order, dependencies, the publish workflow) and before a stable
  release. Verify it with `npm pack @manudota/artist-mcp@staging` and by running
  the published binary, not by reading the workflow log.
- **The staging website**, for `apps/web` changes.

Otherwise batch several verified changes into one promotion.
- Promote a verified snapshot with a `release` → `staging` pull request.
- After staging verification, promote the same snapshot with a `release` →
  `main` pull request.
- Never promote by pushing a branch directly. `staging` and `main` both require
  the `Lint and build` check with `enforce_admins`, so a direct push is rejected
  — and the commit-message check runs only on `pull_request`, so a push that did
  land would skip Commitlint entirely.
- Both protected branches are `strict`, meaning the pull request must be up to
  date before it can merge, and `release` always trails after a promotion. Two
  separate causes, so expect this every time rather than only at releases:
  merging a promotion pull request creates a merge commit on the target that
  `release` does not have, and Release Please additionally bumps `package.json`
  and `src/server.ts` on `main` only. Either way the next promotion is refused as
  `BEHIND`. Merge `origin/main` into `release` first — a `chore: sync ...` commit
  — then push and retry.

Vercel is connected directly to GitHub. `artist-mcp-staging` tracks only
`staging`; `artist-mcp` tracks only `main`. Preview branch tracking is disabled
for both projects, and GitHub Actions does not deploy the website.

Dependabot opens grouped weekly npm and GitHub Actions updates against
`staging`, where PR CI runs without creating a Vercel preview deployment. After
reviewing and merging a dependency update, synchronize that commit into
`release` before the next production promotion so branch history stays aligned.
Automatic npm and GitHub Actions major-version PRs are disabled; handle
breaking upgrades as planned migration work.

The npm package uses a separate branch-aware release workflow:

- `staging` publishes a unique prerelease to the npm `staging` dist-tag.
- `main` lets Release Please create or update a version PR.
- Merging that PR creates the release, publishes npm `latest` using GitHub OIDC,
  and sends deduplicated patch notes to Telegram.

Do not run `npm publish` from a laptop. npm has one trusted-publisher mapping:
`ManudotaORG/artist-mcp`, workflow `release.yml`, blank npm environment field.
The workflow itself binds stable and staging jobs to separate GitHub
environments.

## Workflow Markdown

`apps/mcp/agent-pack` contains the root policy, seven narrow roles, four starter
project types, and the local-state policy. One OneNote page is one working unit.
The roles may read and return a result in chat; they may not write notes, send
messages, edit calendars, or create background coordination infrastructure.

When workflow Markdown changes, rebuild the registry and run package tests:

```bash
pnpm --filter @manudota/artist-mcp test
```

The build regenerates `agent-pack/registry.json` with SHA-256 checksums. The
runtime uses the registry and playbooks bundled into the installed npm version.
`ARTIST_MCP_REGISTRY_URL` is an explicit development/testing override; it must
point to a registry whose Markdown files are resolvable relative to that URL.

Ids, kinds, and descriptions are derived in `src/agent-registry.ts`, which is
why `tsc` runs *before* `apps/mcp/scripts/build-agent-registry.mjs` — the script imports
the compiled module rather than reimplementing the rule. Keep it that way: the
runtime reads directories through the same derivation, and a second copy would
drift into giving the same file two different ids. A test asserts the committed
registry still matches what the derivation produces.

`artist-mcp agents status` prints the entries in force and where they came from.

## Coding conventions

Read the closest `AGENTS.md` before editing. This project requires arrow
functions, named component prop types, direct React imports, canonical Tailwind
utilities, and lazy construction of SDK clients that need environment values.
Next.js behavior must be checked against the versioned documentation in
`apps/web/node_modules/next/dist/docs/`.
