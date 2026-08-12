# Development guide

This guide is the maintainer path from a fresh clone to a verified staging or
production change. Read [mvp-brief.md](mvp-brief.md) for product scope and
[manu-handoff.md](manu-handoff.md) for infrastructure ownership and current
external state.

## Repository layout

```text
apps/web        Next.js App Router web app
apps/mcp        npm package, installer, and stdio MCP server
supabase        database migrations and Edge Functions
docs            product, user, developer, and operations documentation
```

The web app owns user sign-in, Microsoft OAuth, and connection-key management.
The MCP package calls a single hosted Edge Function. The Edge Function resolves
the key, rotates the Microsoft refresh token, and calls whitelisted OneNote
endpoints.

The system is deliberately stateless with respect to artist content. OneNote
remains the source of truth; Supabase stores only authentication material and
connection-key records. The optional agent workflow state stays locally in the
artist's project.

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

| Variable                        | Runtime        | Purpose                        |
| ------------------------------- | -------------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser/server | Supabase project URL           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Public Supabase API key        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only    | Privileged RPC calls           |
| `MS_CLIENT_ID`                  | Server only    | Microsoft app identifier       |
| `MS_CLIENT_SECRET`              | Server only    | Microsoft OAuth code exchange  |
| `MS_REDIRECT_URI`               | Server only    | OAuth callback URL             |
| `TOKEN_ENCRYPTION_KEY`          | Server only    | Encrypt/decrypt refresh tokens |

Only the first two variables may use the `NEXT_PUBLIC_` prefix. Never commit
`.env.local` or real values.

For local development, the Microsoft app registration must include this Web
redirect URI exactly:

```text
http://localhost:3000/api/auth/microsoft/callback
```

The deployed Edge Function separately needs `MS_CLIENT_ID`,
`MS_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY` as hosted secrets.

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
suite. For auth, database, or Edge Function changes, repeat the relevant live
flow and record verified results in [mvp-brief.md](mvp-brief.md).

## Database and Edge Function

The migrations create `connections` and `mcp_keys`, enable RLS, and restrict
privileged functions to `service_role`. Do not grant their execution to
`PUBLIC`, `anon`, or `authenticated`.

The Graph function is configured with `verify_jwt = false` because callers
authenticate with the connection key rather than a Supabase JWT. Its `/v1/`
request shape is a public contract; add a version instead of breaking existing
npm clients.

See [operations.md](operations.md) before deploying migrations, functions, or a
new npm package.

## Branch and deployment workflow

- Develop and commit on `release` using Conventional Commits.
- Push early to `origin/release`; CI runs lint, tests, and builds there.
- Pull-request CI runs only when the target is `staging` or `main`.
- Promote a verified snapshot with a `release` → `staging` pull request.
- After staging verification, promote the same snapshot with a `release` →
  `main` pull request.

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

## Coding conventions

Read the closest `AGENTS.md` before editing. This project requires arrow
functions, named component prop types, direct React imports, canonical Tailwind
utilities, and lazy construction of SDK clients that need environment values.
Next.js behavior must be checked against the versioned documentation in
`apps/web/node_modules/next/dist/docs/`.
