# @manudota/artist-mcp

An MCP server that reads your OneNote pages in Claude Desktop or Codex, with
optional Gmail and Google Calendar as supporting evidence.

One OneNote page is one working unit. Email and calendar entries corroborate or
fill gaps in that page and are never themselves the thing being worked on.

Reading is the default, and nothing is sent or synced. An install can be
granted a narrow write capability at install time; a capability you did not
grant registers no tool, so there is nothing for the model to call. See
[Writes](#writes).

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

Fourteen tools are always available. OneNote holds the working unit:

| Tool | Returns |
| --- | --- |
| `list_notes` | Page titles, sections, modification dates, and page IDs. Narrows by notebook, by modified date, or to a count |
| `map_notes` | The opening of every page in one notebook, so it can be triaged before any page is read. A page with no usable preview is read in full instead, and the answer says which |
| `read_note` | Readable page text for one page ID, in parts when the page is too long for one answer |
| `map_page_attachment` | What is on each page of a file attached to a OneNote page, without reading it |
| `read_page_attachment` | That attachment's content — images as pictures, PDFs and `.docx` as text, in page ranges |

Google is supporting evidence, and needs the separate Google connection:

| Tool | Returns |
| --- | --- |
| `list_emails` | Gmail search results — subject, sender, date, snippet |
| `read_email` | Message body, plus what is attached by name, type, and size |
| `map_gmail_attachment` | What is on each page of a PDF, without reading it |
| `read_gmail_attachment` | Images as pictures; PDFs and `.docx` as text, in page ranges |
| `list_calendars` | The calendars this account can see, which is primary, and your access to each |
| `list_events` | Calendar events in a window, recurrences expanded and flagged |
| `read_event` | Description and attendees for one event |

The workflow pack:

| Tool | Returns |
| --- | --- |
| `list_agent_workflows` | The available roles and project types, with the project types in full, and which of them are your own edited files |
| `load_agent_workflow` | One Markdown playbook, verified against its checksum |

This process calls Microsoft Graph, Gmail and Google Calendar directly, using
tokens it holds itself. Nothing is proxied through a service of ours, so no
request of yours is visible to anyone but you and the provider.

**Google connections currently expire after seven days.** The Google OAuth app
is in Google's *Testing* publishing status, which caps the life of a refresh
token; when it lapses, the next Gmail or Calendar call reports that the
connection needs reconnecting, and `connect google` restores it. Microsoft is
unaffected. Tracked in
[#94](https://github.com/ManudotaORG/artist-mcp/issues/94).

## Writes

Every write is off unless you ask for it at install time, and each one is a
named capability passed to `init`:

```bash
npx @manudota/artist-mcp init --allow-writes onenote-create,calendar-create
```

| Capability | What it allows |
| --- | --- |
| `calendar-create` | Add a single event to a Google Calendar |
| `calendar-delete` | Remove an event this tool itself created; it cannot touch one you made |
| `onenote-create` | Add a new page to a section |
| `onenote-edit` | Change a page this tool itself created — append, or replace part of one. Microsoft enforces this: the scope cannot reach a page you wrote |

Granting `calendar-create` and `calendar-delete` together also allows
rescheduling an event this tool created.

Three things hold for all of them. A capability you did not grant registers no
tool at all, so it cannot be invoked, argued for, or reached by mistake. Every
write is preceded by a preview of the exact change, and the write only goes
through with the token that preview returns. And every write is recorded in
`~/.artist-mcp/writes.log`, with the previous content for anything it changed.

**Nothing deletes a OneNote page**, and no message is ever sent. Those are scope
commitments, not capabilities that happen to be off.

Adding or removing a capability means re-running `init` and reconnecting the
provider, since the OAuth scopes change. `artist-mcp status` prints what this
install currently holds.

## Workflow pack

```bash
npx @manudota/artist-mcp agents install
```

Installs the roles (Orchestrator, Archivist, Registrar, Project Manager,
Envoy, Auditor, Janitor) and project types (Concert, Large Concert, Studio
Session, Rehearsal) as plain Markdown, loaded at runtime and verified by
checksum. It writes into the directory you run it from, so run it inside the
project you want the roles in — and it refuses your home directory, where the
files would sit unread.

To see which playbooks the server is actually reading, and where each one came
from:

```bash
npx @manudota/artist-mcp agents status [directory]
```

### Editing the playbooks

```bash
npx @manudota/artist-mcp init --editable
```

That copies every playbook to `~/artist-mcp/artist/`, or to a directory you name.
All of them become yours to edit. Without `--editable`, the shipped playbooks are
used and verified by checksum; there is nothing in between.

Re-run the same command after upgrading. It adds playbooks that are new in that
version, leaves anything you have edited exactly as it is, and tells you which
files it treated as yours — so an editable install keeps receiving improvements
without you tracking files by hand.

The folder is visible, not hidden, so open it and edit the Markdown in whatever
you like. **Add your own** alongside the shipped ones: a new file under
`artist/project-types/`, `artist/roles/`, or `artist/policies/` becomes available
under an id taken from its filename. A new project type is in force immediately,
because project types are read in full before anything else happens. A new role
is offered by name and description and loaded when it looks relevant, so if you
want one used reliably, say so in `artist/roles/ORCHESTRATOR.md` — which is now
yours too.

Edits are picked up on the next question, with no restart. A conversation that
already asked for the playbook list will not notice a *new* one, so start a fresh
conversation after adding a file.

If a playbook cannot be read — empty, unreasonably large, or filed outside those
three directories — the server says so instead of quietly falling back to the
shipped version.

Editing a playbook cannot widen what the server can do. The boundary is not
written in the Markdown — it holds because a capability you did not grant
registers no tool, and a playbook cannot call a tool that is not there. An edited
playbook changes the advice you get, and nothing else.

The playbooks produce plans, recommendations, audits, and drafts in chat, and
they use whichever writes this install was granted — no more. Gmail and Calendar
are read only when you ask for them: a connected account is not a standing
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
