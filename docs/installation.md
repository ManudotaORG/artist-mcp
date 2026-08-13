# Installation guide

This guide connects OneNote to Claude Desktop or Codex through `artist-mcp`.
Setup normally takes a few minutes.

## What you need

- Node.js 20 or newer. Check with `node --version`.
- A Microsoft account with OneNote pages.
- Claude Desktop or Codex installed.
- Access to the `artist-mcp` web app.

## 1. Connect Microsoft

1. Open the web app.
2. Sign in using the email magic link.
3. Select **Connect Microsoft**.
4. Sign into the Microsoft account that owns or can access the required OneNote
   pages.
5. Approve the requested delegated permissions:
   - `Notes.Read` — read OneNote notebooks and pages.
   - `offline_access` — keep the connection working after the access token
     expires.
   - `User.Read` — identify the connected Microsoft account.

The browser returns to the web app with **Microsoft connected** when the flow
succeeds.

## 2. Generate a connection key

Select **Generate key** in the web app and copy the value immediately. The
plaintext key is shown once; the database stores only its SHA-256 hash.

Treat the key like a password. Do not paste it into chat, email, issue reports,
source code, screenshots, or shell history. Generating a new key invalidates the
previous key and disconnects any client using it.

## 3. Install in a client

Choose the channel that matches the website you used:

| Website | Package command |
| --- | --- |
| <https://artist-mcp.vercel.app> | `@manudota/artist-mcp` |
| <https://artist-mcp-staging.vercel.app> | `@manudota/artist-mcp@staging` |
| <http://localhost:3000> from this checkout | `node apps/mcp/dist/index.js` |

The examples below use production. On staging, add `@staging` to every npm
package reference. Maintainers running local source should first run
`pnpm --filter @manudota/artist-mcp build`; Claude Desktop can then use
`node apps/mcp/dist/index.js init --local`, while Codex can register the
absolute `$PWD/apps/mcp/dist/index.js` path.

### Claude Desktop

Run:

```bash
npx @manudota/artist-mcp init
```

Paste the connection key at the prompt. The installer verifies it before
editing the Claude Desktop configuration and preserves other MCP servers.
Restart Claude Desktop after installation.

Configuration locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Codex

Use a hidden terminal prompt so the key is not written directly into shell
history:

```bash
read -s ARTIST_MCP_KEY
codex mcp add artist-notes --env ARTIST_MCP_KEY="$ARTIST_MCP_KEY" -- npx -y @manudota/artist-mcp
unset ARTIST_MCP_KEY
```

Press Enter after typing the key, then restart Codex. Confirm the registration
with:

```bash
codex mcp get artist-notes
```

Codex stores MCP configuration in its normal user configuration. The command
above uses the supported `codex mcp add` interface instead of requiring a manual
edit.

## 4. Verify the connection

Ask the client:

> List my OneNote notes.

Then choose a returned page and ask:

> Read the note titled “Test”.

The MCP server exposes eight read-only tools.

OneNote holds the working unit:

- `list_notes` — returns page titles, section names, modification dates, and
  OneNote page IDs.
- `read_note` — accepts a page ID returned by `list_notes` and returns readable
  page text.

Google is supporting evidence for a page, never a working unit of its own, and
needs a separate Google connection:

- `list_emails` — searches Gmail with its own query syntax and returns subject,
  sender, date, and snippet.
- `read_email` — accepts an id from `list_emails` and returns the message body.
- `list_events` — lists Google Calendar events in a time window, with recurring
  occurrences expanded and flagged.
- `read_event` — accepts an id from `list_events` and returns description and
  attendees.

The workflow pack:

- `list_agent_workflows` — lists the available artist roles and project types.
- `load_agent_workflow` — loads one checksummed Markdown playbook.

The local MCP process never receives a Microsoft or Google access token, or a
Supabase service key. It sends only the connection key and an allowed operation to the
hosted Edge Function.

## 5. Install the workflow files in a project

This optional command installs the same bundled roles and project types where
Claude or Codex can inspect them directly:

```bash
npx @manudota/artist-mcp agents install
```

The installer preserves a differing root `AGENTS.md` and stops before changing
any differing workflow file. One OneNote page remains one working unit, and all
outputs remain in chat.

## Replace or revoke a key

- **Generate new key** replaces the active key. Reinstall or update every client
  that should continue working.
- **Revoke** disables the active key immediately without deleting the stored
  Microsoft connection.
- **Reconnect** repeats Microsoft consent and replaces the stored refresh token.

## Uninstall

### Claude Desktop

```bash
npx @manudota/artist-mcp uninstall
```

Restart Claude Desktop afterward. The command removes only the `artist-notes`
entry and preserves other MCP servers.

### Codex

```bash
codex mcp remove artist-notes
```

Restart Codex afterward.

## Troubleshooting

### Microsoft sign-in loops at “Trying to sign you in”

Return to the web app and start **Connect Microsoft** again. The app requests a
fresh login so a broken cached Microsoft session is not reused. Complete the
flow in one browser tab. If an organization policy still blocks the account,
try a personal Microsoft account or ask the tenant administrator about
Conditional Access.

### Invalid OAuth state

Close old Microsoft consent tabs and restart the connection from the web app.
Do not reuse an old Microsoft callback or `reprocess` URL, and do not switch
browsers midway through the flow.

### Reconnect needed

The connection key is invalid, revoked, or tied to a connection whose Microsoft
refresh failed. Reconnect Microsoft, generate a new key, and install that key in
the affected client.

### Microsoft Graph returns 500, 503, or 504

OneNote endpoints can fail transiently. Retry the request after a short pause.
The Edge Function already retries rate limits and server errors before returning
an error.

### The client cannot find `artist-notes`

Restart the client; MCP configuration is loaded at startup. For Codex, run
`codex mcp get artist-notes`. For Claude Desktop, rerun the installer with the
same active key.

### `npx` or Node is missing

Install Node.js 20 or newer, open a new terminal, and verify `node --version`
and `npx --version` before retrying.

## Security notes

- The connection key grants read access to the connected user's OneNote pages.
- Microsoft refresh tokens are encrypted in Postgres.
- Refresh tokens are rotated and written back on every Graph operation.
- The browser never receives Microsoft tokens.
- The MCP package never receives database credentials.
- Report vulnerabilities using [SECURITY.md](../SECURITY.md), not a public issue.
