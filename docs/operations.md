# Operations guide

This document is for maintainers with access to GitHub, Supabase, Microsoft
Entra, and npm.

## Required service access

- GitHub repository administration for
  [`ManudotaORG/artist-mcp`](https://github.com/ManudotaORG/artist-mcp) —
  Actions, environments, releases, and branch protection.
- Vercel team [`highnets-projects`](https://vercel.com/highnets-projects), for
  the [`artist-mcp`](https://vercel.com/highnets-projects/artist-mcp) project:
  configuration, environment variables, domains, deployment logs, and the
  Node.js build version.
- Supabase owner or administrator access in
  [Manudota's Org](https://supabase.com/dashboard/org/rsaqwfluhbqeuyihthdj), for
  production `zxiemadwrkcoovvpscfb`.
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

| Secret                          | Stored in              | Rotation impact                                                                 |
| ------------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| Google desktop client secret    | Web runtime            | Add the new secret in Google first, deploy, then delete the old one — see below |
| Supabase secret key             | Web runtime            | Create the replacement, deploy, then disable the old one                        |
| `TOKEN_ENCRYPTION_KEY`          | Web runtime            | **Not rotatable in place.** Every stored connection becomes unreadable; everyone reconnects |
| Microsoft web client secret     | Web runtime            | Add in Entra, deploy, then delete the old. Expires — note the date              |
| Google web client secret        | Web runtime            | Add in Google, deploy, then delete the old                                      |

The last four returned with the hosted MCP
([#55](https://github.com/ManudotaORG/artist-mcp/issues/55)); see *Hosted
credential storage* below for what they protect and how they differ from the
package's own clients. `TOKEN_ENCRYPTION_KEY` is the one with no safe rotation
story — it is not held anywhere but the deployment and a password manager, and
losing it is unrecoverable by design.

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
2. Set `GOOGLE_DESKTOP_CLIENT_SECRET` in the Vercel project and **redeploy**.
   A variable changed in project settings does not reach a deployment that is
   already running.
3. Only then **delete** the old secret. Installs cache the value they were given
   at connect time, so deleting first breaks every one of them at once.

Public or publishable Supabase browser keys identify the application but do not
grant service-role access. They are intentionally exposed to the browser; RLS
remains the data authorization boundary.

## Web deployment

The web app is one Vercel project, `artist-mcp`, connected directly to
`ManudotaORG/artist-mcp` through the Vercel GitHub App. It tracks only `main` as
its production branch.

Preview branch tracking is disabled, so `release`, `staging`, pull requests, and
every other branch create no Vercel deployment. Vercel's native Git integration
owns web deployment; GitHub Actions does not build or deploy the website.

There used to be a second project, `artist-mcp-staging`, deploying from
`staging` against its own Supabase project. Both were deleted on 2026-09-13
([#194](https://github.com/ManudotaORG/artist-mcp/issues/194)): they cost money
and nothing was being verified there. See *Staging is parked* below.

Runtime application variables live in the project's Production environment,
with `DEPLOY_ENV=production`. The footer reads the commit from Vercel's
`VERCEL_GIT_COMMIT_SHA` system variable. No Vercel token or project ID is
required in GitHub Actions.

| Setting                    | Value                                                       |
| -------------------------- | ----------------------------------------------------------- |
| `DEPLOY_ENV`               | `production`                                                |
| `NEXT_PUBLIC_SITE_URL`     | `https://artist-mcp.vercel.app`                             |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://zxiemadwrkcoovvpscfb.supabase.co`                  |
| Microsoft redirect URI     | `https://artist-mcp.vercel.app/api/auth/microsoft/callback` |
| Google redirect URI        | `https://artist-mcp.vercel.app/api/auth/google/callback`    |

The last two rows are **not** environment variables. Nothing reads a
`MS_REDIRECT_URI` or `GOOGLE_REDIRECT_URI`: `redirectUriFor` in
`apps/web/src/lib/connect.ts` derives each callback from
`NEXT_PUBLIC_SITE_URL`. They are listed because each value must be registered
with the provider, and a wrong `NEXT_PUBLIC_SITE_URL` silently produces a
redirect the provider will refuse.

The project requires the Supabase browser key, `GOOGLE_DESKTOP_CLIENT_SECRET`
and the hosted secrets in the deployment table below, and nothing else that is
secret. `NEXT_PUBLIC_SITE_URL` is mandatory in hosted builds; only local
development may fall back to `http://localhost:3000`.

A deployment missing `GOOGLE_DESKTOP_CLIENT_SECRET` answers `/api/client-config`
with 503, and `artist-mcp connect google` fails for every install that has not
cached the secret — staging builds included, since they read it from production
too. Microsoft is unaffected — it is a true public client and needs no secret.

Each provider registers the production callback and a `http://localhost:3000`
callback for local development: the Microsoft Entra app for
`/api/auth/microsoft/callback`, the Google Cloud web OAuth client for
`/api/auth/google/callback`. The Entra app also carries the package's
`http://localhost:8765/callback`; never remove it. Supabase's Auth redirect
allowlist is in `supabase/config.toml`, below.

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

Supabase has one hosted project, production `zxiemadwrkcoovvpscfb`. The
staging project `cakkwvxwlkdfzqjbvrpa` was deleted on 2026-09-13, after its
legacy API keys were disabled — deleting a project is not evidence that its keys
stopped working.

Auth URLs are configuration-as-code in `supabase/config.toml` under the
`production` remote. Do not enable automatic ephemeral/PR branches.

**Keep the checkout unlinked.** There is no safe project for an accidental
`--linked` command to land on any more, so link for the one command that needs
it and unlink afterwards. `supabase link` does not update
`supabase/.temp/linked-project.json` immediately, so that file will happily
claim you are pointed at production while you are not. Confirm with
`supabase projects list`, which reports `linked` per project, before running
anything destructive — or address a project by its URL, which cannot be
ambiguous.

Apply that file with `supabase config push --project-ref zxiemadwrkcoovvpscfb`,
which picks the `[remotes.*]` block whose `project_id` matches the ref. Make
auth changes in the file and push them. A change made only in the dashboard is
invisible to the file, and the next push reverts it without warning.

`config push` applies api, db, auth, and storage. It does not apply
`[functions.*]`; `verify_jwt` takes effect when the function is deployed.

Discover the installed CLI command shape with `supabase --help` before use.
Review migrations and function diffs, run the security advisors, and verify the
result against the linked hosted project.

### Local web development runs against a local Supabase

Until 2026-09-13 local development borrowed the staging project. That project
is gone, and production is not a substitute: its redirect allowlist refuses
`http://localhost:3000/**`, deliberately. A production magic link that can
redirect to a developer's machine is a way to hand someone else a production
session. Point a local server at production and the link lands on the deployed
site instead — Supabase falls back to `site_url` silently rather than reporting
an error. That is the intended refusal, not a bug to fix by re-adding localhost.

The replacement is the local stack, which `config.toml`'s top-level `[auth]`
block already targets:

```bash
supabase start      # needs Docker; applies supabase/migrations
supabase status     # prints the local API URL, publishable and secret keys
```

Put those values in `apps/web/.env.local`. The local database starts empty, and
signup follows the top-level `[auth]` block, so create a test user through the
local Studio or the admin API. Magic-link mail is caught by the local inbox that
`supabase status` lists, not sent.

**Not yet exercised end to end** — Docker was not installed when staging was
retired. Treat the first run as verification and correct this section with what
it finds. None of it is needed for work on `apps/mcp`, which uses no Supabase.

To confirm which project a local sign-in actually used, read the emailed link:
the host is the project, and `redirect_to` shows whether the allowlist was
honoured or fell back.

Important invariants:

- RLS remains enabled on every exposed table.
- User-facing policies include `auth.uid() = user_id`.
- Privileged `SECURITY DEFINER` functions revoke execution from `PUBLIC`,
  `anon` **and** `authenticated`, and grant only the service role. All three:
  see *The grants trap* below for why two of those look like one.
- Every new table in `public` has RLS enabled, even with no policies. PostgREST
  serves the whole schema, so a table without RLS is a public endpoint.
- Refresh-token rotation is written back on every Microsoft token exchange.
- Callers select only `verify`, `list_notes`, `map_notes`, `read_note`, `list_emails`,
  `read_email`, `read_gmail_attachment`, `map_gmail_attachment`, `list_events`, or
  `read_event`; no arbitrary
  Graph, Gmail, or Calendar URL is accepted. `read_gmail_attachment` resolves a MIME position
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
  GitHub integration is deliberately not connected, so merging to `main`
  deploys the web app through Vercel and nothing else. Push with `--db-url` for
  the database you mean rather than `--linked`, which targets whatever the
  checkout was last linked to.

## Hosted credential storage

`connections` and `mcp_keys` are live again. They were kept dormant through the
period when custody sat on user machines, on the stated bet that hosted access
would return; [#55](https://github.com/ManudotaORG/artist-mcp/issues/55) is that
return, and the bet paid — the tables, the pgcrypto functions and the sign-in
flow were all reused rather than rebuilt.

Read this alongside the two custody models, because conflating them is the
mistake this section exists to prevent:

- **The published package** holds its own tokens on the user's machine. Nothing
  here can read them, and nothing here should claim to.
- **The hosted server** holds a named user's refresh tokens, encrypted. A
  maintainer with the service role and the encryption key can decrypt them.
  Hosted users are told this on the consent screen before they connect.

### What is stored, and what protects it

| Stored | Protection |
| --- | --- |
| `connections.refresh_token`, `.access_token` | `pgp_sym_encrypt`; the key is passed per call and never lives in the database |
| `mcp_keys.key_hash` | sha256 of a maintainer-issued key; the key itself is shown once and never stored |
| `oauth_clients`, `oauth_codes`, `oauth_tokens` | RLS with **no policies**, so PostgREST exposes nothing; secrets stored as sha256 |

Two protections doing different jobs, as in the original schema: RLS keeps one
signed-in user out of another's rows, pgcrypto keeps a stolen dump from yielding
usable tokens. Neither substitutes for the other.

### The grants trap, which has now caught us twice

Supabase configures `ALTER DEFAULT PRIVILEGES` on `public` to grant `EXECUTE` on
new functions to `anon` and `authenticated`. That is an *explicit* grant per
role, separate from the implicit one to `PUBLIC`. **Revoking from `PUBLIC` alone
leaves the function callable.** Every custody function needs both revokes.

Migration `20260810010000` describes the first revoke as a no-op. It was not —
both were load-bearing — and copying that conclusion reproduced the hole in
`20260824120000`, fixed in `20260824130000`. `scripts/hosted-custody.test.mjs`
asserts both revokes for every custody function so it cannot recur silently.

When verifying by hand, **send valid arguments**. An empty `{}` body returns 404
for a signature mismatch, which reads exactly like "hidden by permissions" and
proves nothing.

### Deployment secrets

The Vercel project carries these, all Sensitive except the two client IDs:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Reads a connection for a user holding no browser session; bypasses RLS by design |
| `TOKEN_ENCRYPTION_KEY` | pgcrypto key. **Never reuse production's anywhere else.** Losing it makes every connection unreadable |
| `ARTIST_MCP_WEB_MS_CLIENT_ID` / `_SECRET` | Web OAuth client for connecting Microsoft |
| `ARTIST_MCP_WEB_GOOGLE_CLIENT_ID` / `_SECRET` | Web OAuth client for connecting Google |

The **Google** web client is a **separate registration from the package's**. The
package uses a desktop client whose Google secret is served openly by
`/api/client-config` — harmless there because PKCE protects a desktop client,
and not harmless at all for a web client. One Google registration serving both
would have to be the weaker of the two.

**Microsoft is the opposite: one registration serves both surfaces**, and must.
`ARTIST_MCP_WEB_MS_CLIENT_ID` and the package's default client id in
`apps/mcp/src/oauth.ts` are deliberately the same value
(`4e484257-2c48-4088-84b9-60ea3ca82e88`). It carries the production and
localhost web redirects plus the package's `http://localhost:8765/callback` as a public
client, with "Allow public client flows" enabled. Sharing it costs nothing —
the package's Microsoft client is a true public client, so there is no secret to
weaken — and it buys the thing that matters: `Notes.ReadWrite.CreatedByApp`
scopes page ownership to the **app registration**, so a second id would mean
hosted and local could not edit each other's OneNote pages, which reads as a bug
and would not be one. If you ever split them, that is the breakage you get.

A refresh token is bound to the client that obtained it. Hosted connections are
made by the web flow and must be refreshed by the web client; refreshing one as
the desktop client returns `AADSTS70002` from Microsoft and a bare
`Unauthorized` from Google. Connections seeded any other way must be
reconnected through the web page.

### Onboarding a hosted user

1. Create the account. Signup is closed, so this is deliberate:
   `POST /auth/v1/admin/users` with the service role. `auth.users` **is** the
   allowlist; no second mechanism exists. This is the only way in: staging's
   open signup went with staging, and production was kept invite-only rather
   than opened to replace it.
2. They sign in at `/sign-in` (unlinked from the landing page) and connect
   Microsoft and Google themselves at `/`. No maintainer handles their
   credentials.
3. For a client that can send a header, issue a key:
   `node scripts/issue-mcp-key.mjs <email> --env <env file>`. Shown once.
4. For a client that cannot — ChatGPT — they add
   `https://<site>/api/mcp` as a remote MCP server and complete OAuth. Dynamic
   registration is required: ChatGPT registers a redirect URI unique to each
   connector instance, which cannot be known in advance.

Disconnecting the last provider deletes that user's `mcp_keys` rows, by design —
a key outlives a single disconnect and dies with the last connection. OAuth
tokens are unaffected and expire on their own.

### Supabase API keys

Production is on `sb_publishable_` / `sb_secret_` keys with legacy keys
**disabled**, as staging was before it was deleted. Rotating a JWT *signing* key does **not** revoke the legacy
`anon` / `service_role` API keys — they are separate credentials, and verifying
this by hand in August 2026 is the only reason a live exposed key was found.
Disabling legacy keys is what revokes them.

Vercel snapshots environment variables per deployment, so migrate consumers and
**redeploy** before disabling legacy keys, or the running deployment keeps using
values that have stopped working.

### Nothing is kept dormant any more

This section listed things kept on a bet that they would be wanted again. The
list is empty, and both entries are worth recording rather than deleting,
because how each one ended is the useful part.

**`supabase/functions/graph/`** — removed, with its tests, its CI job and its
`[functions.graph]` config. It served installs before 1.0.0, when every
operation went through it; 1.0.0 moved that onto the user's own machine and
nothing has called it since. Keeping it was defensible while 0.x installs might
exist. What made removing it the better answer was not the dead code: it
authenticated against `mcp_keys`, the same table the hosted server uses, and
refreshed tokens without taking the lease `try_lock_refresh` exists to hold — so
a call to it could invalidate a connection the hosted server was using. A
dormant thing that shares live state is not dormant.

**`apps/web/src/lib/crypto.ts`** — encryption happens in the database through
`set_connection`, so if it is still unimported it is cleanup rather than a
considered bet.

The `connections` and `mcp_keys` tables were on this list too, and came back:
see *Hosted credential storage* above. That is the case for writing down why
something is kept rather than only that it is.

### History

The 2026-08-14 teardown (#22) deleted every stored row, undeployed the `graph`
function, and removed the service role, encryption key and provider secrets from
both Vercel projects **followed by a redeploy** — that last step is what ended
the exposure, not the row deletion. Empty tables plus a deployed service-role
key is not the same as no exposure.

The current `TOKEN_ENCRYPTION_KEY` values were generated fresh in August 2026,
one per environment. The old one was never recorded and nothing needs it.

## Staging is parked

The hosted staging environment was retired on 2026-09-13
([#194](https://github.com/ManudotaORG/artist-mcp/issues/194)). What was kept
is what is cheap to keep and expensive to rebuild from memory:

| Kept | Why |
| --- | --- |
| The `staging` branch, protected | Still where a dist-tag build comes from |
| `publish-staging` in `release.yml`, the `staging` GitHub environment, `set-staging-version.mjs` | Publishes `@manudota/artist-mcp@staging`, which needs no website |
| Dependabot targeting `staging`, CI on `staging` | Unchanged |
| `DEPLOY_ENV=staging` handling in `apps/web` | Harmless with nothing deploying it; the way back |

What was removed: the `artist-mcp-staging` Vercel project and its variables,
the Supabase project `cakkwvxwlkdfzqjbvrpa` (legacy keys disabled first), its
`[remotes.staging]` block in `config.toml`, and the staging callbacks in Entra
and the Google web client.

A staging npm build is not a staging environment. It talks to the same
providers as any install and reads Google's client configuration from
production. It used to read it from the staging site, and the retirement broke
`connect google` on staging builds until that was fixed.

To bring staging back: a Supabase project with the migrations applied and
signup decided, a `[remotes.staging]` block pushed to it, a Vercel project on
`staging` with `DEPLOY_ENV=staging` and its own `TOKEN_ENCRYPTION_KEY`, the
staging callbacks re-registered with both providers, and a decision on whether
staging builds should read client configuration from it again.

## Publishing

Releases, npm channels, the trusted-publisher mapping and what to do when a
publish fails are in [releases.md](releases.md).

## Hosted isolation test

This tests the **hosted** server, where one process serves many people. It does
not apply to the published package, where each user runs their own process
against their own token file.

1. User A signs into the web app and connects Microsoft.
2. User A is issued a key with `node scripts/issue-mcp-key.mjs <email>` and can
   list and read their OneNote pages through `/api/mcp`.
3. User B repeats the process with a separate account.
4. User B sees only user B's notes.
5. User A cannot read user B's database rows or OneNote content.
6. A write capability granted to user A appears for A and for nobody else.

Run it against production, with two accounts created for the purpose, after any
change to token custody, key resolution, or
how grants reach `createServer`. Do not accept it on code inspection alone: the
failure this catches is one user's state reaching another's session, which
every test that runs one user at a time will pass.

## Incident response

If a privileged credential appears in chat, logs, source control, or an issue:

1. Revoke or rotate it at the provider.
2. Update every runtime that uses it.
3. Redeploy or restart affected services.
4. Verify the old value no longer works.
5. Check provider audit logs for unexpected use.
6. Document the incident through the private security channel.

Which credentials are at stake depends on the custody model. A package user's
refresh token never reaches us, so there is no stored credential here to leak on
their behalf. A hosted user's does: it sits encrypted in `connections`, so a
compromise of `TOKEN_ENCRYPTION_KEY` together with the service key is a
credential incident for every hosted connection, and is handled as one — see
"Hosted credential storage" above.

Either way the user's own remedy is immediate and settles it: removing this app
from their [Microsoft](https://account.live.com/consent/Manage) or
[Google](https://myaccount.google.com/connections) account invalidates the token
everywhere it exists.

The Google desktop client secret is already public and is not an incident. It
grants nothing without a PKCE verifier; rotate it only if Google demands it, and
follow the ordering in the secret inventory so live installs are not broken.
