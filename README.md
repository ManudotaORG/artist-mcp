# artist-mcp

`artist-mcp` connects a Microsoft account to Claude Desktop or Codex so either
client can list and read the user's OneNote pages through MCP.

One OneNote page is one working unit. A separate, optional Google connection
adds Gmail and Calendar as **supporting evidence** for that page — they
corroborate or fill gaps in it and are never themselves a working unit.
Attachments on an evidence email (PDF, image, Word) can be mapped and read the
same way. Either connection stands alone: connect OneNote, Google, or both, and
disconnecting one leaves the other working.

Reading is the default, and no message is ever sent. Four write capabilities
exist, each granted by name at install time with
`artist-mcp init --allow-writes <capability>`, and each showing the exact change
and waiting for your yes before it goes through:

- `calendar-create` — add a single Google Calendar event.
- `calendar-delete` — remove an event **it created itself**, never one you made
  or one shared onto your calendar. Holding both calendar capabilities also
  allows rescheduling such an event.
- `onenote-create` — add a new page to a section.
- `onenote-edit` — change a page **it created itself**. Microsoft enforces that
  one: the scope cannot reach a page you wrote.

Without the flag the tools are not there at all — a capability you did not grant
registers nothing for a client to call. No page is ever deleted, and nothing is
synced.

The project has three parts:

- `apps/web` — sign-in, the install instructions, an open endpoint serving
  Google's Desktop client secret, and the hosted MCP: a remote server, an OAuth
  authorization server for clients that can only speak OAuth, and the pages
  where a hosted user connects their own accounts.
- `apps/mcp` — the npm-published stdio MCP server. It signs in to Microsoft and
  Google on the user's own machine and keeps the tokens there.
- `supabase` — sign-in, and encrypted credential storage for hosted accounts.

## Where your credentials live

That depends on which of the two you use, and the difference is the whole
point — so it is stated plainly rather than averaged into one reassuring
sentence.

**The published package — on your own machine, and nowhere else.** You sign in
to Microsoft and Google in your browser, and the refresh token stays on the
computer you signed in on. No server here stores it, so no maintainer can reach
your notes or mail. That is a property of the architecture, not a policy we ask
you to trust, and it is what most people should use.

**The hosted server — on our infrastructure, for people who were told so.**
Some clients cannot run a program on your machine; ChatGPT's connectors fetch
from OpenAI's servers, so `localhost` is unreachable. Acting for you while your
machine is off means holding your credentials, and no protocol removes that.
Hosted users see this sentence before they consent:

> Your tokens are stored on our infrastructure so this works while your machine
> is off. A maintainer can technically read what they reach.

Refresh tokens are encrypted at rest with a key the database never holds, and
the functions that decrypt them are reachable only by the service role. That
narrows who can read them; it does not reduce it to nobody, and claiming
otherwise would be the thing this section exists to avoid.

Hosted access is arranged directly with named people. Signup is closed, so
nobody can put themselves in that arrangement, and an installed copy of the
package has no endpoint override — it cannot be pointed at a hosted server even
by misconfiguration. The two custody models cannot be confused for one another
by accident.

The history: an earlier hosted design held every user's refresh token, and
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22) removed it — stored
tokens deleted, credentials pulled from every deployment. What returned in
[#55](https://github.com/ManudotaORG/artist-mcp/issues/55) is not that design
restored to everyone. It is a separate offering, opt-in, disclosed, and closed
by default.

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
- [Operate, publish, and rotate credentials](docs/operations.md)
- [MVP scope, verification record, and remaining roadmap](docs/mvp-brief.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Quick start for users

1. Install the server in Claude Desktop or Codex using the instructions below.
2. Run `connect` and approve `Notes.Read`, `offline_access`, and `User.Read` in
   the browser window that opens.
3. Optionally run `connect google` and approve `gmail.readonly` and
   `calendar.events.readonly`, alongside `calendar.calendarlist.readonly` so the
   calendars can be listed by name. The narrower events scope is deliberate:
   calendar metadata, sharing, and settings are not read.
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

Install the roles and project types into the current project:

```bash
npx @manudota/artist-mcp agents install
```

Use `npx @manudota/artist-mcp@staging agents install` for staging, or
`node apps/mcp/dist/index.js agents install` for the checked-out local build. It
writes into the directory you run it from and refuses your home directory, where
the files would sit unread.

One OneNote page is treated as one working unit, with Gmail and Calendar read as
supporting evidence for it. The playbooks can produce plans, recommendations,
audits, and drafts in chat, and use whichever writes the install was granted —
no more. No message is ever sent.

### Playbooks you can edit

There are two installs and nothing between them. The one above runs the shipped
playbooks, verified by checksum. This one copies all of them somewhere you own,
where every playbook is yours to change:

```bash
npx @manudota/artist-mcp init --editable
```

They land in `~/artist-mcp/artist/`, or a directory you name. Add your own
alongside them — a new file under `project-types/`, `roles/` or `policies/`
becomes available under an id taken from its filename. Re-run the command after
upgrading and it adds playbooks new in that version while leaving your edits
alone.

`artist-mcp agents status [directory]` prints which playbooks are in force and
where each came from. Editing one changes the advice you get; it cannot widen
what the server can do, because a capability the install was not granted
registers no tool, and a playbook cannot call a tool that is not there.

## Local development

Requirements: Node 20 or newer (`engines.node`; `.nvmrc` pins the version this
is developed against), pnpm 11, a Supabase project, and a Microsoft
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
