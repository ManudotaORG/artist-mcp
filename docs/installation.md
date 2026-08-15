# Installation guide

This guide connects OneNote to Claude Desktop or Codex through `artist-mcp`.
Setup normally takes a few minutes.

## What you need

- Node.js 20 or newer. Check with `node --version`.
- A Microsoft account with OneNote pages.
- Claude Desktop or Codex installed.
- A browser, for the sign-in step.

## 1. Install in a client

Channels:

| Channel | Package command |
| --- | --- |
| Production | `@manudota/artist-mcp` |
| Staging | `@manudota/artist-mcp@staging` |
| Local source from this checkout | `node apps/mcp/dist/index.js` |

The examples below use production. On staging, add `@staging` to every npm
package reference. `init` records the tag it was run from, so a staging install
stays on staging across restarts and prints which environment it registered. Maintainers running local source should first run
`pnpm --filter @manudota/artist-mcp build`; Claude Desktop can then use
`node apps/mcp/dist/index.js init --local`, while Codex can register the
absolute `$PWD/apps/mcp/dist/index.js` path.

### Claude Desktop

Run:

```bash
npx @manudota/artist-mcp init
```

This registers the server and preserves any other MCP servers already
configured. It writes no credentials — the entry contains a command and nothing
else. Restart Claude Desktop after installation.

Configuration locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Codex

```bash
codex mcp add artist-notes -- npx -y @manudota/artist-mcp
```

Restart Codex, then confirm the registration with:

```bash
codex mcp get artist-notes
```

Codex stores MCP configuration in its normal user configuration. The command
above uses the supported `codex mcp add` interface instead of requiring a manual
edit.

## 2. Connect your accounts

```bash
npx @manudota/artist-mcp connect
```

A browser window opens on Microsoft's sign-in page. Sign in to the account that
owns the OneNote pages, and approve:

- `Notes.Read` — read OneNote notebooks and pages.
- `offline_access` — keep working after the access token expires. Without it the
  connection dies within the hour.
- `User.Read` — identify the connected account.

The terminal reports **Microsoft connected** when the flow finishes. The refresh
token is written to `~/.artist-mcp/tokens.json` with mode `0600` and never
leaves this machine.

Gmail and Calendar are optional, and are supporting evidence rather than a
working unit:

```bash
npx @manudota/artist-mcp connect google
```

This asks for `gmail.readonly` and `calendar.events.readonly`. The narrower
events scope is deliberate — calendar metadata, sharing and settings are not
read.

Check what this machine holds at any time:

```bash
npx @manudota/artist-mcp status
```

## 3. Verify the connection

Ask the client:

> List my OneNote notes.

Then choose a returned page and ask:

> Read the note titled “Test”.

The MCP server exposes ten read-only tools.

OneNote holds the working unit:

- `list_notes` — returns page titles, section names, modification dates, and
  OneNote page IDs. Narrows to one notebook, and optionally to pages modified
  since a date or to a capped number of them, so "what moved this week" does
  not mean paying for the whole notebook. A page the account records no
  modified date for is left out of a `since` window rather than assumed recent,
  and a capped list says how many matched.
- `read_note` — accepts a page ID returned by `list_notes` and returns readable
  page text.

Google is supporting evidence for a page, never a working unit of its own, and
needs a separate Google connection:

- `list_emails` — searches Gmail with its own query syntax and returns subject,
  sender, date, and snippet.
- `read_email` — accepts an id from `list_emails` and returns the message body,
  plus a list of what is attached by name, type and size, each with a short id
  such as `2` or `1.2` giving its position in the message. Attachment contents
  are not read.
- `map_attachment` — accepts an attachment id from `read_email` and returns what
  is on each page of a PDF — length, an apparent heading, and whether the page is
  a picture — without reading it. Use it to choose pages before reading them.
- `read_attachment` — accepts an attachment id from `read_email`. Images (JPEG,
  PNG, GIF, WebP) come back as pictures to look at, passed through untouched.
  PDFs are text-extracted. Word `.docx` files are read as text — they have no
  pages, so a long one is returned in parts and the answer says so. Diagrams such as stage plans come back as images to look
  at, since the text does not describe them; anything that could be neither
  read nor shown is named as a gap rather than skipped silently, and a file
  with no text layer is reported as page images. A long document or a scan is
  read in page ranges — each answer says which pages it covered and which page
  to start from next, or, for a document too large to read in chat, says so
  and asks which pages are wanted rather than inviting a walk that cannot
  finish.
- `list_events` — lists Google Calendar events in a time window, with recurring
  occurrences expanded and flagged.
- `read_event` — accepts an id from `list_events` and returns description and
  attendees.

The workflow pack:

- `list_agent_workflows` — lists the available artist roles and project types.
- `load_agent_workflow` — loads one checksummed Markdown playbook.

The MCP process calls Microsoft Graph, Gmail and Google Calendar directly with
tokens it holds itself. Nothing is proxied through a hosted service, so no
request is visible to anyone but you and the provider.

## 4. Install the workflow files in a project

This optional command installs the same bundled roles and project types where
Claude or Codex can inspect them directly:

```bash
npx @manudota/artist-mcp agents install
```

It writes into the directory you run it from, or one you name, so run it inside
the project you want the roles in. It refuses to write into your home directory:
`AGENTS.md` and `.artist/` loose in `~` are litter nothing reads.

The installer preserves a differing root `AGENTS.md` and stops before changing
any differing workflow file. One OneNote page remains one working unit, and all
outputs remain in chat.

## 5. Use your own playbooks

There are two installs and nothing in between. The one in step 1 runs the shipped
playbooks, verified by checksum and not editable. The other copies every playbook
somewhere you own, and all of them become yours to change:

```bash
npx @manudota/artist-mcp init --editable
```

That writes the whole pack to `~/artist-mcp/artist/`, or to a directory you
name — `init --editable ~/somewhere-else`. Restart Claude Desktop afterwards.

It is a folder of its own, never files loose in your home directory, and the home
directory itself is refused. `~/artist-mcp/` sits beside the hidden
`~/.artist-mcp/` that holds your tokens: one you open and edit, one you never
touch.

The folder is visible, so open it in Finder and edit the Markdown in whatever you
like. Add your own playbooks alongside them: a new file under `project-types/`,
`roles/`, or `policies/` becomes available under an id taken from its filename. A
new project type is in force immediately, since project types are read in full
before anything else happens. A new role is offered by name and description and
loaded when it looks relevant, so if you want one used reliably, say so in
`roles/ORCHESTRATOR.md`, which is now yours too.

Re-run the same command after upgrading the package. It adds playbooks that are
new in that version, leaves everything you have edited exactly as it is, and
tells you which files it treated as yours. That is how an editable install keeps
receiving improvements without anyone tracking files by hand.

Edits and new files are picked up on the next question, with no restart. What a
running conversation will *not* notice is a playbook you add or change
mid-conversation, because the model reuses the list it already has — start a new
conversation after editing.

To check what is actually in force:

```bash
npx @manudota/artist-mcp agents status ~/artist-mcp
```

If the directory is missing, or a file in it is empty, unreasonably large, or
filed outside `roles/`, `project-types/` or `policies/`, the workflow tools say so
rather than quietly using the shipped versions.

To go back to the shipped playbooks, run `init` again without `--editable`. Your
directory is left where it is, so the same command re-adopts it later.

Editing a playbook changes the advice you get. It cannot let the server write to
OneNote, send mail, or change a calendar, because no such tool exists.

## Reconnect or disconnect

```bash
npx @manudota/artist-mcp connect microsoft   # repeat consent, replace the stored token
npx @manudota/artist-mcp disconnect google   # remove one connection from this machine
npx @manudota/artist-mcp status              # what this machine currently holds
```

`disconnect` removes the token from this machine. It does **not** withdraw the
grant — to do that, remove this app from your
[Microsoft](https://account.live.com/consent/Manage) or
[Google](https://myaccount.google.com/connections) account, which revokes it
everywhere at once.

Each machine connects separately: a token belongs to the computer that signed
in, so installing on a second machine means running `connect` there too.

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

Run `connect` again and complete the flow in one browser tab. If an organization
policy still blocks the account,
try a personal Microsoft account or ask the tenant administrator about
Conditional Access.

### The sign-in response did not match

Close old consent tabs and run `connect` again. The response is bound to the
request that started it, so a stale callback URL is discarded rather than
trusted. Complete the flow in one browser tab.

### Port 8765 is already in use

Sign-in listens on a fixed loopback port, because Microsoft matches redirect
URIs exactly. Close whatever is using it and run `connect` again.

### Reconnect needed

The stored token expired or was revoked — including when the app's access is
removed from a Microsoft or Google account page. Run `connect` for the provider
named in the message.

### Microsoft Graph returns 500, 503, or 504

OneNote endpoints can fail transiently. Retry the request after a short pause.
Rate limits and server errors are already retried before an error is returned.

### The client cannot find `artist-notes`

Restart the client; MCP configuration is loaded at startup. For Codex, run
`codex mcp get artist-notes`. For Claude Desktop, rerun `init`.

### `npx` or Node is missing

Install Node.js 20 or newer, open a new terminal, and verify `node --version`
and `npx --version` before retrying.

## Security notes

- Refresh tokens stay on this machine, in `~/.artist-mcp/tokens.json` with mode
  `0600`. No server stores them, so no operator can read the connected account.
- That file is readable by your own user account, so anything running as you can
  use it. It is not in the OS keychain, which would need a native dependency the
  package cannot take.
- Microsoft rotates its refresh token on every use; the replacement is written
  back before it is used for anything else.
- The Claude Desktop entry contains no credentials at all.
- Revoking the app from your
  [Microsoft](https://account.live.com/consent/Manage) or
  [Google](https://myaccount.google.com/connections) account invalidates it on
  every machine at once.
- Report vulnerabilities using [SECURITY.md](../SECURITY.md), not a public issue.
