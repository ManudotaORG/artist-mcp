# Releases, environments, and artist workflows

## GitHub environments

CI runs for pull requests and pushes to `release`, `staging`, and `main`. CI
does not bind to a deployment environment and receives no runtime secrets.
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

No `NPM_TOKEN` is needed. The workflow authenticates with GitHub OIDC.

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
