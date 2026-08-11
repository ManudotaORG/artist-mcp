# Operations guide

This document is for maintainers with access to GitHub, Supabase, Microsoft
Entra, and npm.

## Required service access

- GitHub repository administration for `ManudotaORG/artist-mcp`.
- Supabase owner or administrator access to the `artist-mcp` project.
- Microsoft Entra access to manage the app registration, permissions, redirect
  URIs, and client credentials.
- npm owner access to the `@manudota` scope and
  `@manudota/artist-mcp` package.
- The team secret manager and security-notification email aliases.

Use individual accounts and individual MFA. Do not share account passwords or
personal MFA recovery material.

## Secret inventory

| Secret | Stored in | Rotation impact |
| --- | --- | --- |
| Supabase server key | Web runtime | Update every web environment |
| Microsoft client secret | Web runtime and Edge Function | Update both before deleting the old credential |
| Token encryption key | Web runtime and Edge Function | Existing encrypted refresh tokens depend on it; plan a data migration or reconnect users |
| Connection key | User client and hashed database row | Generate a replacement and reinstall each affected client |

Public or publishable Supabase browser keys identify the application but do not
grant service-role access. They are intentionally exposed to the browser; RLS
remains the data authorization boundary.

## Web deployment

The web app uses two Vercel projects and no automatic preview deployments:

- `artist-mcp` deploys the GitHub `main` branch through the `production` environment.
- `artist-mcp-staging` deploys the GitHub `staging` branch through the `staging` environment.

`apps/web/vercel.json` disables Vercel Git auto-deployments. The
`deploy-web.yml` workflow builds and deploys only these two stable targets. Both
are public; staging has no password or deployment-protection gate.

Each GitHub environment needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and its own
`VERCEL_PROJECT_ID`. Runtime application variables live in the corresponding
Vercel project, not GitHub Actions.

Production uses `https://artist-mcp.vercel.app`; staging uses
`https://artist-mcp-staging.vercel.app`. Add each `/api/auth/microsoft/callback`
URL to the Microsoft Entra app and each `/auth/confirm` origin to the Supabase
Auth redirect allowlist.

## Supabase changes

Discover the installed CLI command shape with `supabase --help` before use.
Review migrations and function diffs, run the security advisors, and verify the
result against the linked hosted project.

Important invariants:

- RLS remains enabled on every exposed table.
- User-facing policies include `auth.uid() = user_id`.
- Privileged `SECURITY DEFINER` functions revoke execution from `PUBLIC` and
  grant only the required service role.
- The Graph function keeps `verify_jwt = false`; connection-key verification is
  performed inside the function.
- Refresh-token rotation is written back on every Microsoft token exchange.
- Callers select only `verify`, `list_notes`, or `read_note`; no arbitrary Graph
  URL is accepted.

## Publish the MCP package

From a clean worktree:

```bash
pnpm build
pnpm lint
pnpm --filter @manudota/artist-mcp pack
```

Inspect the tarball contents before publishing. The package must ship only the
required `dist` files, keep the executable shebang, target Node 20 or newer, and
publish publicly. Bump the package version intentionally, then publish using the
npm account's required MFA flow.

After publishing, test from a clean temporary directory:

```bash
npx @manudota/artist-mcp init
```

Verify both MCP tools with a real client. Registry metadata can lag immediately
after publication; package access status is the authoritative initial signal.

## Acceptance test

The release is not fully accepted until all of these pass:

1. User A signs into the web app and connects Microsoft.
2. User A installs with a generated key and can list and read OneNote pages.
3. User B repeats the process on a different machine with a separate account.
4. User B sees only user B's notes.
5. User A cannot read user B's database rows or OneNote content.

Record the result in [mvp-brief.md](mvp-brief.md). Do not tick the final
multi-tenant acceptance item based only on code inspection.

## Incident response

If a privileged credential appears in chat, logs, source control, or an issue:

1. Revoke or rotate it at the provider.
2. Update every runtime that uses it.
3. Redeploy or restart affected services.
4. Verify the old value no longer works.
5. Check provider audit logs for unexpected use.
6. Document the incident through the private security channel.

For a leaked user connection key, revoke the key in the web app and generate a
replacement. For a leaked token-encryption key, treat stored refresh tokens as
potentially exposed and require users to reconnect.
