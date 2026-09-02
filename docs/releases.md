# Releases and environments

How a change gets from `release` to a user, and what to do when a step of that
fails. The agent pack has its own guide in [agent-pack.md](agent-pack.md); the
services a release deploys into are in [operations.md](operations.md).

## Channels

The npm package has two branch-backed channels, and the website has two Vercel
projects tracking the same branches:

| Branch | npm dist-tag | Website |
| --- | --- | --- |
| `staging` | `staging`, a unique prerelease such as `0.1.1-staging.123` | `artist-mcp-staging` |
| `main` | `latest`, managed by Release Please | `artist-mcp` |

`release` publishes and deploys nothing. Preview branch tracking is disabled on
both Vercel projects, so `release` and pull requests create no deployment, and
GitHub Actions never builds or deploys the website — Vercel's own Git
integration does.

The production footer shows the checked-in stable package version. The staging
footer resolves the public npm `staging` dist-tag with a one-minute cache, so it
shows the prerelease actually published rather than stale branch metadata.

## Verify on `release`. Do not promote in order to test

Promotion is for shipping. Used as a test loop it is expensive in Actions
minutes and in attention: each round trip is two pull requests, four workflow
runs, and a published npm prerelease that can never be reused. Since 1.0.x
shipped there is also a real cost to churning the staging dist-tag.

Cheapest sufficient check first:

1. `pnpm test` — lint, both test suites, and every build. CI runs this, so a
   pass here means a pass there. The one thing it does not cover is Commitlint,
   which runs only on pull requests.
2. The CLI directly, against the built output:
   `node apps/mcp/dist/index.js agents status ~/artist-mcp`. Most behaviour is
   observable here without a client at all.
3. Claude Desktop on the local build, when the behaviour needs a model to
   exercise it: `pnpm --filter @manudota/artist-mcp build` then
   `node apps/mcp/dist/index.js init --local` (add `--editable` to keep an
   editable pack registered). This runs the same code an npm install would.

Restart rules for that third loop are not symmetrical. A **code** change needs
Claude Desktop fully quit and reopened, because the server process loaded its
modules at spawn. A **playbook** edit needs nothing — the directory is re-read
on every tool call — but a conversation already holding a `list_agent_workflows`
result will not notice a playbook added mid-conversation, so start a new one.

Promote only for what cannot be checked locally:

- **The published artifact** — that `dist/` and `agent-pack/` arrive in the
  tarball, that `npx` resolves and runs it. Worth doing after packaging changes
  (`files`, build order, dependencies, the publish workflow) and before a stable
  release. Verify with `npm pack @manudota/artist-mcp@staging` and by running the
  published binary, not by reading a workflow log.
- **The staging website**, for `apps/web` changes.

Otherwise batch several verified changes into one promotion.

### Staying on the local build

Since 1.0.x shipped, the normal state is to sit on `release` for days with
Claude Desktop pointed at this checkout. Register it once:

```bash
pnpm --filter @manudota/artist-mcp build
node apps/mcp/dist/index.js init --local --editable
```

To go back to what users have, and to return:

```bash
npx @manudota/artist-mcp init --editable               # published, npm latest
node apps/mcp/dist/index.js init --local --editable    # back to this checkout
```

To see which is registered right now, read the entry rather than guessing — a
local one names an absolute path into this repository:

```bash
node -e "const {configPath,readConfig}=await import('./apps/mcp/dist/config.js');
console.log((await readConfig(configPath())).mcpServers['artist-notes'].args.join(' '))"
```

**`init` records absolute paths, so moving anything breaks the entry.** Renaming
the playbook directory or moving the checkout leaves Claude Desktop launching a
path that no longer exists. Re-run `init` after moving either. This is not
hypothetical: renaming `~/artist-playbooks` to `~/artist-mcp` left every workflow
tool in a working Desktop failing for exactly that reason, with nothing saying
why — which is what `status` checking the install was built for. It now names the
missing path in the terminal instead.

**Sync the release bump immediately after a release, not before the next
promotion.** Release Please bumps the version on `main` only, so until `main` is
merged back, every local build on `release` reports the previous version — while
testing, on the branch, which is precisely when the version has to be
trustworthy.

## Promoting

- Develop and commit on `release` using Conventional Commits. Push early;
  CI runs lint, tests and builds there.
- Promote a verified snapshot with a `release` → `staging` pull request, then,
  after staging verification, the same snapshot with `release` → `main`.
- Never promote by pushing a branch directly. `staging` and `main` both require
  the `Lint and build` check with `enforce_admins`, so a direct push is rejected
  — and Commitlint runs only on `pull_request`, so a push that did land would
  skip it entirely.
- Pull-request CI runs only when the target is `staging` or `main`. A pull
  request against `release` is not checked at all.

**Expect `BEHIND` on every promotion, not just at releases.** Both protected
branches are `strict`, so a pull request must be up to date before it merges,
and `release` always trails. Two separate causes: merging a promotion creates a
merge commit on the target that `release` does not have, and Release Please
additionally bumps `package.json` and `src/server.ts` on `main` only. Either way
the next promotion is refused. Merge `origin/main` into `release` first — a
`chore: sync ...` commit — then push and retry.

Dependabot opens grouped weekly npm and Actions updates against `staging`, where
PR CI runs without creating a Vercel preview. After merging one, synchronize
that commit into `release` before the next production promotion so branch
history stays aligned. Automatic major-version PRs are disabled; handle breaking
upgrades as planned migration work.

## Publishing

Release Please owns production versioning and tracks `apps/mcp`. Conventional
commits merged to `main` update its release pull request; merging that creates
the GitHub release, and `.github/workflows/release.yml` publishes through npm
trusted publishing and GitHub OIDC. Manual runs update or inspect Release Please
state but never republish an existing stable version.

Because npm supports one trusted publisher per package, both channels publish
from one branch-aware workflow. In the npm package settings:

- Organization or user: `ManudotaORG`
- Repository: `artist-mcp`
- Workflow filename: `release.yml`
- Environment: leave **blank**, so both branch-gated jobs can exchange OIDC tokens
- Allowed action: `npm publish`

The jobs themselves bind to distinct GitHub environments: `main` uses
`production` and publishes `latest`; `staging` uses `staging` and publishes the
prerelease. The staging version is based on npm `latest` rather than a possibly
stale version committed on the branch, so releasing `0.5.0` advances staging to
`0.5.1-staging.<run>` with no manual metadata-sync push. A successful stable
publication runs the staging job too; ordinary staging pushes do the same.
Retried runs append the attempt number, so versions stay immutable.

`NPM_STAGING_PUBLISH_ENABLED` gates the staging publish step. It is `true` in
the GitHub `staging` environment and has been since 11 August 2026, once npm
had the exact mapping above. Unset, the job verifies the package and skips the
publish — the state to return to if the trusted-publisher mapping ever breaks.
That job runs the MCP package tests only; website validation belongs to CI, and
Vercel performs the deployment build.

No `NPM_TOKEN` is needed, and **nothing is ever published from a laptop.**

### Before merging the release pull request

From a clean worktree:

```bash
pnpm build
pnpm lint
pnpm --filter @manudota/artist-mcp pack
```

Inspect the tarball. It must ship only `dist` and `agent-pack`, keep the
executable shebang, target Node 20 or newer, and publish publicly.

### After publishing

From a clean temporary directory:

```bash
npx @manudota/artist-mcp init
npx @manudota/artist-mcp agents install
```

Then verify the tools with a real client: `list_notes`, `map_notes` and
`read_note` against OneNote, `map_page_attachment` and `read_page_attachment`
against a page with a file on it, `list_emails`, `read_email`,
`map_gmail_attachment`, `read_gmail_attachment`, `list_calendars`, `list_events`
and `read_event` against Google, and `list_agent_workflows` and
`load_agent_workflow` against the pack. Where the build under test holds write
capabilities, exercise each preview and its committing tool as well.

Registry and playbook content come from the installed npm package by default,
preserving the version the user selected. `ARTIST_MCP_REGISTRY_URL` is a
development override, not a publishing-job or end-user requirement.

### When publishing fails

**The Release Please pull request needs its CI approved by hand, every time.**
GitHub does not run workflows for a bot's pull request without a maintainer
approving them, so CI sits at `action_required` and reports no checks at all.
`main` requires `Lint and build` with `enforce_admins`, so the release pull
request is unmergeable until that run is approved — and it looks merely slow
rather than blocked. Approve it from the Actions tab, or:

```bash
gh run list --branch release-please--branches--main--components--artist-mcp --limit 1
gh api -X POST repos/ManudotaORG/artist-mcp/actions/runs/<id>/approve
```

This is a repository Actions setting rather than anything in the workflow, so it
can be removed rather than lived with.

**A failed publish is retried by re-running the job.** `1.2.0`'s follow-on
staging prerelease died at the registry with `TLOG_CREATE_ENTRY_ERROR` — a
Sigstore transparency-log 409 on a duplicate signing entry — after building a
correct tarball. `gh run rerun <id> --failed` published it as
`1.2.1-staging.58.2`: the attempt number is appended, so a retry mints a new
immutable version instead of colliding. Confirm a publish against the registry
(`npm view @manudota/artist-mcp dist-tags`) rather than the workflow log, since
the build can succeed and the publish still fail.

**An npm `404` during an OIDC publish** usually means the trusted publisher does
not exactly match the repository or workflow filename above. It does not mean
the tarball is missing.

## Production patch notes

Stable releases announce themselves through Telegram after the npm publication
succeeds. The formatter groups Release Please notes, removes duplicate bullets,
escapes Telegram HTML, and splits messages below the length limit. Staging
snapshots never send patch notes.

Create a bot with BotFather, add it to the destination chat, and store
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the GitHub `production`
environment. Then set `TELEGRAM_PATCH_NOTES_ENABLED=true` there. Leave it unset
while configuring the bot, so releases cannot fail or send partial messages.

To resend an existing release, run the **Send production patch notes** workflow
with its tag; it does not republish npm. The implementation is
`scripts/format-release-notes.mjs` and `scripts/publish-release-notes.sh`, and
the root test suite covers the formatter.
