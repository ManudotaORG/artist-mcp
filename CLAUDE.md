# artist-mcp

An npm-published MCP server that reads a user's OneNote notes, signing in to
Microsoft and Google on the user's own machine, plus a small web app for sign-in
and the install instructions.

**The build checklist is [docs/mvp-brief.md](docs/mvp-brief.md). Read it before
starting work.** It is the source of truth for scope and for what is actually
done — a ticked box means done *and verified*, and blocked items say why.
Update it as you go rather than at the end.

Scope is deliberately narrow. The workflow layer is defined in
`apps/mcp/agent-pack`: one OneNote page is one working unit, Markdown roles and
project types are loaded at runtime, and every result stays in chat.

**If you find yourself adding writes, sends, or synchronization, stop.** That
rule stands, with two exceptions, and neither is a precedent.

An install granted `--allow-writes calendar-create` may create a single Google
Calendar event, previewed and confirmed, and one granted `calendar-delete` may
remove an event **that this tool itself created**, identified by the `artist`
prefix on its id. An install holding *both* may also reschedule one, which is
those two writes in one confirmed step — a create then a delete, never a
`PATCH`, because the event id is a hash of the event's own contents. An event
the musician made is unreachable, and that prefix check is the only thing
making delete safe to offer. Read
[docs/decisions/0001-opt-in-calendar-writes.md](docs/decisions/0001-opt-in-calendar-writes.md)
before touching that path — it says what was decided, what it cost, and what
would reverse it.

An install granted `onenote-create` may create a new OneNote page, previewed
and confirmed. **It cannot edit or delete any page, including one it created**,
and that is not a rule this repository keeps — the scope is `Notes.Create`,
which cannot express an edit or a delete, verified as a 403 on both against a
page the token had just created itself. This is the inverse of the calendar
situation, where no insert-only scope exists and the boundary had to become our
code. The price is that a created page is permanent as far as this tool is
concerned: there is no undo, and the musician removes it in OneNote themselves.
Read [docs/decisions/0003-onenote-writes.md](docs/decisions/0003-onenote-writes.md)
before touching that path. **Editing an existing page is still out, and is no longer out permanently.**
`Notes.ReadWrite` would indeed hand back edit and delete over every page and put
the boundary in our code again — but it is not the only door.
`Notes.ReadWrite.CreatedByApp` is enforced by Microsoft against *this* app's own
pages, verified as `401` on a page the musician wrote, and under it a
paragraph-level replace is both surgical and recoverable from a pre-image.
[docs/decisions/0004-onenote-page-maintenance.md](docs/decisions/0004-onenote-page-maintenance.md)
accepts that in principle and nothing is built yet.
[0006](docs/decisions/0006-replacing-a-whole-table.md) extends it to tables,
which is where a filled-in page actually keeps its content: OneNote supports no
update to a row or a cell, so the unit is the whole table, written as markup and
previewed as rows. That widens what one confirmed change can destroy, and it
amends `policy:patch`'s smallest-fragment rule rather than quietly breaking it —
read it before touching either. **Deleting stays out.**

Message sending and synchronization remain out, and the reasoning is in the
records rather than restated here.

Sources are read-only apart from those grants, and deliberately few. OneNote
holds the working unit; Gmail and Google Calendar are **supporting evidence
only** — they corroborate or fill gaps in a page and are never themselves a
working unit. That asymmetry
is the whole reason further sources did not dissolve the one-page-one-unit rule
that every role and playbook depends on. Each new source means re-deciding it,
not repeating it: Google Tasks was considered and left out, because a task list
is a rival system of record for the work itself rather than evidence about it.

## Verify on `release`; promote only to ship

Promotion is not a test loop. `pnpm test` runs exactly what CI runs, and
`init --local` runs the same code an npm install would, so almost everything is
checkable on `release` without touching `staging` or `main`. Each promotion round
trip costs two pull requests, four workflow runs, and an npm prerelease that can
never be reused.

Promote only for what cannot be checked locally: the published tarball (after
packaging changes, or before a stable release) and the staging website. Otherwise
batch verified work into one promotion. Full loop in
[docs/development.md](docs/development.md).

## Layout

```
apps/web        Next.js (App Router), Tailwind, shadcn/ui
apps/mcp        MCP server + install CLI, published as @manudota/artist-mcp
supabase/       migrations, and dormant schema from the hosted design
docs/           the brief
```

## Things that bite

- **Notes are OneNote, not OneDrive files.** Scope is `Notes.Read`, plus
  `Notes.Create` behind a grant. The API is `/me/onenote/*`, and pages are
  addressed by id — there is no path. A page is created by POSTing an XHTML
  document, not JSON; sending JSON is answered with a 400 that names neither
  problem.
- **`offline_access` is not optional.** Without it Microsoft returns no refresh
  token and everything dies after an hour.
- **Microsoft rotates refresh tokens.** Every exchange invalidates the old one.
  Miss the write-back and the connection dies silently on the *next* call.
- **There are two custody models, and conflating them is the mistake.** The
  published package holds its own tokens on the user's machine, and nothing
  server-side can read them. The hosted server holds a named user's refresh
  tokens encrypted in `connections`, which a maintainer with the service role
  and the encryption key can decrypt; hosted users are told so before they
  connect. `connections` and `mcp_keys` were dormant while custody sat only on
  user machines and have been live again since #55. This entry used to say
  tokens live on the user's machine "and nowhere else" — true of one model,
  false of the other, and the sentence a contributor reads first. The authority
  is "Hosted credential storage" in [docs/operations.md](docs/operations.md).
- **There is no edge function any more.** `supabase/functions/graph/` served
  installs before 1.0.0, when every operation went through it; 1.0.0 moved that
  onto the user's own machine. It was removed once 0.x stopped mattering, along
  with its tests, its CI job and its `[functions.graph]` config. Hosted users
  are served by `apps/web/src/app/api/mcp/route.ts`, which builds the same
  `createServer` the published package does.

  It said "not deployed" here for a while, which was true of production and not
  of staging, and reading it literally is what sent someone deploying it. The
  entry is kept as a headstone: if you find a reference to that function, it is
  stale.
- **Write grants are a parameter, never state.** `createServer(call, grants)`
  takes them, because one stdio process serves one user while the hosted route
  serves many from one process — a grant held in a module and set per request
  would let one user's capability reach another's session, and would pass every
  test that runs one user at a time. Giving hosted users writes meant deciding
  the hosted case on its own terms, since the local justification rests on
  filesystem permissions on the user's own machine and does not transfer to a
  service holding many people's decryptable tokens. That case has been decided:
  hosted reads its per-user capabilities from `write_grants_for` and passes
  them, so a hosted user who granted them gets the same write tools a local
  install does. Parity is the intent — a feature that ships to one custody
  model ships to both. See #98.
- **`/me/onenote/pages` dies on accounts with many sections.** Graph answers the
  whole request with 400 and error `20266`, so listing goes from working to
  broken with no partial result. Enumerate `/me/onenote/sections` and fetch
  `~/sections/{id}/pages` per section instead. Do not "simplify" it back.
- **Graph explains its 4xx in the response body.** Throw the body away and every
  failure looks identical — the 20266 outage read as an auth or rate-limit
  problem until the body was surfaced.
- **Postgres grants EXECUTE to PUBLIC on new functions.** Revoking from `anon`
  and `authenticated` alone is a no-op — revoke from `PUBLIC`.
- **Google needs a client secret; Microsoft does not.** Google refuses the token
  exchange for a Desktop client without one, and the client types needing none
  cannot use a loopback redirect. It is served from `/api/client-config`, openly,
  and cached with the tokens. Do not "fix" this by publishing it in the package
  or by gating the endpoint — it reaches every user either way, and PKCE is what
  makes it harmless. Re-check with `scripts/spike-pkce.mjs` if a provider changes
  its rules.
- **`apps/web` is a Next.js version with breaking changes** against what you may
  remember. See `apps/web/AGENTS.md`; read `node_modules/next/dist/docs/` before
  writing code there.
- **`apps/mcp` must not import from other workspace packages** — it ships to npm
  standalone.
- **Workflow Markdown is executable policy.** Regenerate
  `agent-pack/registry.json` and verify checksums when it changes. The pack
  describes *what a tool requires*, not what a session must remember to do, so
  that it stays true whether or not an install was granted a write.
- **The operation table in `dispatch.ts` is security code.** Since Google
  publishes no insert-only Calendar scope, the scopes no longer separate
  creating an event from deleting one — that table and the grant check do.
  `test/operation-boundary` fails on any edit to it, deliberately. The OneNote
  rows are the exception that proves the rule: `Notes.Create` separates create
  from edit at the provider, so those rows record a boundary rather than
  keeping one. `WRITE_CAPABILITIES` has the same kind of guard in
  `test/grants` — it did not until #117, so a capability could be added with
  the suite staying green.
- **The hosted write switch grants every capability there is.** One question,
  derived from `WRITE_CAPABILITIES` rather than listed, so it cannot come to
  mean less than its label. The edge is that a new capability is covered by
  consent already given — so **adding one requires a migration clearing
  `write_grants`**, the way `20260828120000_reset_write_grants.sql` does.
  Without it, users find a tool they never agreed to in their list, since
  registration is gated on the grant and not on the token's scope.
- **A rule in a role is not in force.** Roles arrive in the briefing as a
  one-line summary; only project types and the policies in `alwaysInFull` load
  in full. Three bugs came from rules sitting where no session could see them.
  Read "Editing the pack" in
  [docs/releases-and-agents.md](docs/releases-and-agents.md) before touching the
  pack — that one, plus a headline is a rule, a tool description outranks a
  playbook, and extracting a concern means deleting it where it came from in the
  same edit.
- **`init` writes absolute paths into the Claude Desktop entry.** Moving the
  checkout or the playbook directory leaves it launching something that no longer
  exists. Re-run `init` after moving either. `status` now checks what `init`
  wrote and names the missing path, so this surfaces in the terminal rather than
  as a workflow tool failing later on a directory the user has forgotten.
- **A re-run of the editable install adds, and never changes.** An unedited
  playbook in a user's directory has been accepted, not left awaiting updates, so
  refreshing it would silently alter rules in force on a file they own. Tracking
  seed hashes to make that possible was considered and rejected — see
  `docs/releases-and-agents.md`. Deleting a copy and re-running is the explicit
  way back to the shipped version.
- **A local playbook directory must never fall back silently.** An unreachable
  remote registry falls back to the bundle; a broken local directory does not.
  The user said which rules govern their work, and quietly running different
  ones misreports what is in force. See `docs/releases-and-agents.md`.
