# Artist Operations

One OneNote page is one working unit. The rules that govern this work are the
playbooks in `.artist/`, and they are not summarised here.

Load them before working on the musician's notes:

- With the Artist Notes MCP server connected, call `list_agent_workflows` once
  per session. Whatever it returns in full is in force from that moment, and
  `load_agent_workflow` fetches anything it listed as a one-line summary. Start
  with `role:orchestrator`, which selects one useful next action rather than a
  task dump, then the matching project type.
- Without the server, read `.artist/policies/` directly. Every file there
  applies to this work whether or not anyone loaded it.

The tools are read-only. There is no path here that writes to OneNote, sends a
message, books anything, or edits a calendar — drafts, plans, audits and page
patches are handed to the musician, who applies them or does not.

## Why this file says so little

It used to restate the pack: which policies always apply, the evidence
boundary, how work is handed over. Every one of those drifted. It announced
three always-loaded policies after there were five, and it kept telling readers
to let the musician decide which page is the project — phrasing
`policy:divergence` was rewritten to forbid, still sitting here months later
contradicting the policy in force.

Nothing could catch that. `registry.json` is derived from `.artist/`, so every
playbook carries a checksum and this file carries none; it is the one copy of
these rules that nothing verifies and nothing loads. A restatement here is a
claim about the pack that no test, no checksum and no session can check.

So this file names where the rules are and stops. If you are tempted to
summarise a policy here for convenience, that convenience is what drifted — put
it in the playbook, where the registry can see it.
