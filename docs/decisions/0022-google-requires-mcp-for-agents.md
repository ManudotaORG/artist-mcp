# 0022 — Google requires AI tools to reach Gmail and Calendar through its MCP servers

Status: **proposed 2026-11-24, for the owner's decision. Nothing built.**
Prompted by Google Cloud's notice of 24.11.2026, "[Pricing Update] Changes to
Google Workspace API usage limits starting Feb 2027 and new AI policies", which
names `artist-mcp` as an affected project.

Sources, read 2026-11-24:
[the announcement](https://workspaceupdates.googleblog.com/2026/11/mcp-servers-cli-standardized-usage-tiers-now-available.html),
[the Workspace AI Tools Addendum](https://workspace.google.com/terms/ai-tools),
[usage tiers](https://developers.google.com/workspace/guides/quota-usage-tiers),
[configuring the MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers),
and the Gmail and Calendar MCP tool reference pages.

## What Google changed

| | When | What |
| --- | --- | --- |
| **MCP requirement** | enforced **1 Feb 2027** | A tool that "is or is driven by" an AI agent or model must use Google's MCP servers, not the REST APIs. OAuth clients calling those servers must be flagged "Use this client for an AI-powered agent". |
| **Usage tiers** | since 24 Nov 2026 | Standard (free, published quotas) and Scaled (paid above free allowances from 1 Apr 2027). Gmail, Calendar, Drive first. An agent still calling REST is held to Standard whatever tier is chosen. |
| **AI Tools Addendum** | in force now | No keeping user data after the tool is disconnected or revoked (2(d)); data used only for "active, user-authorized tasks" (2(a)); no training on it (2(f)); no scraping (2(e)); derived "technical information" such as embeddings at most 30 days (2(b)). |

## What it means here

**artist-mcp is covered.** It is an MCP server driven by Claude or ChatGPT, and
inside it calls `gmail.googleapis.com/gmail/v1` and
`www.googleapis.com/calendar/v3` directly. The addendum's definition takes in
"any … software … or other tool" reached by an AI model, and forbids
obfuscating to avoid it. No page offers an exception for a deterministic
wrapper. **From 1 February 2027, every Google tool here should be assumed to
stop working**: the mail reads the digest depends on, the calendar reads 0021
just started using for anchors, and the calendar writes of 0001 and 0013.
Google does not say how it detects a REST caller as an agent, so the failure
may be a refusal, a quota cliff, or a terms problem rather than a technical
one. None of those is acceptable for a scheduled digest.

**OneNote and the task view are untouched.** Microsoft, the snapshot (0020)
and the Zeitplan (0021) involve no Google API.

**The quotas are not the problem.** Usage is two people. But the MCP limit is
**5,000 requests a day per project per product**, and hosted serves every user
from one project, so that is a shared ceiling, not a per-person one.

### What Google's MCP servers can and cannot do, against what this server does

| artist-mcp today | Google's MCP server | Gap |
| --- | --- | --- |
| `list_emails`: one Gmail search | `search_threads`, Gmail syntax, ≤50 threads, snippets | fits |
| `read_email`, `read_thread` | `get_message`, `get_thread` (full bodies) | fits |
| `read_gmail_attachment`, `map_gmail_attachment` | `get_message` and `get_thread` return `id`, `mimeType`, `filename` only; no attachment tool (`get_attachment` is a 404) | **no way to read an attachment's contents**. The digest never opens one; only an asked-for look does. A file on a OneNote page is still read through Microsoft |
| `list_calendars`, `list_events`, `read_event` | `list_calendars`, `list_events`, `get_event` | fits; default window is 7 days and must be widened |
| `create_calendar_event` with an `artist` id derived from its content (dedup, provenance, the 30-day bin rule) | `create_event` | **custom id not confirmed** |
| `edit_calendar_event`: confirmation bound to the etag, `If-Match` | `update_event`: no etag, no `If-Match` | **the guard against overwriting a changed event is lost**; a read before the write narrows the race and does not close it |
| `sendUpdates=none`: nobody emailed | `notificationLevel: NONE` (default `ALL`) | fits, if always set |
| `delete_calendar_event` | `delete_event` | fits |

The reference pages say **Developer Preview** and list membership of the
preview programme as a prerequisite; the quota page calls Gmail and Calendar
MCP GA. Unresolved until tried.

### The addendum against what is stored

- **Hosted `write_audit` keeps calendar content in plain text, indefinitely**,
  including the pre-image of every event edited. `disconnect_provider('google')`
  deletes the connection and not those rows. Under 2(d) that is user data
  retained after disconnect. **This is a gap today, not in February**, and it
  is fixable alone: delete a user's Google-derived `write_audit` rows on a
  Google disconnect, as a Microsoft disconnect already forgets the task view.
  The cost is that `undo_write` can no longer reverse a calendar write after
  the person disconnected Google, which it could not do anyway without a token.
- **The local write log** (`~/.artist-mcp/writes.log`) does the same on the
  user's own machine. Whether the addendum binds a log the user holds about
  their own account is unclear; deleting Google lines on
  `artist-mcp disconnect google` is cheap and removes the question.
- **The unattended digest reads mail on a schedule.** 2(a) allows "active,
  user-authorized tasks"; a schedule Ruben set up, reading what its prompt
  names, is that. Worth stating in the docs rather than assuming.
- Nothing here trains on data, builds embeddings, or scrapes.

## Options

1. **Call Google's MCP servers from inside artist-mcp** (proposed). The tools
   keep their names, descriptions, evidence gate and confirmations; only the
   transport changes. The OAuth client must be flagged as an agent. Flagging
   the existing client probably keeps every connection, since a token belongs
   to the client id and the scopes already granted are ones the MCP tools
   accept; only a new client would make every Google user reconnect. Costs: attachments in mail are lost unless Google adds
   a tool, the edit guard weakens to read-then-write, and the custom event id
   needs checking. The policy layer — the reason this server exists rather
   than the model talking to Google directly — survives.
2. **Drop Gmail and Calendar from artist-mcp** and let Claude or ChatGPT use
   Google's MCP servers directly. Least code, but every rule the pack and the
   tool descriptions apply (evidence only when asked, one look per yes,
   confirmation by what a write destroys, nobody emailed) is gone, and the
   digest's mail and calendar steps would rest on whatever the assistant's own
   connector does.
3. **Keep REST and argue the tool is deterministic.** The addendum's wording
   rules this out, and it fails silently in production if Google disagrees.

## Proposed order

1. **Now, independent of February:** on a Google disconnect, delete that
   user's Google-derived `write_audit` rows and local log lines (2(d)). A
   migration, a test that fails without it, and a line in `operations.md`.
2. **Check usage** in the new Workspace API usage dashboard in Cloud Console.
   Only the owner can.
3. **A spike against Google's MCP servers** with a flagged test client: whether
   the preview programme is required, `create_event` with a custom id,
   `update_event` and `delete_event` with `notificationLevel: NONE`,
   `get_message`, `list_events` over a season, request counts per tool call
   against the 5,000 a day, and whether a refresh token issued before the
   client was flagged is accepted after it.
4. **Then decide** between options 1 and 2 on what the spike finds, with
   attachments and the edit guard as the two decisions it forces.
5. **Ship before 1 February 2027**, with a reconnect for every Google user
   only if the spike shows the flag cannot go on the existing client.

## Built: step 1, 2026-11-24

- **Hosted:** `20261125120000_forget_google_writes.sql` adds
  `forget_my_google_writes()` (security definer, no argument, the signed-in
  user's rows only, revoked from `public` and `anon`) and calls it from
  `disconnect_provider('google')`. It deletes that user's `write_audit` rows
  whose operation names the calendar; OneNote rows stay. Guarded in
  `scripts/hosted-custody.test.mjs`. Exercised on a throwaway Postgres 16: a
  Google disconnect left the user's OneNote row, the other user's calendar row
  and the Microsoft connection, and `anon` was refused. **Not yet applied to
  production.**
- **Local:** `artist-mcp disconnect google` removes calendar lines from
  `~/.artist-mcp/writes.log` (temporary file, then rename; a torn line is
  kept), also when no connection is left, so a log an older version left can
  be cleared. Tested in `connect.test.mjs`, whose disconnect tests now point the
  log at a temporary file instead of the developer's own.
- **Not covered:** access revoked at Google's end without a disconnect here.
  The rows stay until the person disconnects, or the refresh fails and nobody
  notices. Detecting a revoked grant and forgetting on it is a later step.

## Open questions for the owner

1. Option 1, 2, or a mix (reads through artist-mcp, writes left to the
   assistant's own Google connector)?
2. Is losing Gmail attachments acceptable, if Google's server cannot read them?
3. Is a read-then-write edit guard acceptable for `edit_calendar_event`, or
   should editing events not created by this tool be withdrawn?
