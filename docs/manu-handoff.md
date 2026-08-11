# Manu handoff

## What Joaquin set up

Joaquin completed the project infrastructure and initial production launch.
The application is a read-only OneNote MCP for Claude Desktop and Codex, plus
an installable Markdown workflow pack for musician project work.

Live surfaces:

- Production web: <https://artist-mcp.vercel.app>
- Staging web: <https://artist-mcp-staging.vercel.app>
- npm package: <https://www.npmjs.com/package/@manudota/artist-mcp>
- npm access and trusted publisher: <https://www.npmjs.com/package/@manudota/artist-mcp/access>
- GitHub repository: <https://github.com/ManudotaORG/artist-mcp>
- GitHub releases: <https://github.com/ManudotaORG/artist-mcp/releases>

## System map

1. The web app signs a user in with Supabase magic link.
2. Microsoft OAuth grants `Notes.Read`, `offline_access`, and `User.Read`.
3. The server stores the encrypted Microsoft refresh token in Supabase.
4. The user generates a one-time connection key; only its SHA-256 hash is stored.
5. The local npm MCP sends the key to the hosted Supabase Graph Edge Function.
6. The function resolves the user, rotates the Microsoft refresh token, and
   performs only `verify`, `list_notes`, or `read_note` against Microsoft Graph.
7. Claude or Codex receives the result in chat. Artist content is never copied
   into Supabase and nothing is written back to OneNote.

One OneNote page is one working unit. The installed workflow pack supplies the
Orchestrator, Archivist, Registrar, Project Manager, Envoy, Auditor, and Janitor
roles plus Concert, Large Concert, Studio Session, and Rehearsal project types.
These are Markdown policies, not autonomous services or a coordination protocol.

## External services and ownership

Manu should have maintainership or admin access to all of these:

| Service | Resource | Why access is needed |
| --- | --- | --- |
| GitHub | [`ManudotaORG/artist-mcp`](https://github.com/ManudotaORG/artist-mcp) | Source, [Actions](https://github.com/ManudotaORG/artist-mcp/actions), [environments](https://github.com/ManudotaORG/artist-mcp/settings/environments), [releases](https://github.com/ManudotaORG/artist-mcp/releases), [branch protection](https://github.com/ManudotaORG/artist-mcp/settings/branches) |
| Vercel | Team [`highnets-projects`](https://vercel.com/highnets-projects); [`artist-mcp`](https://vercel.com/highnets-projects/artist-mcp) and [`artist-mcp-staging`](https://vercel.com/highnets-projects/artist-mcp-staging) | Web configuration, environment variables, domains, deployment logs |
| Supabase | [Manudota's Org](https://supabase.com/dashboard/org/rsaqwfluhbqeuyihthdj); [production `zxiemadwrkcoovvpscfb`](https://supabase.com/dashboard/project/zxiemadwrkcoovvpscfb), [permanent staging `cakkwvxwlkdfzqjbvrpa`](https://supabase.com/dashboard/project/cakkwvxwlkdfzqjbvrpa) | Auth, database, RLS, Edge Functions, branch configuration |
| npm | [`@manudota/artist-mcp`](https://www.npmjs.com/package/@manudota/artist-mcp) and its [access settings](https://www.npmjs.com/package/@manudota/artist-mcp/access) | Package access and the trusted publisher |
| Microsoft Entra | [artist-mcp app registration](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/4e484257-2c48-4088-84b9-60ea3ca82e88) | Redirect URIs, delegated permissions, client-secret rotation |
| Telegram | Channel [`Artist Mcp Admin Automation`](https://web.telegram.org/a/#-1004350015211), bot [`@ArtistMcpBot`](https://t.me/ArtistMcpBot) | Production release announcements |

Use individual accounts and MFA. Do not share passwords, recovery codes, or
the Telegram bot token in issues or documentation.

## Environments

There are exactly three application contexts:

- Local: `.env.local`, localhost Microsoft callback, no footer deployment data.
- Staging: permanent Supabase staging branch and `artist-mcp-staging` Vercel
  project. The site is public and has no password. Commands use npm `@staging`.
- Production: production Supabase project and `artist-mcp` Vercel project.
  The footer shows the stable package version, Vercel Git hash, and patch notes.

Vercel deploys through its native GitHub App, not GitHub Actions. Production
tracks only `main`; staging tracks only `staging`; Preview branch tracking is
disabled on both. The Vercel GitHub App is limited to this repository. Unused
Vercel tokens and project IDs were removed from GitHub environments.

Direct project settings:

- Production Git: <https://vercel.com/highnets-projects/artist-mcp/settings/git>
- Production environment: <https://vercel.com/highnets-projects/artist-mcp/settings/environments/production>
- Staging Git: <https://vercel.com/highnets-projects/artist-mcp-staging/settings/git>
- Staging environment: <https://vercel.com/highnets-projects/artist-mcp-staging/settings/environments/production>

There is no shared vault. Secrets live only where they execute:

- Local web secrets: `apps/web/.env.local` (gitignored).
- Hosted web secrets: the corresponding Vercel project's Production environment.
- Edge Function secrets: the corresponding Supabase production or staging branch.
- Telegram credentials: GitHub `production` environment secrets.

GitHub environment links:

- Production: <https://github.com/ManudotaORG/artist-mcp/settings/environments/production>
- Staging: <https://github.com/ManudotaORG/artist-mcp/settings/environments/staging>

## Release systems

CI runs on pull requests targeting `staging` or `main`, plus pushes to `release`
and `main`. Husky and Commitlint enforce Conventional Commits locally and in
pull-request validation. This avoids spending Actions minutes on PRs that cannot
deploy.

Dependabot groups npm production dependencies, npm development dependencies,
and GitHub Actions updates into weekly PRs targeting `staging`. Limits are kept
small to reduce notification noise and Actions usage. A merged dependency update
must be synchronized back into `release` before production promotion. npm and
GitHub Actions major versions are ignored automatically and should be upgraded
through an explicit migration instead.

The npm staging and stable channels share `.github/workflows/release.yml` so
they can use npm's single trusted-publisher mapping:

- Repository: `ManudotaORG/artist-mcp`
- Workflow: `release.yml`
- npm environment restriction: blank
- Permission: `npm publish`
- Authentication: GitHub OIDC with provenance; there is no `NPM_TOKEN`

Staging pushes publish unique versions such as `0.2.1-staging.5`. Main uses
Release Please. Merging its release PR creates a GitHub release, publishes npm
`latest`, and sends clean, grouped, deduplicated notes to Telegram. The manual
`Send production patch notes` workflow can retry a tag without republishing npm.

Operational links:

- CI runs: <https://github.com/ManudotaORG/artist-mcp/actions/workflows/ci.yml>
- npm release workflow: <https://github.com/ManudotaORG/artist-mcp/actions/workflows/release.yml>
- Manual Telegram resend: <https://github.com/ManudotaORG/artist-mcp/actions/workflows/telegram-release-notes.yml>
- Pull requests, including Release Please: <https://github.com/ManudotaORG/artist-mcp/pulls>
- npm package code and provenance: <https://www.npmjs.com/package/@manudota/artist-mcp?activeTab=code>

## Normal development handoff

```bash
git switch release
git pull --ff-only origin release
pnpm install
pnpm test
```

Work on `release`, push it, and wait for CI. Promote only a known-good snapshot:

```bash
git push origin release:staging
# verify staging web, auth, npm @staging, and relevant Edge Function behavior
git push origin release:main
```

For package changes, review and merge the Release Please PR after production
code is ready. That merge is the stable npm and Telegram release gate.

## Verified systems

- Magic-link authentication and Microsoft delegated OAuth work end to end.
- The cached-session Microsoft OAuth loop was fixed and reconnection succeeds.
- Real OneNote pages can be listed and read through the published MCP package.
- Rotated refresh tokens are written back after Graph calls.
- RLS and privileged function grants were checked against anonymous access.
- The npm agent installer works idempotently from a clean directory.
- npm staging and stable publishes use OIDC provenance.
- Native Vercel Git deployments work for both stable branches, with previews off.
- Telegram release notes can be automatically sent and manually retried.

## Remaining product work

The only unchecked MVP acceptance item is a real second-user test on a separate
machine: that user must sign in, connect their own Microsoft account, install
from npm with their own key, and prove they see only their own OneNote pages.
This is also the final empirical proof of multi-tenant isolation.

Known deferred improvements, not current MVP blockers:

- The in-app Microsoft disconnect flow atomically removes the refresh token and
  all MCP keys; its permissions and mutation were verified in staging with a
  rollback-only authenticated fixture.
- Replace the in-isolate rate limiter with shared abuse protection.
- Support multiple independently revocable connection keys per user.

Do not expand the current MVP into OneNote writes, message sending, calendar
editing, data synchronization, autonomous agents, claims, queues, locks, or a
review system without an explicit product decision.

## Read next

- [Development guide](development.md)
- [Operations guide](operations.md)
- [Release and agent systems](releases-and-agents.md)
- [MVP brief and verification record](mvp-brief.md)
- [Installation guide](installation.md)
