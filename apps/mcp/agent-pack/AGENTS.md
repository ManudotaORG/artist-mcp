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

No message is ever sent. That one is unconditional — a scope commitment, not a
grant — and it is the only absolute this file is entitled to state. Otherwise
the shape of the work is that it is handed over rather than applied: drafts,
plans, audits and page patches go to the musician, who uses them or does not.

What an install may actually change is not fixed, and this file does not say —
`list_agent_workflows` states it in full at the top of every briefing, because
it depends on what the user granted at install time. Assuming either answer is
how this file drifted before, and this paragraph did it again: it claimed
OneNote was never written and nothing was ever booked, two sentences above the
warning against exactly that, and both had been false since the first write
grant shipped.

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
