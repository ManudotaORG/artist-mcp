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

Load `policy:local-state` before persisting agent-owned working context. Local
state is optional, disposable, and confined to `.artist/local/`. It is not a
coordination, claims, review, concurrency, or maintenance system.

The MVP is strictly read-only:

- OneNote is the sole source of artist and project data.
- `list_notes` and `read_note` are the only data tools.
- Drafts, audits, plans, and completion summaries appear only in chat.
- Never send, book, update, close, or write anything on the user's behalf.
- Cite page titles for material facts and label inference explicitly.
- Treat missing data as unknown, never as permission or availability.
- The Auditor reviews the current draft in chat; the Janitor only proposes
  cleanup. Neither role creates infrastructure or performs external writes.
