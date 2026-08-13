# artist-mcp

`artist-mcp` connects a Microsoft account to Claude Desktop or Codex so either
client can list and read the user's OneNote pages through MCP.

One OneNote page is one working unit. A separate, optional Google connection
adds read-only Gmail and Calendar as **supporting evidence** for that page —
they corroborate or fill gaps in it and are never themselves a working unit.
Attachments on an evidence email (PDF, image, Word) can be mapped and read the
same way. Either connection stands alone: connect OneNote, Google, or both, and
disconnecting one leaves the other working.

Everything is read-only. No writes to any source, no sending, no sync.

The project has three parts:

- `apps/web` — sign-in, Microsoft and Google OAuth, and connection-key management.
- `apps/mcp` — the npm-published stdio MCP server.
- `supabase` — encrypted connection storage and the Microsoft Graph and Google
  API proxy.

## Before you connect an account

**Anyone holding the production Supabase service-role credential can technically
reach the OneNote data of any connected account.** If you connect an account,
assume a maintainer is able to read what it exposes.

This is a property of the design rather than a defect. The edge function
resolves your connection key to your stored credential and refreshes it while
you are away — that is what lets an installed MCP work without you present, and
it necessarily means the service role can act for any user. Encryption at rest
protects a stolen database dump; it is not a control against a live service-role
credential and has never been claimed as one. What bounds this today is policy
and audit, not cryptography.

Gmail and Calendar are narrower in practice for now: `gmail.readonly` is a
restricted scope, so until Google's verification review completes, only accounts
on the OAuth test-user list can consent at all.

We are working on it, tracked in
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22). The near-term work is
moving local development off production credentials, adding an append-only audit
of connection-key creation, and reviewing who holds production credentials.
Beyond that we are investigating whether the npm package can complete OAuth
itself as a public PKCE client, keeping the token on your machine — that would
turn operator reach from a silent database query into something that requires
shipping code you can diff against this repository.

Until then: do not connect an account whose contents you would not want a
maintainer to be able to read.

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
- [Final two-user acceptance test](docs/two-user-acceptance.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Quick start for users

1. Open the web app and sign in by email.
2. Connect Microsoft and approve `Notes.Read`, `offline_access`, and `User.Read`.
3. Optionally connect Google and approve `gmail.readonly` and
   `calendar.events.readonly`. The narrower events scope is deliberate: calendar
   metadata, sharing, and settings are not read.
4. Generate a connection key. It is shown once.
5. Install the server in Claude Desktop or Codex using the instructions below.
6. Restart the client and ask: **“List my OneNote notes.”**

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

One OneNote page is treated as one working unit, with Gmail and Calendar read as
supporting evidence for it. The playbooks can produce plans, recommendations,
audits, and drafts in chat; they cannot write to OneNote, send mail, or touch a
calendar.

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
