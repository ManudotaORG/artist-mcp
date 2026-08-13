# @manudota/artist-mcp

An MCP server that reads your OneNote pages in Claude Desktop or Codex, with
optional Gmail and Google Calendar as supporting evidence.

One OneNote page is one working unit. Email and calendar entries corroborate or
fill gaps in that page and are never themselves the thing being worked on.

Everything is read-only. No writes to any source, no sending, no sync.

## Before you install

This package talks to a hosted service, so you need an account and a connection
key first:

1. Open <https://artist-mcp.vercel.app> and sign in by email.
2. Connect Microsoft and approve `Notes.Read`, `offline_access`, and `User.Read`.
3. Optionally connect Google for `gmail.readonly` and `calendar.events.readonly`.
4. Generate a connection key. It is shown once.

**Anyone holding the production database credential can technically reach the
OneNote data of any connected account.** That is inherent to refreshing tokens
while you are away, which is what lets an installed MCP work without you
present; encryption at rest protects a stolen backup, not a live credential.
This is bounded today by policy and audit rather than by cryptography, and the
hardening work is tracked in
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22). Connect an account
only if you are willing for a maintainer to be able to read it.

Gmail is narrower in practice for now: `gmail.readonly` is a restricted scope,
so until Google's verification review completes, only accounts on the OAuth
test-user list can consent at all.

## Install

### Claude Desktop

```bash
npx @manudota/artist-mcp init
```

Paste the connection key when prompted, then restart Claude Desktop.

### Codex

```bash
read -s ARTIST_MCP_KEY
codex mcp add artist-notes --env ARTIST_MCP_KEY="$ARTIST_MCP_KEY" -- npx -y @manudota/artist-mcp
unset ARTIST_MCP_KEY
```

Restart Codex after adding the server.

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

The local process never receives a Microsoft or Google access token, or a
Supabase service key. It sends only the connection key and an allowed operation
to the hosted edge function.

## Workflow pack

```bash
npx @manudota/artist-mcp agents install
```

Installs read-only roles (Orchestrator, Archivist, Registrar, Project Manager,
Envoy, Auditor, Janitor) and project types (Concert, Large Concert, Studio
Session, Rehearsal) into the current project as plain Markdown, loaded at
runtime and verified by checksum.

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
