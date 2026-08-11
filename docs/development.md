# Local development

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

| Variable | Runtime | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Public Supabase API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged RPC calls |
| `MS_CLIENT_ID` | Server only | Microsoft app identifier |
| `MS_CLIENT_SECRET` | Server only | Microsoft OAuth code exchange |
| `MS_REDIRECT_URI` | Server only | OAuth callback URL |
| `TOKEN_ENCRYPTION_KEY` | Server only | Encrypt/decrypt refresh tokens |

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

## Validate changes

```bash
pnpm lint
pnpm build
git diff --check
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

## Coding conventions

Read the closest `AGENTS.md` before editing. This project requires arrow
functions, named component prop types, direct React imports, canonical Tailwind
utilities, and lazy construction of SDK clients that need environment values.
Next.js behavior must be checked against the versioned documentation in
`apps/web/node_modules/next/dist/docs/`.
