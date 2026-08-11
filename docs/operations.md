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

Supabase uses one production project and one permanent, data-less staging
branch:

- Production: `zxiemadwrkcoovvpscfb`
- Staging: `cakkwvxwlkdfzqjbvrpa`, mapped to Git branch `staging`

Auth URLs are configuration-as-code in `supabase/config.toml` under the
`production` and `staging` remotes. Edge Function secrets remain
branch-specific and must be installed separately in both environments. Do not
enable automatic ephemeral/PR branches; this project has only production and
the permanent staging branch.

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

Release Please owns production versioning. Conventional commits merged to
`main` update its release PR; merging that PR creates the GitHub release and
the `release.yml` workflow publishes through npm trusted publishing and GitHub
OIDC. Do not publish production versions manually from a maintainer laptop.

Before merging the release PR, verify from a clean worktree:

```bash
pnpm build
pnpm lint
pnpm --filter @manudota/artist-mcp pack
```

Inspect the tarball contents before publishing. The package must ship only the
required `dist` and `agent-pack` files, keep the executable shebang, target Node
20 or newer, and publish publicly. npm permits one trusted publisher per
package. It must match `ManudotaORG/artist-mcp`, workflow filename `release.yml`,
allow `npm publish`, and leave npm's environment field blank. The workflow
binds its stable job to GitHub `production` and its snapshot job to `staging`.

Every push explicitly promoted to the `staging` branch publishes a unique
prerelease through the staging job in `.github/workflows/release.yml` under the
npm `staging` dist-tag. This remains separate from stable `latest` publication.

Keep the staging environment variable `NPM_STAGING_PUBLISH_ENABLED` unset until
the shared trusted publisher exists. Set it to `true` only after npm has the
exact `release.yml` mapping. Validation remains active while publication is gated.
The staging publication job runs the MCP package tests only; website validation
belongs to CI and the Vercel deployment job, avoiding a duplicate web build.

An npm `404` during an OIDC publish usually means the package's trusted
publisher does not exactly match the repository or workflow filename above. It
does not mean the tarball is missing.

After publishing, test from a clean temporary directory:

```bash
npx @manudota/artist-mcp init
npx @manudota/artist-mcp agents install
```

If production Telegram patch notes are enabled, the release workflow fetches
the newly created GitHub release, formats and deduplicates its notes, then sends
them only after the npm `latest` publication succeeds. Telegram credentials are
scoped to the `production` GitHub environment. Use the manual
`telegram-release-notes.yml` workflow to retry a specific existing tag without
republishing npm.

Verify the four MCP tools (`list_notes`, `read_note`,
`list_agent_workflows`, and `load_agent_workflow`) with a real client. Registry
metadata can lag immediately after publication; package access status is the
authoritative initial signal.

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
