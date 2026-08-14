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
- `supabase` — sign-in, and dormant schema from the previous hosted design.

## Where your credentials live

On your own machine, and nowhere else. You sign in to Microsoft and Google in
your browser, and the refresh token stays on the computer you signed in on. No
server here stores it, so no maintainer can reach your notes or mail — that is a
property of the architecture, not a policy we ask you to trust.

This replaced a hosted design in which the service held every user's refresh
token, and anyone with the production database credential could technically read
any connected account. That is resolved in
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22): the stored tokens
were deleted and the credentials that could read them removed from every
deployment.

The honest remaining limit: the token is a file readable by your own user
account (`~/.artist-mcp/tokens.json`, mode `0600`), not an entry in the OS
keychain — that would need a native dependency the package cannot take, since it
must install without a compiler. Anything already running as you can therefore
use it. Reading your notes takes code on your specific machine, rather than a
query anyone could run from anywhere, against every user, in silence.

Gmail and Calendar are narrower in practice for now: `gmail.readonly` is a
restricted scope, so until Google's verification review completes, only accounts
on the OAuth test-user list can consent at all.

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

1. Install the server in Claude Desktop or Codex using the instructions below.
2. Run `connect` and approve `Notes.Read`, `offline_access`, and `User.Read` in
   the browser window that opens.
3. Optionally run `connect google` and approve `gmail.readonly` and
   `calendar.events.readonly`. The narrower events scope is deliberate: calendar
   metadata, sharing, and settings are not read.
4. Restart the client and ask: **“List my OneNote notes.”**

### Claude Desktop

Production:

```bash
npx @manudota/artist-mcp init
npx @manudota/artist-mcp connect
```

Then restart Claude Desktop.

Staging:

```bash
npx @manudota/artist-mcp@staging init
npx @manudota/artist-mcp@staging connect
```

Local source, from the repository root:

```bash
pnpm --filter @manudota/artist-mcp build
node apps/mcp/dist/index.js init --local
node apps/mcp/dist/index.js connect
```

`--local` registers the absolute built entry point, so Claude Desktop continues
to use this checkout after restart.

### Codex

Production:

```bash
codex mcp add artist-notes -- npx -y @manudota/artist-mcp
npx @manudota/artist-mcp connect
```

Restart Codex after adding the server. See the
[complete installation guide](docs/installation.md) for verification,
troubleshooting, reconnecting, and uninstall instructions.

For staging, replace the final package with
`npx -y @manudota/artist-mcp@staging`. For local source, build first and use:

```bash
pnpm --filter @manudota/artist-mcp build
codex mcp add artist-notes -- node "$PWD/apps/mcp/dist/index.js"
node apps/mcp/dist/index.js connect
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

### Playbooks you can edit

There are two installs and nothing between them. The one above runs the shipped
playbooks, verified by checksum. This one copies all of them somewhere you own,
where every playbook is yours to change:

```bash
npx @manudota/artist-mcp init --editable
```

They land in `~/artist-playbooks/artist/`, or a directory you name. Add your own
alongside them — a new file under `project-types/`, `roles/` or `policies/`
becomes available under an id taken from its filename. Re-run the command after
upgrading and it adds playbooks new in that version while leaving your edits
alone.

`artist-mcp agents status [directory]` prints which playbooks are in force and
where each came from. Editing one changes the advice you get; it cannot widen what
the server can do, because no tool exists that writes to OneNote, sends mail, or
changes a calendar.

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
