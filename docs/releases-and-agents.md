# Releases, environments, and artist workflows

## GitHub environments

CI runs for pull requests and pushes to `release` and `main`. Staging receives
only commits already validated on `release`; its npm workflow retests the MCP
package and its Vercel workflow builds the web app, so a third full monorepo CI
run would duplicate both. CI does not bind to a deployment environment and receives no runtime secrets.
Store environment-specific deployment secrets in the matching `staging` or
`production` GitHub environment. Protect `main` and require the `Lint and
build` check before merge.

## Automatic npm releases

The npm package has two branch-backed channels:

- `staging` publishes a unique prerelease such as
  `0.1.1-staging.123` with the npm dist-tag `staging`.
- `main` is managed by Release Please and publishes stable releases with the
  npm dist-tag `latest`.

Install an explicitly promoted staging snapshot with:

```bash
npx @manudota/artist-mcp@staging agents install
```

Release Please tracks `apps/mcp`. Conventional commits on `main` update a
release pull request; merging it creates the GitHub release and publishes
`@manudota/artist-mcp` from `.github/workflows/release.yml`.
Manual runs update or inspect the Release Please state but never republish an
existing stable npm version; stable publication requires a newly created
release.

In the npm package settings, configure a trusted publisher with:

- Organization or user: `ManudotaORG`
- Repository: `artist-mcp`
- Workflow: `.github/workflows/release.yml`
- Environment: `production`

Add a second trusted publisher for staging:

- Organization or user: `ManudotaORG`
- Repository: `artist-mcp`
- Workflow: `.github/workflows/publish-staging.yml`
- Environment: `staging`

Until that second mapping exists, leave the `NPM_STAGING_PUBLISH_ENABLED`
variable unset in the `staging` GitHub environment. The workflow still builds,
tests, and versions the snapshot without producing a false-red publish job.
After npm accepts the mapping, set the variable to `true`; staging pushes then
publish normally.

No `NPM_TOKEN` is needed. The workflow authenticates with GitHub OIDC.

## Production patch notes

Production releases can announce themselves through Telegram after the stable
npm package publishes. The formatter groups conventional Release Please notes,
removes duplicate bullets, escapes Telegram HTML, and splits messages below the
Telegram message limit. Staging snapshots never send patch notes.

Create a Telegram bot with BotFather, add it to the destination chat, and store
these secrets in the GitHub `production` environment:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

After both secrets are present, set the production environment variable
`TELEGRAM_PATCH_NOTES_ENABLED=true`. The stable release workflow sends notes
after npm publication. To resend an existing release, run the **Send production
patch notes** workflow with its tag. Leave the variable unset while configuring
the bot so releases and manual runs cannot fail or send partial messages.

The implementation lives in `scripts/format-release-notes.mjs` and
`scripts/publish-release-notes.sh`. Formatter behavior is covered by the root
test suite.

## Read-only artist workflow pack

Install the bundled MVP pack in the current repository:

```bash
npx @manudota/artist-mcp agents install
```

It adds a root `AGENTS.md`, seven narrow roles, four starter project types, and
the local-state policy under `.artist/`. Installation is idempotent. A
differing root `AGENTS.md` is kept; the command explains how to reference
`.artist/` manually. Differing workflow files stop the install before anything
is written.

The roles are Orchestrator, Archivist, Registrar, Project Manager, Envoy,
Auditor, and Janitor. The starter project types are Concert, Large Concert,
Studio Session, and Rehearsal.

One OneNote page is one working unit. The pack can read that page and produce a
recommendation, plan, draft, audit, or cleanup summary in chat. It cannot write
to OneNote, send outreach, edit calendars, or persist project state.

Agents may optionally keep small, disposable working context in
`.artist/local/`, which is gitignored. They choose the smallest useful local
format, but may not store secrets, copy source systems, or turn local files into
claims, queues, locks, reviews, or other coordination infrastructure. The
backend never stores this local state.

## Runtime registry

The MCP server exposes `list_agent_workflows` and `load_agent_workflow`. The
registry is generated from the Markdown files during package build and each
entry includes a SHA-256 checksum. At runtime the server checks GitHub for the
current registry and falls back to the bundled copy if GitHub is unavailable.
This lets merged Markdown changes update behavior without changing the Supabase
backend or copying the artist's OneNote data.

Set `ARTIST_MCP_REGISTRY_URL` only when testing a different registry. The
default points at this repository's `main` branch.
