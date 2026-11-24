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

## Availability: preview-only for personal accounts, so far

Found 2026-11-25: the Gmail MCP server is open only through the Workspace
Developer Preview Program, which needs a Workspace account. Ruben and the owner
use personal (@gmail.com) accounts, so the spike cannot run on them yet.

The signs that it opens before enforcement: Google's notice speaks of the
"general availability of MCP servers and CLI"; the announcement gives about two
weeks for GA items to roll out; the quota page already calls the Gmail and
Calendar servers GA; and requiring a route from 1 February that consumer
accounts cannot use would make little sense. Against: none of it says
consumer accounts are included, and the reference pages still say preview.

So, not assumed:

- **Check again around 8 December 2026**, the end of the stated rollout: is the
  preview banner gone, and can a personal account connect?
- **To ask in [issue 590205343](https://issuetracker.google.com/issues/590205343)**
  whether consumer accounts get the servers before 1 February 2027.
- **The spike can run on a Workspace account meanwhile** (a single Business
  Starter seat or a trial). The technical answers — the client flag, event
  ids, the edit guard, request counts — carry over.
- **Fallback, if nothing has opened by mid-January 2027:** Gmail and Calendar
  stay on REST for personal accounts, with Google's answer, or its silence,
  recorded here as the reason. A tool cannot be required to use a route Google
  has not opened to its users; if Google says otherwise in writing, that
  decides it.

## Mail attachments, which matter most

Checked again 2026-11-24 against the German and English reference pages: the
same ten tools, `get_message` described as the tool to "examine attachment
metadata", no attachment tool. The owner calls losing attachments a big deal,
so the ways to keep them, most reliable first:

1. **Ask Google for an attachment tool** while the server is in Developer
   Preview, the stage at which gaps are collected. Costs nothing; promises
   nothing.
2. **The file on the OneNote page.** Read through Microsoft with
   `read_page_attachment`, untouched by Google's rules. Ruben drags it from
   Gmail onto the page, or, if Microsoft still offers it, forwards the mail to
   `me@onenote.com`. Works for certain; costs Ruben a step per document.
3. **A button in the web app, outside the AI**, on its own non-agent OAuth
   client calling Gmail's REST API, as Google's announcement allows for
   "traditional" features: Ruben clicks to put a mail's attachment on the
   project page. Two objections, neither settled: the addendum forbids
   obfuscating to avoid classification, and a copy whose purpose is that the AI
   reads it may count as that; and it is the first feature to move content
   between sources, which the repository rule against synchronization stops
   until decided.
4. **Google Drive.** Gmail saves an attachment to Drive, and Google has a Drive
   MCP server. Whether it reads file contents is unchecked, and Drive would be
   a new source, which is a decision of its own.

5. **Everything on MCP except attachments, which stay on REST** — only with
   Google's written permission. Technically it probably works: the quota page
   says agents calling REST directly "stay on Standard Tier limits", which
   reads as throttled rather than blocked, and usage here is tiny. Under the
   addendum it does not: clause 1 makes no exception for what the MCP server
   lacks, and a second "non-agent" client for the same call is the
   obfuscation it forbids. The cost of being wrong is not one feature but the
   OAuth client or the project, which is every Google tool for every user. So
   the attachment path is built as its own module with its own transport:
   switched to Google's tool if one comes, kept on REST if Google says so in
   writing, switched off on 1 February otherwise, answering with the file's
   name and a pointer to the OneNote page.

**Sent 2026-11-24, [issue 590205343](https://issuetracker.google.com/issues/590205343):** the feature request for a `get_attachment` tool, with
the question whether an agent may read an asked-for attachment over REST
meanwhile, filed through the Developer Preview "Send feedback" template for the
Gmail MCP server (Issue Tracker component 2090367). No answer yet; if none
comes within a week, the programme's FAQ says to write to
workspace-dpp-mod@google.com.

Proposed: 1 now, with the question that decides 5 in the same request; 4
checked in the spike; 2 as the floor that certainly works; 5 if Google allows
it; 3 only if Google gives no answer.

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
  and the Microsoft connection, and `anon` was refused. **Applied to production on
  2026-11-24** with `supabase db push`, after a dry run showed it was the only
  migration production lacked; checked there: `disconnect_provider` calls
  `forget_my_google_writes`, which is security definer, refused to `anon` and
  callable by `authenticated`.
- **Local:** `artist-mcp disconnect google` removes calendar lines from
  `~/.artist-mcp/writes.log` (temporary file, then rename; a torn line is
  kept), also when no connection is left, so a log an older version left can
  be cleared. Tested in `connect.test.mjs`, whose disconnect tests now point the
  log at a temporary file instead of the developer's own.
- **Not covered:** access revoked at Google's end without a disconnect here.
  The rows stay until the person disconnects, or the refresh fails and nobody
  notices. Detecting a revoked grant and forgetting on it is a later step.

## Spike: step 3, started 2026-11-24

`scripts/spike-google-mcp.mjs`, a standalone probe in the style of
`spike-pkce.mjs`. It uses a new Desktop OAuth client in the production project,
and the existing clients are left untouched. It asks for the product's scopes
plus `calendar.events`, keeps the refresh token in `~/.artist-mcp-spike/`
(mode 600), and writes its results there. The results hold no tokens and no
mail bodies.

### Run A, agent setting off, 2026-11-24

- **Sign-in, refresh and connecting work with the setting off.** `initialize`
  and `tools/list` were answered on both servers with the unflagged client's
  token. Both servers call themselves `StatelessServer`. Connecting and listing
  took 1,818 ms for Gmail (the first contact) and 418 ms for Calendar.
- **Developer Preview membership is required, per project.** Every tool call
  (`search_threads`, `list_calendars`, `list_events`) was refused in
  70–780 ms with "Access to this tool requires that your Google Cloud project
  (993381632576) is enrolled in the Google Workspace Developer Preview
  Program". The quota page's "GA" does not hold for this project today. The
  refusal is about the project, not the client, so the agent setting's own
  effect cannot be seen until the project is enrolled. Nothing below comes
  from a successful tool call yet.
- **The live tool lists are longer than the reference pages.**
  - **Gmail: 23 tools, where the pages list 10.** The extra ones include
    `trash_thread`, `trash_message`, `mark_*_spam`, `update_message_labels`,
    `create_label`, `apply_sensitive_*_label` and `get_draft`. That matters to
    option 2: an assistant connected to this server directly holds tools to
    trash mail.
  - **Calendar: 9 tools**: `list_events`, `get_event`, `list_calendars`,
    `search_events`, `suggest_time`, `create_event`, `update_event`,
    `delete_event`, `respond_to_event`.
- **Attachments.** No tool reads one. `AttachmentMetadata` holds `id`,
  `mimeType`, `filename` and `partId`. But **`get_message` takes
  `messageFormat: RAW`**, described as "Returns the raw MIME message content",
  and it is absent from the reference pages. Raw MIME carries attachments as
  base64 parts, so this may be the way to read one. The probe now checks
  whether a listed attachment's part is in the RAW output, without printing
  any of it. Unconfirmed until a call succeeds. `get_thread` does not offer
  RAW, and both default to `PLAIN_TEXT`.
- **Custom event id: not in the schema.** `create_event` has no `id` or
  `eventId` input. The write probe sends one anyway, to see whether the server
  refuses it or ignores it.
- **The edit guard.** `update_event` takes no etag, `If-Match`, sequence or
  precondition parameter. `get_event`'s output schema has no `etag` and no
  `sequence`, only `updated`. Its parameters ("New title", `addedAttendees`
  and `removedAttendees`) read as a patch rather than a replace. That leaves
  only one guard: re-read and compare `updated` and the fields being changed
  just before the write. That narrows the race and does not close it.
- **Cost per call, as seen from the client.** One HTTP request per tool call.
  Connecting and listing tools took 4 more requests per server. Whether those
  count against the 5,000 a day is only visible in Cloud Console's metrics.

**Blocked:** the remaining questions need the project enrolled in the
Developer Preview Program. Those are the reconnect test, a successful read,
RAW, the custom id and the writes. **Enrolment needs a Google Workspace
account, and the owner has only a consumer Google account** (2026-11-24).

That is a finding for the migration, not only for the spike. Google's servers
refuse tool calls from a project outside the preview, and only a Workspace
account can enrol one. So this project cannot call Google's MCP servers at
all, for testing or in production. Meanwhile, from 1 February 2027 it may no
longer call REST. Unless Google opens the tools to every project before then,
or enrols consumer-account projects, there is no compliant path to build
against. The question goes to Google before any building starts.

Enrolment would not be enough either. The preview programme's terms say
features "may not be included in public applications prior to the General
Availability (GA) announcement", and forbid giving pre-GA access to end users
outside your own domain. The published package and hosted both serve Ruben, so
neither could use the servers until GA, whatever the spike shows. The guide
gives no GA date. The preview page says features "usually stay in the program
for 3-6 months". The guide's "personal mode" quick setup creates a client for
your own account. It does not say it lifts the preview requirement, and Run
A's refusal named the project, not the client. (Read 2026-11-24.)

### Run P, personal mode, 2026-11-24

To rule personal mode out, the owner ran the guide's quick setup for personal
use. That created a new project (280025240565) and a client with "Use this
client for an AI-powered agent" ticked. Sign-in, refresh, connecting and
listing tools all worked, and the tool lists were the same as in Run A. Every
tool call was refused with the same message, naming the new project:
**personal mode does not lift the preview requirement.** With the agent
setting on and the client made by Google's own quick setup, the one thing
missing is enrolment. **No path open to a consumer account reaches a tool
call** as of 2026-11-24.

**Owner's decision, 2026-11-24: wait for GA.** No further question goes to
Google. The spike resumes when Google announces GA for the Gmail and Calendar
MCP servers, by running the probe again: the reconnect test, RAW, the custom
id and the writes. The risk is accepted knowingly. If GA has not come by
1 February 2027, there is no compliant path, and every Google tool here should
be assumed to stop.

## Open questions for the owner

1. Option 1, 2, or a mix (reads through artist-mcp, writes left to the
   assistant's own Google connector)?
2. Attachments: which of the routes above, given that losing them is not acceptable?
3. Is a read-then-write edit guard acceptable for `edit_calendar_event`, or
   should editing events not created by this tool be withdrawn?
