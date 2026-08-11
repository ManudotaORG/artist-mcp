# artist-mcp

A multi-tenant web app where a user connects their Microsoft account, plus an
npm-published MCP server that then reads that user's OneNote notes.

**The build checklist is [docs/mvp-brief.md](docs/mvp-brief.md). Read it before
starting work.** It is the source of truth for scope and for what is actually
done — a ticked box means done *and verified*, and blocked items say why.
Update it as you go rather than at the end.

Scope is deliberately narrow. The read-only workflow layer is defined in
`apps/mcp/agent-pack`: one OneNote page is one working unit, Markdown roles and
project types are loaded at runtime, and every result stays in chat. If you find
yourself adding writes, sends, synchronization, or another data source, stop.

## Layout

```
apps/web        Next.js (App Router), Tailwind, shadcn/ui
apps/mcp        MCP server + install CLI, published as @manudota/artist-mcp
supabase/       migrations and edge functions
docs/           the brief
```

## Things that bite

- **Notes are OneNote, not OneDrive files.** Scope is `Notes.Read`, the API is
  `/me/onenote/*`, and pages are addressed by id — there is no path.
- **`offline_access` is not optional.** Without it Microsoft returns no refresh
  token and everything dies after an hour.
- **Microsoft rotates refresh tokens.** Every exchange invalidates the old one.
  Miss the write-back and the connection dies silently on the *next* call.
- **`/v1/` of the edge function is a public contract.** Installed copies upgrade
  on their own schedule and keep calling it. Add `/v2/`, don't change the shape.
- **Postgres grants EXECUTE to PUBLIC on new functions.** Revoking from `anon`
  and `authenticated` alone is a no-op — revoke from `PUBLIC`.
- **Edge functions verify a Supabase JWT by default.** Callers here present a
  connection key instead, so `verify_jwt = false` is set in `config.toml`.
- **`apps/web` is a Next.js version with breaking changes** against what you may
  remember. See `apps/web/AGENTS.md`; read `node_modules/next/dist/docs/` before
  writing code there.
- **`apps/mcp` must not import from other workspace packages** — it ships to npm
  standalone.
- **Workflow Markdown is executable policy.** Preserve the read-only boundary,
  regenerate `agent-pack/registry.json`, and verify checksums when it changes.
