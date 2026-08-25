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
five policies under `.artist/`. Installation is idempotent. A
differing root `AGENTS.md` is kept; the command explains how to reference
`.artist/` manually. Differing workflow files stop the install before anything
is written.

The roles are Orchestrator, Archivist, Registrar, Project Manager, Envoy,
Auditor, and Janitor. The starter project types are Concert, Large Concert,
Studio Session, and Rehearsal. The policies are Intake, Answering, Evidence,
Divergence, and Local State; every one but Local State is loaded in full at the
start of a session rather than summarised.

One OneNote page is one working unit. The pack can read that page and produce a
recommendation, plan, draft, audit, or cleanup summary in chat. It cannot write
to OneNote, send outreach, edit calendars, or persist project state.

Agents may optionally keep small, disposable working context in
`.artist/local/`, which is gitignored. They choose the smallest useful local
format, but may not store secrets, copy source systems, or turn local files into
claims, queues, locks, reviews, or other coordination infrastructure. The
backend never stores this local state.

## Editing the pack: what a day of testing taught

These come from running the pack against a deliberately messy notebook in Claude
Desktop and fixing what broke. They are cheap to forget and expensive to
rediscover.

**A rule in a role is not in force.** The briefing loads project types and the
policies listed in `alwaysInFull` in full; every role arrives as a one-line
summary until something loads it. Three separate bugs came from this — the
evidence boundary sat in `AGENTS.md`, which the server never loads, and a
session read the user's mailbox unasked; the Project Manager's rule against
pooling disputed milestones sat in its role file, and a due list stated one
page's date as fact. If a rule has to hold whether or not anyone reached for a
role, it belongs in a policy.

Test it the way those were found. Ask the server for the briefing and grep for
the sentence:

```bash
node dist/index.js --agents <pack> # or drive list_agent_workflows over stdio
```

**A tool description outranks a playbook.** `list_events` described the calendar
as corroborating "what a page claims about a date", and a model facing two pages
that disagreed about a date read that as an instruction. The policy forbidding
it was loaded and lost. Where a constraint governs when a tool may be called,
put it in the tool's own description — that is what the model reads at the
moment it decides.

**A headline is a rule.** Four self-contradictions surfaced in one day, each the
same shape: a purpose promising what the method forbids. The Janitor claimed
cross-page work its method could not do; `policy:divergence` said "let the
musician decide which page is the project" seventy lines above the rule against
exactly that; `policy:answering` said to answer in chat first while
`policy:intake` said templates are handed over as files. In every case the model
followed the headline, which is the reasonable thing to do. The first paragraph
is also what the registry uses as the entry's description, so it is read more
often than the body.

**Prohibiting a phrase moves it, it does not remove it.** Six rounds of banning
winner-picking vocabulary produced six synonyms: `stale`, then `the losing
page`, then `which version wins`, then `the survivors`. The first thing that
changed the behaviour was giving a sentence to say instead. Prefer one worked
example over three prohibitions.

**Extract a concern, then delete it where it came from — in the same edit.**
`INTAKE.md` originally carried everything. Pulling answering, evidence and
divergence out of it without removing the originals left it restating all three,
and left one rule directly contradicting its replacement. Every duplication
found in a later cleanup was a refactor that stopped halfway. Grep the other
policies for the subject before adding a rule.

**Do not tune against adversarial data.** The test notebook held planted
duplicates, a misspelt title and a half-edited copy-paste. That is a worst case
and it is useful for finding edge cases, but a wide prompt against it puts
maximum pressure on the model to summarise and conclude — the conditions that
produce winner-picking. Most of the phrasing churn came from treating variance
under those conditions as a defect. The documented workflow is narrow prompts,
one step at a time, and it behaved better.

**Check the editable pack before you trust a green test run.** Working against
`init --editable` means two copies of every playbook, and the direction of an
edit is easy to lose: a change made in the user's directory runs correctly for
them and ships to nobody, because `registry.json` and its checksums are
generated from the bundle while a local pack is checksummed from the directory
as it is read. `pnpm --filter @manudota/artist-mcp check-pack <dir>` names
anything that differs, exists only locally, or is missing. Divergence is the
normal state of an editable pack, so it reports rather than fails — which side
is right is not something a script can know.

**Watch the size of what loads.** Every policy in `alwaysInFull` is paid for at
the start of every session. The briefing went from 13k to 37k characters in a
day, and a third of that growth was one rule written in several places. A rule
earns its place by naming a failure it prevents; where two rules prevent the
same failure, merge them.

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
npx @manudota/artist-mcp init --editable [directory]   # default ~/artist-mcp
```

Entries there shadow the bundled pack **by id**, so editing one project type does
not fork the other twelve, and a playbook added by a later package version still
arrives. A file whose id is not in the bundled pack is **added** rather than
shadowing anything, so a user can write their own project types and roles, not
only edit the shipped ones.

Ids come from where a file sits, so the layout is exact:
`<.artist|artist>/<roles|project-types|policies>/<name>.md`.

The container may be hidden or visible, and that is not cosmetic. `.artist/` is
right inside a repository, where it sits beside `AGENTS.md` as tool configuration
and the policies refer to `.artist/local/`. It is wrong for a standalone
directory the user keeps their playbooks in and opens in a file browser: the
folder they were told to edit appears to be empty. So the editable install seeds a
fresh directory with the visible `artist/`, keeps `.artist/` on any directory that
already has one — writing the other name beside it would split the pack in two —
and `agents install`, which targets a repository, is unchanged. Both containers
present at once is refused rather than merged, since a playbook the user thought
they had replaced would sit in the copy that lost.

Anything else — a file loose
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

There are two installs and no middle setting. The default runs the shipped,
checksummed pack. `--editable` copies all of it into a directory the user owns,
where every playbook is theirs.

Per-file opt-in was tried first and removed. It kept most ids tracking the
package, but only by making the user remember which files were theirs and which
were not, and that bookkeeping is the tool's job. The reason it existed — that a
full copy stops a later version's improvements arriving — is answered instead by
the install being re-runnable: run it again after an upgrade and playbooks new in
that version are added, anything edited is left alone, and the summary says which
files were treated as the user's. Nothing is ever overwritten, because a file
that differs cannot be told apart from a deliberate edit.

**A file the user has *not* edited is not refreshed either, and that is the
decision rather than a limitation.** Recording the shipped hash each file was
seeded from would make it possible: untouched files could then track later
versions while edited ones stayed put. It was considered and rejected.

Choosing the editable install is choosing to own the pack. An unedited file in
that directory has been read and accepted, not left in a queue awaiting updates —
a musician may simply be content with it. Refreshing it on their behalf would
change rules that are in force, silently, on a file they own, which is the one
thing this layer must never do; the same principle already forbids a broken local
directory falling back to the bundle. Adding an id the user has never seen is a
different act from rewriting one they have.

So the contract is narrow and worth stating plainly: **a re-run adds, and never
changes.** A user who does want the shipped version of a playbook back can delete
their copy and re-run, which is explicit and theirs to choose.

`agents install` still copies the pack into a repository for a coding agent to
read, which is a different job and unchanged.

Both refuse the home directory. `agents install` defaults to the working
directory, which is right in a project and ruinous in `~`: run there once and
`AGENTS.md` and `.artist/` sit in the home folder, unread, until someone notices.
The default editable directory is `~/artist-mcp`, a folder of its own beside the
hidden `~/.artist-mcp` holding the tokens — one the user opens and edits, one
they never touch.

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

The boundary does not depend on any of this. An edited playbook can make the
analysis worse, but it cannot write to OneNote, send outreach, or reach a tool
this install was not granted: a write tool that was not granted is never
registered, so there is nothing for a playbook to invoke. What a playbook cannot
do is widen what an install may change.

`artist-mcp agents status` prints every entry and where it came from.
