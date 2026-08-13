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

| Secret                  | Stored in                           | Rotation impact                                                                          |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Supabase server key     | Web runtime                         | Update every web environment                                                             |
| Microsoft client secret | Web runtime and Edge Function       | Update both before deleting the old credential                                           |
| Token encryption key    | Web runtime and Edge Function       | Existing encrypted refresh tokens depend on it; plan a data migration or reconnect users |
| Connection key          | User client and hashed database row | Generate a replacement and reinstall each affected client                                |

Public or publishable Supabase browser keys identify the application but do not
grant service-role access. They are intentionally exposed to the browser; RLS
remains the data authorization boundary.

## Web deployment

The web app uses two Vercel projects connected directly to
`ManudotaORG/artist-mcp` through the Vercel GitHub App:

- `artist-mcp` tracks only `main` as its production branch.
- `artist-mcp-staging` tracks only `staging` as its production branch.

Preview branch tracking is disabled in both projects, so `release`, pull
requests, and every unassigned branch create no Vercel deployment. Vercel's
native Git integration owns web deployment; GitHub Actions does not build or
deploy the website. Both stable targets are public, and staging has no password
or deployment-protection gate.

Runtime application variables live in each Vercel project's Production
environment. Set `DEPLOY_ENV=production` in `artist-mcp` and
`DEPLOY_ENV=staging` in `artist-mcp-staging`. The footer reads the commit from
Vercel's `VERCEL_GIT_COMMIT_SHA` system variable. No Vercel token or project ID
is required in GitHub Actions.

Keep this environment matrix exact; never copy the production Supabase values
into staging:

| Setting                    | Production                                                  | Staging                                                             |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `DEPLOY_ENV`               | `production`                                                | `staging`                                                           |
| `NEXT_PUBLIC_SITE_URL`     | `https://artist-mcp.vercel.app`                             | `https://artist-mcp-staging.vercel.app`                             |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://zxiemadwrkcoovvpscfb.supabase.co`                  | `https://cakkwvxwlkdfzqjbvrpa.supabase.co`                          |
| `MS_REDIRECT_URI`          | `https://artist-mcp.vercel.app/api/auth/microsoft/callback` | `https://artist-mcp-staging.vercel.app/api/auth/microsoft/callback` |
| `GOOGLE_REDIRECT_URI`      | `https://artist-mcp.vercel.app/api/auth/google/callback`    | `https://artist-mcp-staging.vercel.app/api/auth/google/callback`    |
| npm MCP default            | production Graph function                                   | staging Graph function for `-staging.*` versions                    |

Both Vercel projects also require their matching Supabase browser key and
service-role key plus `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY`. `NEXT_PUBLIC_SITE_URL` is
mandatory in hosted builds; only local development may fall back to
`http://localhost:3000`.

The Graph edge function needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in
its own secrets as well as the web app's — it performs its own refresh-token
exchange and shares nothing with Vercel.

Production uses `https://artist-mcp.vercel.app`; staging uses
`https://artist-mcp-staging.vercel.app`. Add each `/api/auth/microsoft/callback`
URL to the Microsoft Entra app, each `/api/auth/google/callback` URL to the
Google Cloud OAuth client, and each `/auth/confirm` origin to the Supabase
Auth redirect allowlist.

Gmail's `gmail.readonly` scope is restricted: Google requires app verification
before users outside the test list can consent, and that review takes weeks.
Add the intended users to the OAuth consent screen's test-user list to work
before verification completes.

Enable the **Gmail API** and the **Google Calendar API** in the Google Cloud
project itself, not just the scopes on the consent screen. They are separate
switches, and OAuth succeeds without them: the consent screen appears, the
refresh token stores, and the first read then fails with a 403 that names the
project. Consenting is not evidence that an API is on.

Adding a Google scope does not widen refresh tokens already issued. A user
connected before Calendar was added keeps working for Gmail and is refused for
Calendar until they reconnect, which the function reports as "this connection
predates Google Calendar access" rather than as a failure. Expect every existing
Google connection to need one reconnect after this ships; `prompt=consent` is
already set, so reconnecting grants the new scope without further work.

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
- Callers select only `verify`, `list_notes`, `read_note`, `list_emails`,
  `read_email`, `read_attachment`, `list_events`, or `read_event`; no arbitrary
  Graph, Gmail, or Calendar URL is accepted. `read_attachment` fetches only an
  attachment that the named message actually carries, capped at 10 MB, and
  extracted text is capped at 40,000 characters during extraction rather than
  after it. Search syntax is passed as a query parameter, never
  interpolated into a path.
- Migrations and Edge Functions deploy by hand, reviewed first. The Supabase
  GitHub integration is deliberately not connected, so merging to `staging` or
  `main` deploys the web app through Vercel and nothing else. Push with
  `--db-url` for the branch you mean: the CLI is linked to production, so
  `--linked` targets production whatever you intended.

## Publish the MCP package

Release Please owns production versioning. Conventional commits merged to
`main` update its release PR; merging that PR creates the GitHub release and
the `release.yml` workflow publishes through npm trusted publishing and GitHub
OIDC. Do not publish production versions manually from a maintainer laptop.

Protect `main` and `staging` with the `Lint and build` status check. Promote
through pull requests so neither environment can receive an unvalidated direct
push. `release` remains the integration branch and validates its pushes without
requiring pull requests targeting it.

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
A successful stable publication also runs that job against the staging branch,
using npm `latest` as its version base. This guarantees that releasing `0.5.0`
advances staging to `0.5.1-staging.<run>` without a manual metadata-sync push.
Retried workflow runs append the attempt number to avoid republishing an
immutable npm version.

Keep the staging environment variable `NPM_STAGING_PUBLISH_ENABLED` unset until
the shared trusted publisher exists. Set it to `true` only after npm has the
exact `release.yml` mapping. Validation remains active while publication is gated.
The staging publication job runs the MCP package tests only. Website validation
belongs to CI; Vercel performs the deployment build, avoiding a duplicate web
build in GitHub Actions.

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

Verify the MCP tools with a real client: `list_notes` and `read_note` against
OneNote, `list_emails`, `read_email`, `read_attachment`, `list_events` and
`read_event` against Google, and `list_agent_workflows` and `load_agent_workflow` against the pack. Registry
and playbook content come from the installed npm package by default, preserving
the version selected by the user. `ARTIST_MCP_REGISTRY_URL` and
`ARTIST_MCP_ENDPOINT` are development/testing overrides, not publishing-job or
end-user requirements.

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
