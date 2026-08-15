# Operations guide

This document is for maintainers with access to GitHub, Supabase, Microsoft
Entra, and npm.

## Required service access

- GitHub repository administration for
  [`ManudotaORG/artist-mcp`](https://github.com/ManudotaORG/artist-mcp) —
  Actions, environments, releases, and branch protection.
- Vercel team [`highnets-projects`](https://vercel.com/highnets-projects), for
  the [`artist-mcp`](https://vercel.com/highnets-projects/artist-mcp) and
  [`artist-mcp-staging`](https://vercel.com/highnets-projects/artist-mcp-staging)
  projects: configuration, environment variables, domains, deployment logs, and
  the Node.js build version.
- Supabase owner or administrator access in
  [Manudota's Org](https://supabase.com/dashboard/org/rsaqwfluhbqeuyihthdj), for
  production `zxiemadwrkcoovvpscfb` and permanent staging
  `cakkwvxwlkdfzqjbvrpa`.
- Microsoft Entra access to manage the app registration, permissions, redirect
  URIs, and client credentials — app id
  `4e484257-2c48-4088-84b9-60ea3ca82e88`.
- npm owner access to the `@manudota` scope and
  `@manudota/artist-mcp` package, including its trusted-publisher mapping.
- Telegram: the `Artist Mcp Admin Automation` channel and the `@ArtistMcpBot`
  bot, which announce production releases.
- The team secret manager and security-notification email aliases.

Use individual accounts and individual MFA. Do not share account passwords,
recovery codes, personal MFA recovery material, or the Telegram bot token —
including in issues and documentation.

## Secret inventory

| Secret                       | Stored in                | Rotation impact                                                                 |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| Google desktop client secret | Web runtime, both envs   | Add the new secret in Google first, deploy, then delete the old one — see below |
| Supabase service role key    | Supabase platform only   | Rotate in the dashboard; no deployment holds a copy                             |

Nothing else is deployed. The Microsoft and Google client secrets that belonged
to the hosted OAuth flow, and the token encryption key that protected stored
refresh tokens, were removed when custody moved to users' machines (#22). There
is no connection key any more.

**The Google desktop client secret is public by necessity.** Google refuses the
token exchange for a Desktop client without one, and the client types that need
none cannot use a loopback redirect, so every install must be able to obtain it.
`/api/client-config` serves it to anyone who asks. It grants nothing on its own:
PKCE is enforced by both providers, verified against their live endpoints by
`scripts/spike-pkce.mjs`.

Rotating it has an ordering constraint that matters, because Google hashes
secrets and will not show one twice:

1. **Add** a second secret on the Desktop client and record it somewhere
   readable — a password manager. The console will never display it again, and
   neither Vercel nor GitHub can read a stored value back.
2. Set `GOOGLE_DESKTOP_CLIENT_SECRET` in both Vercel projects and **redeploy**.
   A variable changed in project settings does not reach a deployment that is
   already running.
3. Only then **delete** the old secret. Installs cache the value they were given
   at connect time, so deleting first breaks every one of them at once.

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

Both Vercel projects require their matching Supabase browser key and
`GOOGLE_DESKTOP_CLIENT_SECRET`, and nothing else that is secret.
`NEXT_PUBLIC_SITE_URL` is mandatory in hosted builds; only local development may
fall back to `http://localhost:3000`.

A project missing `GOOGLE_DESKTOP_CLIENT_SECRET` answers `/api/client-config`
with 503, and `artist-mcp connect google` fails against that environment.
Microsoft is unaffected — it is a true public client and needs no secret.

Local development is a third environment and uses staging's Supabase project,
not production's — see "Local development runs against staging" below.

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
`production` and `staging` remotes. Do not enable automatic ephemeral/PR
branches; this project has only production and the permanent staging branch.

`supabase link` does not update `supabase/.temp/linked-project.json`
immediately, so that file will happily claim you are pointed at production while
you are not. Confirm with `supabase projects list`, which reports `linked` per
project, before running anything destructive — or address a project by its URL,
which cannot be ambiguous.

Apply that file with `supabase config push --project-ref <ref>`, which picks
the `[remotes.*]` block whose `project_id` matches the ref. The CLI is linked
to production, so always pass `--project-ref` explicitly. Both refs were pushed
on 2026-08-13; before that the file had never been applied to either project
and had drifted from both. Make auth changes in the file and push them. A
change made only in the dashboard is invisible to the file, and the next push
reverts it without warning.

`config push` applies api, db, auth, and storage. It does not apply
`[functions.*]`; `verify_jwt` takes effect when the function is deployed.

Discover the installed CLI command shape with `supabase --help` before use.
Review migrations and function diffs, run the security advisors, and verify the
result against the linked hosted project.

### Local development runs against staging

`apps/web/.env.local` carries staging's Supabase URL, anon key, and
service-role key — never production's. Copy them from the staging Vercel
project or the Supabase dashboard rather than retyping: a mistyped key fails in
ways that look like an auth bug.

The redirect allowlists follow from that, and the asymmetry is the point:

| Project    | `http://localhost:3000/**` allowed |
| ---------- | ---------------------------------- |
| Staging    | yes — local sign-in depends on it  |
| Production | no, deliberately                   |

`getSiteUrl()` falls back to `http://localhost:3000` when
`NEXT_PUBLIC_SITE_URL` is unset, so a local `signInWithOtp` asks for a
localhost redirect. Staging allows it and the magic link opens on your machine.
Production does not, and if you point a local server at production the link
lands on the deployed site instead — Supabase falls back to `site_url` silently
rather than reporting an error. That is the intended refusal, not a bug to fix
by re-adding localhost to production. A production magic link that can redirect
to a developer's machine is a way to hand someone else a production session.

To confirm which project a local sign-in actually used, read the emailed link:
the host is the project ref, and `redirect_to` shows whether the allowlist was
honoured or fell back.

Staging holds no real data, so anything a feature needs must be set up there:
a Google connection exists and works; Microsoft is not connected, so OneNote
cannot be exercised locally until it is.

Important invariants:

- RLS remains enabled on every exposed table.
- User-facing policies include `auth.uid() = user_id`.
- Privileged `SECURITY DEFINER` functions revoke execution from `PUBLIC` and
  grant only the required service role.
- The Graph function, if it is ever redeployed, keeps `verify_jwt = false` and
  verifies the connection key inside the function. It is not deployed today —
  see the dormant-storage section below.
- Refresh-token rotation is written back on every Microsoft token exchange.
- Callers select only `verify`, `list_notes`, `read_note`, `list_emails`,
  `read_email`, `read_attachment`, `map_attachment`, `list_events`, or
  `read_event`; no arbitrary
  Graph, Gmail, or Calendar URL is accepted. `read_attachment` resolves a MIME position
  against the message it names, so an attachment cannot be read out of another
  message; Gmail's own attachment ids are per-fetch and are never published.
  Fetching is capped at 10 MB, and extracted text at 40,000 characters during
  extraction rather than after it. `read_note` holds itself to that same
  40,000-character limit and returns a longer page in parts — one policy on how
  much text may arrive in a single answer, shared from one constant, rather than
  two limits that happen to agree. A call also ends once its image budget is
  spent, reporting the page to resume from, so a long scan is read across
  several calls rather than one that would exhaust the function. Search syntax is passed as a query parameter, never
  interpolated into a path.
- Migrations deploy by hand, reviewed first. The Supabase
  GitHub integration is deliberately not connected, so merging to `staging` or
  `main` deploys the web app through Vercel and nothing else. Push with
  `--db-url` for the branch you mean: the CLI is linked to production, so
  `--linked` targets production whatever you intended.

## Dormant hosted credential storage

`connections` and `mcp_keys` are still in the schema and are no longer written
to. They belonged to the hosted design, where this service held every user's
refresh token and resolved a connection key on their behalf. An installed copy
now holds its own tokens and calls Microsoft and Google directly, so there is
nothing for this service to store or resolve.

They were left in place rather than dropped, deliberately. Bringing hosted
custody back would mean acting for a user while their machine is off — shared
workspaces, or anything scheduled — and the schema is the cheap part of that to
keep. Reviving it would still cost every user a reconnect, because the tokens
are deliberately not here any more.

That is a live intention, not sentiment:
[#55](https://github.com/ManudotaORG/artist-mcp/issues/55) proposes a hosted MCP
for a few named users, isolated from the public product. While that is open, this
path is a head start rather than a tax, and **removing any part of it should be
decided together with #55 rather than as cleanup.**

### What is kept, in one place

Listed here so a reader can confirm dormancy without inferring it four times.
Every item is unwritten, unimported, or undeployed:

| Kept | State |
| --- | --- |
| `connections`, `mcp_keys` tables | In the schema, RLS on, no rows, nothing writes them |
| `apps/web/src/lib/crypto.ts` | Imported nowhere; encrypted the stored refresh tokens |
| `supabase/functions/graph/` | Source and tests only, not deployed |
| `verify_jwt = false` for `graph` in `supabase/config.toml` | Configuration for a function that is not deployed |
| Dummy provider env vars in `ci.yml` | Needed by the Deno tests above, whose module scope reads them at import; the values are the string `unused` |

Each of these has looked like dead code to a reader at some point, which is the
cost of keeping it. Adding to the list is fine; removing from it is a decision.

The credentials that made the old design dangerous were **not** kept. Done on
2026-08-14, in this order:

1. Every row deleted from `connections` and `mcp_keys`, in production and
   staging.
2. The `graph` edge function undeployed, and its `TOKEN_ENCRYPTION_KEY`,
   `MS_CLIENT_SECRET` and `GOOGLE_CLIENT_SECRET` unset.
3. `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY` and the provider client
   secrets removed from both Vercel projects, **followed by a redeploy**. A
   variable removed from project settings stays injected in the deployment
   already running, so without the redeploy every secret would still have been
   live.

Step 3 is what ended the exposure, not step 1. Empty tables plus a deployed
service-role key is not the same as no exposure — the risk ends when the secrets
leave the deployment.

The token encryption key is gone and was not recorded anywhere, which is fine
only because no encrypted rows survive. Reviving hosted custody means a new key
and a reconnect for every user; there is nothing to decrypt with the old one.

If you revive any of this, change the public page in the same breath. The
"WHERE YOUR CREDENTIALS LIVE" callout now tells musicians that no maintainer can
read their notes, and a revival makes that false (#22).

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

A user's refresh token never reaches us, so there is no stored credential here
to leak on their behalf. If a user believes their machine is compromised, the
fix is theirs and immediate: removing this app from their
[Microsoft](https://account.live.com/consent/Manage) or
[Google](https://myaccount.google.com/connections) account invalidates the token
everywhere it exists.

The Google desktop client secret is already public and is not an incident. It
grants nothing without a PKCE verifier; rotate it only if Google demands it, and
follow the ordering in the secret inventory so live installs are not broken.
