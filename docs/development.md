# Development guide

This guide is the maintainer path from a fresh clone to a verified staging or
production change. Read [mvp-brief.md](mvp-brief.md) for product scope and
[operations.md](operations.md) for infrastructure ownership and external
state.

## Repository layout

```text
apps/web        Next.js App Router web app
apps/mcp        npm package, installer, and stdio MCP server
supabase        database migrations, including hosted credential storage
docs            product, user, developer, and operations documentation
```

The MCP package owns everything to do with a user's accounts: it runs the
loopback PKCE sign-in, stores the refresh tokens on that machine, rotates them,
and calls Microsoft Graph, Gmail and Google Calendar directly. The web app owns
email sign-in, the install instructions, and `/api/client-config`, which serves
Google's client secret openly because Google refuses a Desktop-client exchange
without one.

Since [#55](https://github.com/ManudotaORG/artist-mcp/issues/55) this app also
serves the hosted MCP, so it *does* hold credentials that can read a hosted
user's account: the service role and the token encryption key. That is true of
hosted accounts only — the published package still keeps its tokens on the
user's own machine, and nothing here can reach those. Do not describe either
model in the other's terms; the difference is disclosed to hosted users and is
the point of both.

The system is deliberately stateless with respect to artist content. OneNote
remains the source of truth, and the optional agent workflow state stays locally
in the artist's project.

## Prerequisites

- Node.js 20 or newer — that is what `engines.node` enforces and what the
  package promises users. `.nvmrc` pins `22.22.2` and CI runs 24; the three
  disagree deliberately for now, and gap 8 in
  [mvp-brief.md](mvp-brief.md) tracks aligning them before Vercel's
  1 October 2026 Node 20 cutoff.
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
| `GOOGLE_REFRESH_TOKEN_DAYS`     | Server only    | Refresh-token lifetime, served alongside it |
| `DEPLOY_ENV`                    | Server only    | Optional; `staging` shows staging metadata |

The hosted MCP needs five more, all server-only, all documented in
`apps/web/.env.example`. Unset, `/api/mcp` refuses to serve rather than serving
something half-working — which is the right state for a checkout that is only
working on the package:

| Variable                          | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`       | Reads a connection for a user holding no browser session; bypasses RLS by design |
| `TOKEN_ENCRYPTION_KEY`            | Encrypts stored tokens at rest; never stored in the database |
| `ARTIST_MCP_WEB_MS_CLIENT_ID`/`_SECRET`     | Web OAuth client for connecting Microsoft from the browser. Deliberately the same registration the package uses — see the note in `.env.example` |
| `ARTIST_MCP_WEB_GOOGLE_CLIENT_ID`/`_SECRET` | Web OAuth client for Google, which is a separate registration from the package's desktop one |

Only the `NEXT_PUBLIC_` pair may carry that prefix. Never commit `.env.local`
or real values.

The provider client secrets that used to live here are gone: the web app no
longer performs OAuth, and no deployment holds a credential that can read a
user's account. `GOOGLE_DESKTOP_CLIENT_SECRET` is the exception and is not
really a secret — it is served to anyone who asks, because every install needs
it and PKCE is what makes it harmless. Without it, `/api/client-config` returns
503 and `artist-mcp connect google` cannot complete.

`GOOGLE_REFRESH_TOKEN_DAYS` is served from the same endpoint and is set to `7`
while the Google OAuth consent screen is in **Testing** publishing status:
Google expires refresh tokens issued by an app in that state after seven days,
and an installed copy cannot read a console setting. The install records the
resulting date with the connection, so `artist-mcp status` can warn before it
lapses and a failed refresh can say whether it expired on schedule or was
withdrawn — the two look identical in Google's own `invalid_grant`.

Clear it when the app is verified. It is served rather than compiled in
precisely so that is one environment change rather than a release every install
has to take. Existing connections keep the date they were given, which stays
correct: a token issued under Testing still dies on day seven. See #94.

The MCP package reads four optional overrides during development:
`ARTIST_MCP_TOKENS` to point the token store somewhere other than
`~/.artist-mcp/tokens.json`, `ARTIST_MCP_SITE` to fetch client configuration
from a site other than the one its version implies, and
`ARTIST_MCP_AGENTS_DIR` to read playbooks from a directory instead of the
bundled pack, and `ARTIST_MCP_CONFIG` to point at a Claude Desktop config other
than the real one — the suite uses it so testing `status` never touches a
developer's own install.

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

The migrations create `connections`, `mcp_keys`, the OAuth server tables, and
the functions that encrypt and decrypt stored tokens. Privileged functions are
restricted to `service_role`.

**Revoke from `public`, `anon` and `authenticated` — all three.** Postgres
grants EXECUTE to `PUBLIC` on new functions, *and* Supabase's default privileges
on this schema grant it explicitly to `anon` and `authenticated`. Those are
different grants that look alike, and revoking either alone leaves the function
callable. An earlier note here said the second revoke was a no-op; that was
wrong and it produced a real hole (`20260824130000` fixes it).
`scripts/hosted-custody.test.mjs` asserts all three for every custody function.

New tables need RLS enabled even with no policies, because PostgREST serves
every table in `public` — one without RLS is a public endpoint.

These tables hold real encrypted credentials for hosted accounts. See the
hosted credential storage section of [operations.md](operations.md).

The Graph edge function is gone: removed along with its source, its tests and
its CI job, so `supabase/` holds only `config.toml` and `migrations/`. An
installed copy calls the providers directly and there is nothing for it to
resolve; hosted users are served by `apps/web/src/app/api/mcp/route.ts`. A
reference to that function anywhere is stale.

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
path that no longer exists. Re-run `init` after moving either. This is not
hypothetical: renaming `~/artist-playbooks` to `~/artist-mcp` left every workflow
tool in a working Desktop failing for exactly that reason, with nothing saying
why — which is what `status` checking the install was built for. It now names the
missing path in the terminal instead.

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

**The Release Please pull request needs its CI approved by hand, every time.**
GitHub does not run workflows for a pull request opened by a bot without a
maintainer approving them, so CI sits at `action_required` and reports no checks
at all. `main` requires `Lint and build` with `enforce_admins`, so the release
pull request is unmergeable until that run is approved — and the failure mode is
a pull request that looks merely slow rather than blocked. Approve the run from
the Actions tab, or with:

```bash
gh run list --branch release-please--branches--main--components--artist-mcp --limit 1
gh api -X POST repos/ManudotaORG/artist-mcp/actions/runs/<id>/approve
```

This is a repository Actions setting rather than anything in the workflow, so it
can be removed rather than lived with.

**A failed publish is retried by re-running the job, never by publishing from a
laptop.** `1.2.0`'s follow-on staging prerelease died at the registry with
`TLOG_CREATE_ENTRY_ERROR` — a Sigstore transparency-log 409 on a duplicate
signing entry — after building a correct tarball. `gh run rerun <id> --failed`
published it as `1.2.1-staging.58.2`: the run attempt is appended to the version,
so a retry mints a new immutable version instead of colliding. Confirm a publish
against the registry (`npm view @manudota/artist-mcp dist-tags`) rather than the
workflow log, since the build can succeed and the publish still fail.

Do not run `npm publish` from a laptop. npm has one trusted-publisher mapping:
`ManudotaORG/artist-mcp`, workflow `release.yml`, blank npm environment field.
The workflow itself binds stable and staging jobs to separate GitHub
environments.

## Workflow Markdown

`apps/mcp/agent-pack` contains the root policy, seven narrow roles, four starter
project types, and six policies. Five of those — intake, answering, evidence,
divergence and patch — are loaded in full at the start of every session because
they have to hold whether or not anyone reached for them; local-state is
summarised like a role. That list is the `ALWAYS` array behind `alwaysInFull` in
`server.ts` rather than anything in the pack, and "Editing the pack" in
[releases-and-agents.md](releases-and-agents.md) explains why a rule in a role is
not in force. One OneNote page is one working unit.
The roles read and return a result in chat, and use whichever write capabilities
the install holds. They never send messages and never create background
coordination infrastructure, and nothing there deletes a OneNote page.

When workflow Markdown changes, rebuild the registry and run package tests:

```bash
pnpm --filter @manudota/artist-mcp test
```

The build regenerates `agent-pack/registry.json` with SHA-256 checksums. The
runtime uses the registry and playbooks bundled into the installed npm version.

Working against `init --editable` means two copies of every playbook. Check they
have not diverged in the direction you did not intend:

```bash
pnpm --filter @manudota/artist-mcp check-pack ~/artist-mcp
```

An edit made in the editable directory runs correctly there and ships to nobody,
because the registry is generated from the bundle while a local pack is
checksummed from the directory as it is read.
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
