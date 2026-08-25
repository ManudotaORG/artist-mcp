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
rule stands, with exactly one exception, and the exception is not a precedent:
an install granted `--allow-writes calendar-create` may create a single Google
Calendar event, previewed and confirmed. Read
[docs/decisions/0001-opt-in-calendar-writes.md](docs/decisions/0001-opt-in-calendar-writes.md)
before touching that path — it says what was decided, what it cost, and what
would reverse it. OneNote writes, message sending and synchronization remain
out, and the reasoning for each is there rather than restated here.

Sources are read-only apart from that one grant, and deliberately few. OneNote
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

- **Notes are OneNote, not OneDrive files.** Scope is `Notes.Read`, the API is
  `/me/onenote/*`, and pages are addressed by id — there is no path.
- **`offline_access` is not optional.** Without it Microsoft returns no refresh
  token and everything dies after an hour.
- **Microsoft rotates refresh tokens.** Every exchange invalidates the old one.
  Miss the write-back and the connection dies silently on the *next* call.
- **Tokens live on the user's machine and nowhere else.** No service here stores
  a refresh token or holds a credential that could read one — that is the point
  of #22, not an implementation detail. `connections` and `mcp_keys` remain in
  the schema but are dormant and unwritten; see `docs/operations.md`.
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
  `test/operation-boundary` fails on any edit to it, deliberately.
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
