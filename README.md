# artist-mcp

`artist-mcp` connects a Microsoft account to Claude Desktop or Codex so either
client can list and read the user's OneNote pages through MCP.

The project has three parts:

- `apps/web` — sign-in, Microsoft OAuth, and connection-key management.
- `apps/mcp` — the npm-published stdio MCP server.
- `supabase` — encrypted connection storage and the Microsoft Graph proxy.

## Live environments

| Environment | Website | MCP source |
| --- | --- | --- |
| Local | <http://localhost:3000> | Checked-out build under `apps/mcp/dist` |
| Staging | <https://artist-mcp-staging.vercel.app> | `@manudota/artist-mcp@staging` |
| Production | <https://artist-mcp.vercel.app> | `@manudota/artist-mcp` (`latest`) |

- Repository: <https://github.com/ManudotaORG/artist-mcp>
- npm package: <https://www.npmjs.com/package/@manudota/artist-mcp>
- Releases and patch notes: <https://github.com/ManudotaORG/artist-mcp/releases>

## Documentation

- [Install for Claude Desktop or Codex](docs/installation.md)
- [Run and develop the project locally](docs/development.md)
- [Infrastructure and maintainer handoff for Manu](docs/manu-handoff.md)
- [Operate, publish, and rotate credentials](docs/operations.md)
- [MVP scope, verification record, and remaining roadmap](docs/mvp-brief.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Quick start for users

1. Open the web app and sign in by email.
2. Connect Microsoft and approve `Notes.Read`, `offline_access`, and `User.Read`.
3. Generate a connection key. It is shown once.
4. Install the server in Claude Desktop or Codex using the instructions below.
5. Restart the client and ask: **“List my OneNote notes.”**

### Claude Desktop

Production:

```bash
npx @manudota/artist-mcp init
```

Paste the connection key when prompted, then restart Claude Desktop.

Staging:

```bash
npx @manudota/artist-mcp@staging init
```

Local source, from the repository root:

```bash
pnpm --filter @manudota/artist-mcp build
node apps/mcp/dist/index.js init --local
```

`--local` registers the absolute built entry point, so Claude Desktop continues
to use this checkout after restart.

### Codex

Production:

```bash
read -s ARTIST_MCP_KEY
codex mcp add artist-notes --env ARTIST_MCP_KEY="$ARTIST_MCP_KEY" -- npx -y @manudota/artist-mcp
unset ARTIST_MCP_KEY
```

Restart Codex after adding the server. See the
[complete installation guide](docs/installation.md) for verification,
troubleshooting, key replacement, and uninstall instructions.

For staging, replace the final package with
`npx -y @manudota/artist-mcp@staging`. For local source, build first and use:

```bash
pnpm --filter @manudota/artist-mcp build
read -s ARTIST_MCP_KEY
codex mcp add artist-notes \
  --env ARTIST_MCP_KEY="$ARTIST_MCP_KEY" \
  -- node "$PWD/apps/mcp/dist/index.js"
unset ARTIST_MCP_KEY
```

### Artist workflow pack

Install the read-only roles and project types into the current project:

```bash
npx @manudota/artist-mcp agents install
```

Use `npx @manudota/artist-mcp@staging agents install` for staging, or
`node apps/mcp/dist/index.js agents install` for the checked-out local build.

One OneNote page is treated as one working unit. The playbooks can produce
plans, recommendations, audits, and drafts in chat; they cannot write to
OneNote or send anything.

## Local development

Requirements: Node 20 or newer, pnpm 11, a Supabase project, and a Microsoft
Entra app registration.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The environment file must
be completed before the authenticated flow can run. Never commit `.env.local`.

## Commands

```bash
pnpm dev      # run the web app
pnpm build    # production build for every workspace
pnpm lint     # lint every workspace that defines a lint task
```

## License

MIT — see [LICENCE.md](LICENCE.md).
