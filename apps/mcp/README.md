# @manudota/artist-mcp

An MCP server that reads your OneNote pages in Claude Desktop or Codex, with
optional Gmail and Google Calendar as supporting evidence.

One OneNote page is one working unit. Email and calendar entries corroborate or
fill gaps in that page and are never themselves the thing being worked on.

Everything is read-only. No writes to any source, no sending, no sync.

## Where your credentials live

On this machine, and nowhere else. You sign in to Microsoft and Google in your
own browser, and the refresh token stays here — there is no account to create,
no key to paste, and no server of ours holding anything that could read your
notes or mail.

The limit worth knowing: the token is stored in a file readable by your own user
account (`~/.artist-mcp/tokens.json`, mode `0600`), not in the OS keychain. That
needs a native dependency this package will not take, since it must install
without a compiler. So anything already running as you can use that token —
reading your notes takes code on your specific machine, rather than a query
someone could run from anywhere against every user at once.

Gmail is narrower in practice for now: `gmail.readonly` is a restricted scope,
so until Google's verification review completes, only accounts on the OAuth
test-user list can consent at all.

## Install

### Claude Desktop

```bash
npx @manudota/artist-mcp init
npx @manudota/artist-mcp connect
```

`init` registers the server; `connect` opens your browser to sign in to
Microsoft. Add Gmail and Calendar with `connect google`. Then restart Claude
Desktop.

### Codex

```bash
codex mcp add artist-notes -- npx -y @manudota/artist-mcp
npx @manudota/artist-mcp connect
```

Restart Codex after adding the server.

Other commands: `status` shows what this machine is connected to, and
`disconnect [provider]` removes a connection from it.

For the staging channel, use `@manudota/artist-mcp@staging` in place of the
package name.

Then ask your client:

> List my OneNote notes.

## Tools

Ten read-only tools. OneNote holds the working unit:

| Tool | Returns |
| --- | --- |
| `list_notes` | Page titles, sections, modification dates, and page IDs |
| `read_note` | Readable page text for one page ID |

Google is supporting evidence, and needs the separate Google connection:

| Tool | Returns |
| --- | --- |
| `list_emails` | Gmail search results — subject, sender, date, snippet |
| `read_email` | Message body, plus what is attached by name, type, and size |
| `map_attachment` | What is on each page of a PDF, without reading it |
| `read_attachment` | Images as pictures; PDFs and `.docx` as text, in page ranges |
| `list_events` | Calendar events in a window, recurrences expanded and flagged |
| `read_event` | Description and attendees for one event |

The workflow pack:

| Tool | Returns |
| --- | --- |
| `list_agent_workflows` | The available artist roles and project types |
| `load_agent_workflow` | One checksummed Markdown playbook |

This process calls Microsoft Graph, Gmail and Google Calendar directly, using
tokens it holds itself. Nothing is proxied through a service of ours, so no
request of yours is visible to anyone but you and the provider.

## Workflow pack

```bash
npx @manudota/artist-mcp agents install
```

Installs read-only roles (Orchestrator, Archivist, Registrar, Project Manager,
Envoy, Auditor, Janitor) and project types (Concert, Large Concert, Studio
Session, Rehearsal) into the current project as plain Markdown, loaded at
runtime and verified by checksum.

To see which workflow files the server is actually reading, and where each one
came from:

```bash
npx @manudota/artist-mcp agents status
```

### Editing the playbooks

Copy out the one you want to change, edit it, then point this machine at the
directory:

```bash
npx @manudota/artist-mcp agents edit project-type:concert ~/artist-playbooks
npx @manudota/artist-mcp init --agents ~/artist-playbooks
```

Your file overrides the shipped one of the same id; everything you did not copy
stays bundled and keeps improving with the package. Copy one file rather than
the whole pack for exactly that reason.

Editing a playbook cannot widen what the server can do. The read-only boundary
is not written in the Markdown — it holds because no tool exists that writes to
OneNote, sends mail, or changes a calendar.

The playbooks produce plans, recommendations, audits, and drafts in chat. They
cannot write to OneNote, send mail, or touch a calendar. Gmail and Calendar are
read only when you ask for them — a connected account is not a standing
instruction to search it.

## Requirements

Node 20 or newer.

## Links

- [Full installation guide](https://github.com/ManudotaORG/artist-mcp/blob/main/docs/installation.md)
- [Repository](https://github.com/ManudotaORG/artist-mcp)
- [Releases and patch notes](https://github.com/ManudotaORG/artist-mcp/releases)
- [Security policy](https://github.com/ManudotaORG/artist-mcp/blob/main/SECURITY.md)

## License

MIT
