# Releases, environments, and artist workflows

## GitHub environments

CI runs for pull requests and pushes to `release` and `main`. Staging receives
only commits already validated on `release`; its npm workflow retests only the
MCP package. Vercel's native Git integration builds the website from `staging`,
so GitHub Actions does not duplicate that build. CI does not bind to a
deployment environment and receives no runtime secrets. Protect `main` and
require the `Lint and build` check before merge.

The production and staging Vercel projects are both connected to this GitHub
repository. Production tracks only `main`, staging tracks only `staging`, and
Preview branch tracking is disabled on both projects.
The production footer shows the checked-in stable package version. The staging
footer resolves the public npm `staging` dist-tag with a one-minute cache so it
shows the exact published prerelease rather than stale branch metadata.

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

Because npm supports one trusted publisher per package, both channels publish
from one branch-aware workflow. In the npm package settings, configure:

- Organization or user: `ManudotaORG`
- Repository: `artist-mcp`
- Workflow filename: `release.yml`
- Environment: leave blank so both branch-gated jobs can exchange OIDC tokens
- Allowed action: `npm publish`

The jobs still use distinct GitHub environments: `main` uses `production` and
publishes `latest`; `staging` uses `staging` and publishes a unique prerelease
to the `staging` dist-tag. The staging version is based on npm `latest`, not a
possibly stale version committed on the staging branch. A successful production
release automatically publishes the next staging prerelease from the staging
branch; ordinary staging pushes do the same. Workflow retries append the run
attempt so npm versions remain immutable. Leave `NPM_STAGING_PUBLISH_ENABLED`
unset until the npm mapping is installed, then set it to `true` in the GitHub
`staging` environment.

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
entry includes a SHA-256 checksum. At runtime the server reads the registry and
Markdown bundled with the installed npm version. This keeps stable, staging,
older, and local package versions isolated from later playbook changes.

Set `ARTIST_MCP_REGISTRY_URL` only when explicitly testing a remote registry.
Remote Markdown paths resolve relative to that registry URL, and failures fall
back to the installed bundle.

## Playbooks a user edits

A user can point the server at a directory of their own:

```bash
npx @manudota/artist-mcp agents edit project-type:concert ~/artist-playbooks
npx @manudota/artist-mcp init --agents ~/artist-playbooks
```

Entries there shadow the bundled pack **by id**, so editing one project type does
not fork the other twelve, and a playbook added by a later package version still
arrives. A file whose id is not in the bundled pack is **added** rather than
shadowing anything, so a user can write their own project types and roles, not
only edit the shipped ones.

Ids come from where a file sits, so the layout is exact:
`.artist/<roles|project-types|policies>/<name>.md`. Anything else — a file loose
in `.artist/`, an invented subdirectory, a nested path — is refused by name.
That fallback used to make such a file a `policy`, which was harmless while the
only inputs were three reviewed directories here and a trap once the directory
belongs to the user: policies other than intake are summarised rather than
returned in full, so a misfiled playbook loaded, appeared in `agents status`, and
was then largely ignored. That reads as the model disregarding the user's rules
rather than as a file in the wrong place. Nesting is refused for a related
reason — two files with one name under different subdirectories derive one id,
and the loser would disappear silently.

A new **project type** is the strongest case: project types are returned in full
before anything is loaded, so it competes for classification immediately. A new
**role** is listed as a name and description and loaded on demand, so it competes
with seven established ones on that line alone; wiring it in reliably means
copying out `ORCHESTRATOR.md` too and naming it there.

`agents edit` copies one file on purpose. `agents install` copies all thirteen,
which is right for handing a coding agent the whole set to read inside a repo,
but as a seed for a local pack it defeats the overlay — every id becomes local,
so nothing tracks the package any more.

`init` records an absolute path in the Claude Desktop entry's own args. It cannot
be discovered at runtime: the server is spawned with no cwd worth trusting. Args
rather than `env` or a hidden state file, so that reading the entry tells you
this machine is running the user's rules. `init` counts the playbooks before it
writes the config, so a mistyped path fails while the user is still in the
terminal instead of surfacing later as every workflow tool failing inside Claude.
`ARTIST_MCP_AGENTS_DIR` does the same thing for development.

Checksums mean something narrower here. Bundled ones prove a file is what was
published; a local file has no such authority to check against, because the user
is the authority — the checksum is derived from the directory as it is read, and
proves only that the file did not change between being listed and being loaded.

Three rules make that safe rather than sloppy:

- A broken or missing local directory **fails loudly**. It does not fall back to
  the bundled pack the way an unreachable remote registry does. Running
  different rules than the user asked for, silently, is the one thing this layer
  must never do.
- `list_agent_workflows` says which entries are the user's own **and names the
  file each one lives in**, so a transcript never presents edited rules as the
  shipped ones, and a request to improve a playbook can be answered with the file
  to change rather than loose prose. `load_agent_workflow` names the file too,
  for a local entry only — a bundled path points inside an npx cache, where an
  edit would work once and vanish on upgrade.

  This is information, not capability. Nothing in the package writes a playbook,
  and that is deliberate rather than unfinished: playbooks are executable policy,
  and note and mail content is attacker-reachable, so a write tool would open a
  path from text in an email to a permanent change in the rules that govern the
  analysis. Editing belongs in a coding agent with file access and a diff you
  review — which is what `agents install` is for.
- Files are capped at 64 KiB each and empty files are refused. Project types and
  the intake policy are returned in full, unasked, so an oversized playbook does
  not fail — it silently spends the context the notes needed.

The read-only boundary does not depend on any of this. It holds because no write
tool exists: an edited playbook can make the analysis worse, but it cannot write
to OneNote, send outreach, or touch a calendar.

`artist-mcp agents status` prints every entry and where it came from.
