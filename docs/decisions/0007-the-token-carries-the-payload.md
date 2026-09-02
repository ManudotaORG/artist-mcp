# 0007 — The confirmation token carries what it confirms

Status: **proposed.** Extends [0001](0001-opt-in-calendar-writes.md), which
introduced the preview-and-confirm pair, to every write that has since been
built on it. Nothing here changes what an install may do; it changes what a
committing tool has to be told, and what a mismatch between preview and commit
costs.

## Why this is worth doing

The tool list is sent with every request. The workflow briefing is sent once per
session. That difference was not measured until now, and it inverts where this
server's context budget actually goes.

Served over the protocol, with every capability granted:

| | Per request | Per session |
| --- | --- | --- |
| No write grants | 4,337 tokens, 14 tools | 11,584 |
| Every write grant | **9,375 tokens, 24 tools** | 12,713 |

Input schemas are 17,277 characters of that, almost exactly matching the 17,786
of descriptions — the half nobody was counting. At full grants the tool list
costs more than the entire briefing after **1.4 turns**, and over a
twenty-turn session it is roughly 187,000 tokens against 12,700.

The five preview/commit pairs are 19,094 characters, **51% of every request**.
The commit halves alone are 8,789, and they are almost entirely parameters the
preview has already declared, validated and refused on.

`pnpm --filter @manudota/artist-mcp context-budget` prints the first table.
The per-tool split is in that script's output.

## What the pair costs today, and why it is shaped that way

`preview_calendar_event` takes the event and returns a token. The token is a
SHA-256 over the canonicalised draft (`digest` in `apps/mcp/src/calendar.ts`),
so it is a pure function of the payload and the server keeps nothing.
`create_calendar_event` then takes **every field again** plus the token,
recomputes the hash, and refuses if it differs.

That statelessness is the design's best property and this record does not give
it up. It needs no storage, no expiry, no cleanup; it behaves identically under
both custody models; a token cannot go stale mid-conversation; and it discloses
nothing if it leaks.

The cost is that the shape of every write has to be expressed twice in the tool
list — 1,129 characters of schema on `create_calendar_event` restating
`preview_calendar_event`, 1,415 on `edit_onenote_page` restating the whole
`changes` array, and so on.

## The decision

**A committing tool takes the confirmation token and nothing else.** The token
stops being a hash *of* the payload and becomes an authenticated encoding *of*
it: the canonical draft plus an HMAC over it, keyed by a secret the install
already holds. The server decodes the token, verifies the HMAC, and writes what
it finds — the same values the preview rendered, because they are the bytes the
preview signed.

`create_calendar_event`, `create_onenote_page`, `edit_onenote_page`,
`delete_calendar_event` and `reschedule_calendar_event` each reduce to
`{ confirmation_token, source_page? }`.

Two things follow, and the second is the reason to do it rather than the
saving.

**It is smaller.** Those five tools are 8,789 characters today and about 2,250
after — roughly 6,500 characters, **~1,600 tokens off every request**, about 17%
of the tool payload at full grants.

**A mismatch stops being possible.** Today a commit that names different values
than the preview showed is detected and refused: the guard is a comparison, and
a comparison is a thing that can be got wrong, skipped for one field, or quietly
weakened. Under this record there is no second copy of the values to disagree
with the first. The tool cannot express "write something other than what was
shown", which is a stronger property than refusing it. That is the same move
0003 made by taking `Notes.Create` instead of keeping the boundary in our code:
prefer a boundary that cannot be crossed to one that is checked.

## What must stay true

- **No server-side state.** See "Rejected" below; this is the constraint that
  chose the design.
- **The token still proves nothing about a human.** It proves the server
  generated it for these values. It cannot prove anybody read the preview, and
  no mechanism inside MCP can — 0001 said so and it remains true. The rule that
  the musician says yes in words is a rule, not an enforcement.
- **A capability that was not granted registers no tool.** Unchanged. This
  record touches the shape of a tool, never whether it exists.
- **The write audit still records the pre-image**, and `edit_onenote_page` still
  refuses without one. Decoding a payload from a token does not relax 0004's
  "no capture, no write".

## What has to be verified before this is accepted

Not yet built. This record is the argument, not the evidence, and the standard
0004 set is a live run rather than a green suite.

- The token for a whole-table replace is large: the payload is the table's
  markup. Measure a real one. A token that no longer fits comfortably in a tool
  result argues for keeping the pair as it is for `onenote-edit` alone and
  taking the saving on the four smaller writes.
- Confirm the HMAC key. Locally the install can mint a random secret per
  process. Hosted is stateless per request across many users, so it needs a
  stable key; `TOKEN_ENCRYPTION_KEY` already exists for tokens at rest, and
  reusing it for a second purpose is a decision to make deliberately rather than
  by convenience.
- Confirm the failure mode of a token from an older server version, since the
  encoding is now a format rather than a hash.
- Re-run `context-budget` and record the real figure rather than this estimate.

## Rejected

**Storing the preview payload server-side, keyed by the token.** The obvious
version of this record, and it fails on custody rather than on complexity. The
hosted server currently stores credentials and nothing else — encrypted refresh
tokens in `connections`, and an audit row per write. Keeping preview payloads
would mean storing the musician's **page content and mail-derived values** at
rest, for every previewed change including the ones they decline. That widens
what a hosted compromise exposes, contradicts what hosted users are told before
they connect, and would need saying in [SECURITY.md](../../SECURITY.md). Not
worth ~1,600 tokens a request. It would also introduce expiry: a preview whose
row aged out fails at the moment the musician says yes, which is the worst
possible moment for a new failure.

**Encoding the payload without authenticating it.** Then a token is trivially
forgeable and the preview stops being a precondition at all — the model could
write values nobody was shown. The HMAC is what makes the encoding safe, and it
is not optional.

**Collapsing the ten write tools behind one dispatcher with an operation enum.**
The largest saving available and ruled out already: `CLAUDE.md` records that a
write tool which is not granted is *absent*, not registered-and-refusing,
because "a tool that exists is a tool a model will try, and a refusal in a tool
result reads as an obstacle to route around." A dispatcher exists always.

## Also on the table, and separable

Neither depends on this record.

- **Deduplicate the JSON schemas.** `preview_onenote_edit` is 2,734 characters
  of schema largely because `changes` re-declares the change shape beside the
  top-level `action`/`html`/`element_id`/`position`. JSON Schema `$defs` says it
  once. Purely mechanical, an estimated 1,500–2,500 characters, and it survives
  whatever happens to this record.
- **Merging the four attachment tools into two.** Worth about 2,500 characters
  and probably not worth taking: the Gmail pair carries `EVIDENCE_GATE` and the
  page pair deliberately does not, because a file on a page the musician just
  asked about is not a second look into their mail. Merging turns a per-tool
  permission boundary into a conditional sentence inside one description.
