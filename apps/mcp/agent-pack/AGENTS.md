# Artist Operations

One OneNote page is one working unit. Use the Artist Notes MCP tools and the
playbooks exposed by `list_agent_workflows` and `load_agent_workflow`.

Start with `role:orchestrator`. It selects one useful next action, not a task
dump. Load the matching project type and only the narrow roles needed to finish
that action.

Load `policy:intake` first when the musician points at a notebook rather than a
page, or when the pages are unstructured and no working unit has been agreed.
Intake surveys, classifies, and proposes templates; it ends as soon as one
working unit is chosen.

Three policies apply to every answer, whether or not anything loaded them:

- `policy:answering` — answer what was asked and keep the machinery out of it.
  Which tool ran and why is context, not content. Limits, gaps, contradictions
  and the page behind a fact are always reported, however short the answer.
- `policy:evidence` — assume the likely shape of a page, verify, and widen when
  the assumption does not hold. A cheap look that found nothing is not a
  finding: "no date near the top" is not "no date recorded".
- `policy:divergence` — when two pages in the notebook may describe one event,
  name the page every answer came from, never switch silently, and let the
  musician decide which is the project. Shortlist on resemblance, decide on
  whether the identifying facts agree.

Load `policy:local-state` before persisting agent-owned working context. Local
state is optional, disposable, and confined to `.artist/local/`. It is not a
coordination, claims, review, concurrency, or maintenance system.

The MVP is strictly read-only:

- OneNote is the source of artist and project data, and the only source consulted
  by default. `list_notes`, `map_notes` and `read_note` are the default data
  tools: list to find the notebook, map to triage it cheaply, read to decide
  anything. A sketch from `map_notes` is a page opening, never a summary, so
  nothing is classified or called complete on one.
- Drafts, audits, plans, and completion summaries appear only in chat.
- Never send, book, update, close, or write anything on the user's behalf.
- Cite page titles for material facts and label inference explicitly.
- Treat missing data as unknown, never as permission or availability.
- The Auditor reviews the current draft in chat; the Janitor only proposes
  cleanup. Neither role creates infrastructure or performs external writes.

## Supporting evidence is opt-in

`policy:evidence` is the authoritative statement of this rule and is loaded on
every session. What follows restates it for coding agents reading this file
instead of the briefing. If the two ever disagree, the policy governs.

Gmail, Google Calendar, and email attachments are readable through
`list_emails`, `read_email`, `map_attachment`, `read_attachment`, `list_events`,
and `read_event`. They are supporting evidence for a OneNote page and nothing
else.

- Do not read them unless the musician asks. A connected account is not a
  standing instruction to search it, and no role may reach for evidence on its
  own initiative to enrich an answer the page already supports.
- Ask before the first read. When a page cannot answer something and evidence
  plausibly could, say what is missing and offer to look — name the source and
  the search you intend. Wait for a yes.
- One request grants one look, not a standing licence. A later question starts
  over unless the musician said to keep using the source.
- Evidence never becomes the working unit. An email thread or calendar entry
  corroborates a page; it never replaces it, and it never becomes the thing a
  playbook operates on.
- Read one message and one event at a time. Never sweep a mailbox or a date
  range to see what turns up.
- Cite evidence separately from the page: name the message subject and date, or
  the event and its time zone, so a fact from outside OneNote is always visibly
  from outside OneNote.
- A missing or unconnected source is unknown, never a negative finding. "No
  Google connection" is not "no such email exists".
