# Development guide

This guide is the maintainer path from a fresh clone to a verified staging or
production change. Read [scope.md](scope.md) for product scope and
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
  package promises users. `.nvmrc` pins `22.22.2` while CI, the release
  workflow and both Vercel projects run 24; nothing breaks on the difference,
  and gap 8 in [scope.md](scope.md) tracks whether to align them.
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
flow and record verified results in [scope.md](scope.md).

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

## Shipping a change

Verify on `release`; promote only to ship. The branch workflow, the local-build
loop, the npm channels, publishing and patch notes are all in
[releases.md](releases.md).

## Workflow Markdown

`apps/mcp/agent-pack` is executable policy, not documentation: changing it means
regenerating `registry.json`, which the build does, and a test asserts the
committed copy matches. What is in the pack, how to change it safely, and what a
day of testing taught about editing it are in [agent-pack.md](agent-pack.md).

## Coding conventions

Read the closest `AGENTS.md` before editing. This project requires arrow
functions, named component prop types, direct React imports, canonical Tailwind
utilities, and lazy construction of SDK clients that need environment values.
Next.js behavior must be checked against the versioned documentation in
`apps/web/node_modules/next/dist/docs/`.
