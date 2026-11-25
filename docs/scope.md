# Scope

What this project is, what shipped, what is deliberately out, and what is
deferred. The setup checklists and the architecture snapshot that this file
began as are in [history.md](history.md) — they are a record of how it was
built, not a description of what it is.

## What it is

A multi-tenant web app where a user connects their Microsoft account, plus an
MCP server — published to npm — that reads that user's OneNote notes and applies
musician workflow playbooks. One OneNote page is one working unit, and every
result stays in Claude or Codex chat. Reading is the default; five write
capabilities exist and each is granted by name at install time.

## What shipped

The last stale entry here is corrected in place rather than quietly dropped, so
the correction stays visible.

- [x] Installable Markdown pack with Orchestrator, Archivist, Registrar, Project Manager, Envoy, Auditor, and Janitor roles
- [x] Starter project types: Concert, Large Concert, Studio Session, and Rehearsal
- [x] One OneNote page treated as one working unit
- [x] Registry generated during package build with SHA-256 checksums
- [x] Results shown only in chat; no send, sync or background execution capability. This originally also said "no write" and "no calendar": five write capabilities have since shipped, each opt-in per install — see "Not in scope" below.

### Playbooks a user can edit — beyond the original brief, deliberate

The brief said the pack is installable, not that it is the user's to change. It
became worth doing once the playbooks were the thing being tuned per musician:
a fixed pack means every adjustment is a package release.

- [x] Two installs and nothing between them: the default runs the shipped checksummed pack, and `init --editable [directory]` copies all of it somewhere the user owns, where every playbook is theirs — per-file opt-in was built first and removed, because it kept ids tracking the package only by making the user remember which files were theirs
- [x] The editable install is re-runnable, which is what replaces that bookkeeping: playbooks new in a later version are added, edited files are left alone and named in the summary, and nothing is ever overwritten — verified on a seeded directory with one file edited and one removed to stand in for a new release
- [x] `init --editable` records an absolute path in the Claude Desktop entry's args and seeds before writing the config — verified: a directory it cannot use fails with the config byte-for-byte untouched
- [x] Local entries shadow the bundled pack by id, so an edit to one project type neither forks the other sixteen nor blocks a playbook added by a later version
- [x] `agents status [directory]` prints every entry with its source, and `list_agent_workflows` names the entries that are the user's own, with the file to edit, so a transcript never presents edited rules as shipped ones
- [x] A playbook that cannot be read is reported as NOT IN FORCE rather than falling back to its one-line summary — the old behaviour dropped a project type from the classification silently, which is what this layer exists to prevent
- [x] The layout is exact — `<.artist|artist>/<roles|project-types|policies>/<name>.md` — and a misfiled file is refused by name rather than silently becoming a policy; a standalone directory gets the visible container so the folder does not look empty in a file browser
- [x] A missing or broken local directory fails loudly rather than falling back to the bundle the way an unreachable remote registry does
- [x] Files capped at 64 KiB, empty files refused, paths contained against the local root
- [x] Derivation shared by the build script and the runtime, with a test asserting the committed registry still matches it — two copies would give the same file different ids, and a user's edit would then shadow nothing
- [x] Policies that must hold unprompted load in full, not as summaries: `answering`, `evidence`, `divergence`, `patch` alongside `intake`. Found the hard way — the rule protecting the user's mailbox lived in `AGENTS.md`, which the server never loads, and a Desktop session read Gmail and Calendar unasked. A rule in a role is not in force; see "Editing the pack" in `docs/agent-pack.md`
- [x] The MCP handshake tells the client to load the playbooks, so they are in force on a client with no repository to read `AGENTS.md` from — which is Claude Desktop, the surface `init` configures. Without it `list_agent_workflows` was a tool nothing called, and a session read the notebook, reasoned well, and followed no policy at all. A day of testing was spent diagnosing playbook wording on that basis; the stdio test fails without the fix
- [x] `AGENTS.md` restates no rules. It is the one copy nothing checksums and nothing loads, and every summary in it drifted — three always-loaded policies after there were five, and phrasing `policy:divergence` was rewritten to forbid, months stale. It now names where the rules are and stops
- [x] `policy:patch` closes the loop from an agreed recommendation to the page: the smallest fragment that records the decision, the destination named as the page words it, unsettled fields left `UNKNOWN` including the cells beside the one that changed, and never a claim the page was updated. Verified in Claude Desktop against the messy notebook — a cross-reference offered unprompted on a suspected twin and adapted to a pair whose identity facts conflict, and a consolidated page carrying two settled values with the two the musician was unsure of left `UNKNOWN`, every fact naming its source page, both originals untouched. Each pasted into OneNote with its bordered tables intact
- [x] Constraints on when a tool may be called live in the tool's own description, not only in a playbook — `list_events` described the calendar as corroborating "what a page claims about a date", and a model facing two pages disagreeing about a date read that as an instruction while the policy forbidding it was loaded and lost
- [x] Verified end to end in Claude Desktop, following the documented four-step workflow against a deliberately messy 11-page notebook holding three planted near-duplicate pairs: pages listed, each classified with evidence (a three-line page called too thin rather than labelled, two pages named as supporting evidence rather than working units, a wedding named as a missing playbook rather than forced into Concert), three HTML templates derived one per matched playbook with every field UNKNOWN and no page data in them, and the messiest page filled onto its template with 64 gaps left visible, a disputed seat count carried as disputed with both sources named, and a computed rehearsal date kept out of the artefact and marked in chat as worked out. No Gmail or Calendar call at any step

- [x] Hosted runs the custom pack, layered over the bundled one by the same shadow-by-id mechanism a musician's own directory uses: `route.ts` sets `ARTIST_MCP_AGENTS_DIR` to `vendor/artist-pack`, resolving to 21 entries at the time — the 17 bundled ids shadowed and four project types added (23 since `policy:tasks` and `role:digest`). The pack's own repository is private, so a submodule would make the deploy depend on Vercel holding credentials for it and fail the build when it cannot clone; `scripts/sync-artist-pack.mjs` vendors the Markdown in at a recorded commit instead, and an edit there reaches hosted only once synced, committed and deployed. Verified against the real resolver, and the deploy trace confirmed to carry the directory. Note what this is not: pack resolution is process-wide, so this is one pack for every hosted caller, unlike tokens and write grants, which are per request

- [x] `list_notes` takes an optional `section`, the first step of resolving a chat update to one CL Aufgabe page (#193): only that section's pages are fetched, the reply states the section's full page count (or that it hit the 100-page listing cap, #178), and a name that matches nothing, or matches in two notebooks, is refused with the closest names rather than read as a project without a page. Matched on the whole name, ignoring case and runs of whitespace. Verified live against a 56-section, six-notebook account, which is what found the doubled-space section name and the over-broad "closest" list; both are fixed and tested. Optional, so a client holding the old schema keeps working and simply cannot use it until it refetches the tool list. Without `notebook`, on an account with several (one per season), section names are searched across every notebook at no extra Graph cost: pages come back only for a single exact match, the reply names its notebook and any similarly named section in another season (found live: `Montepulciano` beside `Montepulciano 2028`), and a name in two seasons or a partial name is sent back to the user with the notebook_key. The reply also names the section's CL Aufgaben page as the update target, matched on the title's start because the live titles vary, found across the whole section before `limit` trims it; none and several are both said outright, and other `CL` pages are not mistaken for it

- [x] Discovery has two paths ([0010](decisions/0010-two-discovery-paths.md)): `list_notes` on a notebook returns its sections from one request, with pages only for a named `section`, and `map_notes` stays for surveying an unfamiliar notebook once, now also per section. OneNote allows 400 requests an hour per app per user, and a notebook-wide walk spent a request per section on every call; a project question now costs about three. Verified live: a notebook's sections for one request

- [x] **`since` narrows the walk, not just the answer.** `list_notes` and `map_notes` with `since` drop every section dated before the cutoff before its pages are listed, instead of listing the whole notebook and filtering afterwards. Sound because a section's timestamp moves when any page inside it changes, a control recorded on `narrowSections`: a section dated earlier holds no page that changed later. Sections with no date are still listed, a named `section` is never filtered, and when nothing changed the answer says so from section dates — on either kind of account — rather than the page-level "this is not evidence that nothing changed". Why it matters: OneNote allows 120 requests a minute and 400 an hour per app per user, requests inside a `$batch` count one by one, and a full sweep of the three season notebooks measured about 270 on 2026-11-21. Verified live the same day on the 2026-27 notebook: "since 2026-11-14" cost 6 Graph requests instead of 31, and "since 2026-11-20" 4, with the same answer and creation-date detection still firing on the narrowed walk. Tested at request level, and the tests fail with the filter removed. It is the cheap path the daily digest will stand on; it does nothing for a question with no date

- [x] **A named notebook lists only its own sections** ([0016](decisions/0016-one-notebooks-sections.md)). The account hosted serves has 429 sections, and Graph returns 100 a response with no next link, so every call naming a notebook first made five section requests in a row: about 23 s of a hosted map's 45, inferred from the map's `deadline=` and the per-request time. A notebook named with its key now costs its names and a listing filtered to its id, two requests whatever the account's size. The filter rather than `/notebooks/{id}/sections`, which omits sections inside section groups. A key that does not prove against those names (an account with an empty notebook) falls back to the full listing. Tests assert the URLs and fail with the narrow path disabled; live locally it returned the same 30 sections for 2026-27. **The first deploy (#259) made hosted slower**: the map got 7.0 s instead of 11.9 s, because the key was issued from section-derived names and checked against the notebook listing's, so every narrow call failed its key and paid for the full listing too. The key now has one source on both paths, the notebook listing, and the question fetches it alongside the sections in parallel; empty notebooks now show with 0 sections. Tests cover an empty-notebook account end to end and fail with the old key source. **Verified on hosted after #260**: one notebook listing, and the map handed 27.7 s of its 45, against 11.9 s before 0016 and 7.0 s on the broken deploy

- [x] **`map_notes` returns by its deadline even when a request stalls.** Its first hosted run after #255, on the 30-section 2026-27 notebook, died at Vercel's 60 seconds and reached the client as "Internal error": listing took 27 s from `iad1` (10 s from Europe on the same code), the map was given the remaining 18 s, and its closing log line, written even on failure, never appeared — a request it had already sent was still open 33 s later. Microsoft refused nothing and the pacer did not fire. The deadline was checked only before work started; now a started preview batch or fallback read is raced against it, and one that loses is reported as not reached, abandoned rather than cancelled, its late failure caught. Tests stall a batch and a fallback forever and require the map back on time with every page counted, and fail with the race removed. Functions also moved from `iad1` to `lhr1`, next to Supabase (eu-west-2) and European Microsoft data; see [operations.md](operations.md). That half is verified: after #257 the same listing took 9 s on hosted. **The map itself still fails there.** The re-run died at sixty again, with no closing line, so the deadline never got to act and the hang sits outside it — before the map, most likely in the hosted token lookup, the only thing the dispatcher does first, whose Supabase reads had no timeout. Not proven: hosted logged nothing about lookups. So the next promotion adds evidence and backstops rather than a claimed fix — a line per hosted token lookup with its source and time, a line when a map starts, an 8 s timeout on the lookup's reads (never on the exchange or the write storing its result, which would lose a rotated refresh token), and a 52 s budget on each hosted request's reads, after which a read is reported as out of time by name instead of a 504. Writes are outside the budget, since one abandoned mid-flight may still land. Tests hang a lookup and require the budget to answer, and fail with it removed. After #258 the same call **returned** on hosted: 20 pages sketched, 5 read in full, none unreached, the map itself 4.9 s. Every token lookup came from the store in 69–89 ms, so the lookups were not slow this time — and the hang did not recur, so its cause is still unproven; the lines are now there to name it if it does. The new lines also show where the budget goes: the map was given 11.9 s of its 45, so about 33 s were spent before it, 10 s of them listing the sections and most of the rest, by elimination, in `list_notebooks`, which takes about 4 s from here. That share is what decides whether a map completes on hosted, and it is not measured directly yet

- [x] **OneNote requests are paced per user, under the per-minute limit.** The September cap of four in flight bounds concurrency, not rate: on 2026-11-21 a 221-page sweep ran at about 127 a minute and drew 429s, each of which also counts against the limit. Every OneNote request — reads, each request inside a `$batch`, page and section creation, page edits, retries included — now takes a slot in a sliding one-minute window of 100 (`ARTIST_MCP_ONENOTE_PER_MINUTE` overrides), and waits for one rather than being refused by Microsoft. A wait past 8 seconds, the throttle budget's ceiling, ends in a plain "pacing, try again in about a minute" instead of running into the hosted 60-second limit. The window is per user, never per process: the dispatcher binds every Microsoft token it resolves to a pacing key, and hosted passes the user's id, so one user's survey cannot slow another's read. Keying on the token was the first version, and the live run found it wrong — `accessTokenFor` fetches a fresh access token for every operation, so each operation counted as a new user and a 60-second window reached 133 requests with the pacer in place; the unit tests had reused one token. Verified live after the fix, at a budget of 10 a minute so as not to spend the hour twice: 10 requests reached Microsoft across separate operations with separate tokens, the next four were paced, and no 429s. Approximate on hosted, where serverless instances do not share memory; the hourly 400 is not paced. Tests cover pacing, users kept apart, the ceiling, batches, and a dispatcher minting a token per operation, and fail with the binding removed

- [ ] **Creating a section** ([0011](decisions/0011-creating-sections.md)): `onenote-create-section` registers `create_onenote_section`, one empty section in a notebook named from `list_notes`, under the same `Notes.Create` boundary as creating a page. Built in #235; hosted users holding `onenote-create` were given it by migration. Not ticked: no live run is recorded, here or on the pull request
- [x] **An append to a page commits in one call** (0015's first step, which [0014](decisions/0014-tasks-on-map-notes.md) depends on). `edit_onenote_page` needs a `confirmation_token` only for a replace or an insert; a change made only of appends is one `PATCH` with no preview, no token and no read of the page first, and a batch mixing an append with a replace or insert still needs the token for all of it. The result says what was added and that it is removed by hand. Accepted, by the owner's decision: a retry after a timeout in which the write landed appends twice, left until it is seen to happen. Existing grants kept, as in 0009. Tests cover one call with one request, a token ignored on an append, batches, and a mixed batch refused, and the mixed-batch test fails with `every` changed to `some`. The tool list grew by about 300 characters with `onenote-edit`. Verified live on 2026-11-21 by driving the rebuilt dispatcher against the `artist-mcp live test 0009` scratch page: the append landed with one Graph request (the `PATCH`, nothing read first) and read back on the page, its write-log line has no pre-image, and a replace and a mixed batch without a token were both refused with no request made. The custom pack's `policy:patch` (vendored at `fb26aa6`) now lets an automation append to a project's CL Aufgaben page and nothing else, confirmed loading through the resolver from `vendor/artist-pack`. **Verified on hosted after #261**, through ChatGPT: a page created in `Claude Test` (2026-27), then one line appended to it with no token and no preview; the result named what was added and how to remove it, and the request logged one token lookup and no page read. The local `test` notebook could not stand in, because it is in a different Microsoft account from the one hosted serves. The scratch pages `artist-mcp live test 0009` (local) and `artist-mcp hosted append test` (hosted, in `Claude Test`) are for deleting by hand

- [x] **`map_notes` reads tasks, one CL Aufgaben page per section** ([0014](decisions/0014-tasks-on-map-notes.md)). `tasks: true` reads only the page the update-target rule names in each section, and returns its to-do tasks in the page's words: a task in a table with the rest of its row labelled by the header row, a task on a line (including lines the digest appends) as that line, the opening prose up to the first task capped at 400 characters, and done tasks counted unless `include_done`. A section with no CL Aufgaben page or with several reads nothing and is named; a page cut off by the deadline is named as unread; a page with no tags, a task table with no header row, and an untagged table headed as a task table are each said rather than dropped; `since` skips sections by date and says that their tasks, including any coming due, are missing. Tests assert which pages are fetched and fail with the title filter or the deadline race removed. Verified live locally on 2026-11-21 against the three season notebooks: 80 OneNote requests for 28 pages against an estimate of about 93, 175 open tasks, and zero mismatches against an independent count of open tags in the same HTML. The first run found 30 false notes from one-cell prose tables, now fixed. **Verified on hosted after #261**, through ChatGPT, with the same counts as locally. 2026-27: 30 sections listed in 14.3 s, leaving the tasks read 27.0 s, which read all 24 pages in 13.4 s. 2027-28: 11 sections in 4.6 s, 4 pages in 2.0 s. 2028-29: 5 sections in 4.3 s, no CL Aufgaben page. Nothing was reported as not reached, and the largest notebook finished about 14 s inside its budget, so no cursor is needed yet. The listing, not the page reads, is still the larger share on hosted. The tool list grew by about 360 characters. **Delegation added the same day**: handovers come back under "Delegiert", counted as done with who has them, from delegation-table rows (template placeholders ignored) and from ticked lines naming the person (the custom pack's `policy:tasks` sets that wording); verified live on Mittersill's four and Montepulciano's placeholders, not yet on hosted

- [ ] **The daily digest playbook** (`role:digest` in the custom pack, vendored at `c3a3d5c`; 0014's maintenance half; its prompts are in the pack's `prompts/digest.md`, never vendored). One tasks read per season notebook, without `since`; one mail search — the CL Aufgaben pages' correspondents OR any mail carrying a user label, matched to a project by the model — read as threads; each thread is a new task (appended under one "Neu, automatisch ergänzt" heading per page, tagged, with deadline only as the mail states it and its source), a change to confirm (never written), already there, or nothing, and an unmatched thread is listed rather than dropped. Missing CL Aufgaben pages are created only when the prompt says creating is on, at most three a run; the first pass is watched. The lookback is the previous scheduled run plus a day of overlap, since nothing is kept between runs and ChatGPT's memory of earlier runs is not documented as reliable; every digest ends "Post gelesen ab <Datum>", and a date in the prompt overrides the default. `policy:evidence` now says an automation the musician set up has already asked for exactly the looks its prompt names, which the digest's mail search and reach across notebooks otherwise break. **Rebuilt around Ruben's own views on 2026-11-22**: daily Zu klären, Heute, Neu (including the sections changed since the lookback, from section dates, since this account reports page creation dates), Warten / delegiert, Fristen, Projekte and Nicht gelesen; Menschen, the full Fristen and Tätigkeiten on request, Tätigkeiten saying it waits on `CL Aufgaben-Kategorien` deciding column or tag. Run once in that shape, watched: sections in order, duplicates recognised, nothing written wrongly — and two design faults, fixed at `c3a3d5c`: overdue tasks past Heute's cap fell out of the digest because Fristen only looked ahead (Fristen now opens with Überfällig), and Neu reported the digest's own rows as changed sections, which section dates cannot tell apart (changed sections removed from Neu, saving about 20 requests a run). **First watched run on hosted, 2026-11-22**, through ChatGPT after #262: the tool order the role sets (workflows, the role in full, one `list_notes`, three tasks reads with no `since`, one mail search), all 28 pages read with nothing cut off (2026-27 listed in 9.3 s and read in 11.0 s of 31.0 s), every unread section named, and "Post gelesen ab 20.11.2026". The mail search found nothing over a weekend, so no append was proposed and **the append path is still untested**. The run found one rule lost while loaded: an open task whose status said "an Agnes weitergeleitet" was reported both overdue and delegated, and a dozen "OFFEN — vermutlich erledigt" rows as overdue, although `policy:tasks`, in force in full, calls both unsettled. Moved into the output: tasks mode marks an open task UNSETTLED, in its row's words, when the row says done, handed on to a named person, or UNGEKLÄRT — "nur an die eigene Gmail weitergeleitet" and "noch nicht erledigt" are not — and a bare ERLEDIGT status beside an open tag is a stale cell with the tag standing. `role:digest` (at `9f8e6bd`) leads with those and lists them nowhere else. Live on 2026-27: 18 rows marked, all genuine, none wrongly. **A second watched run on hosted, reading mail since 01.11.2026, again found no mail at all** — not credible over three weeks. `list_emails` cut every query at 500 characters, silently, and the digest's search is an OR group of about twenty counterparts with `has:userlabels} after:<date>` at the end: the cut took the bounding terms and left Gmail an unbalanced brace, while the reply echoed the whole query. Shown locally: one OR group found 17 messages at 64 characters and 0 at 1,225 with its matching term past 500. A query is now sent whole up to 2,000 characters, and refused beyond that with a request to split it, searching nothing. After the fix the same 1,225-character query finds the 17. That the hosted query passed 500 is inferred from its shape, not seen; the next watched run is what confirms it. **It did**: the third watched run filled the 25-message cap, split its search by project as the role says, and proposed its first append, to Essen's CL Aufgaben page — a heading and two tagged lines with their source, a probable duplicate held back as *zu bestätigen*. Read back locally: an `<h2>` and two `<p data-tag="to-do">` after the last table, read by tasks mode as open, nothing else changed. The run was then stopped by the owner, who wants new tasks in the table itself; see [0017](decisions/0017-appending-a-table-row.md), proposed after a round-trip test that found OneNote silently drops every to-do tag on a table sent back as it reads it

- [x] **A task row is added to the table by the server** ([0017](decisions/0017-appending-a-table-row.md)). `edit_onenote_page` with `append_row` takes a table id and new rows as cells by header name, and the server does the rest: reads the table, refuses one holding anything but text and tags (an allowlist — the owner's rule for task tables) or lacking a task column, translates the read-back markup into what OneNote accepts, adds the rows, writes with `If-Match`, records the table as it was, and reads the page back to check every existing row. Commits in one call, unattended too; existing grants kept. The round trip that shaped it: sent back as read, a table lost every to-do tag and every border without an error. Verified live locally on the scratch page, two appends, the tick and borders intact; `role:digest` uses it from `2a100b2`. The tool list grew by about 620 characters with `onenote-edit`. **Verified on hosted after #265**, in a watched digest reading mail since 01.11.2026: four rows proposed as cells and added with `append_row` after a yes, to Essen (2), Vidala and Rheingau. Each page read back locally against the same morning's tasks read: every earlier task unchanged in wording and tag, the new rows open in the task table with their source, and the UNSETTLED marks on old rows still in place. The run's own mail search was 646 characters, which confirms the 500-character cut as the cause of the earlier empty searches. Some of its split searches failed on Gmail's quota and were retried by the model, with nothing in the hosted logs: Google signals a per-user rate limit as a 403 naming `rateLimitExceeded` or `userRateLimitExceeded` as often as a 429, and only the 429 was retried or logged. Now both are, within the same backoff budget, while a scope 403 and a daily limit still fail at once; tested, the test failing with the 403 handling removed. Each search fetches up to 25 messages' details, so a long lookback is costly there

- [ ] **Undo, then unattended changes to a task row** ([0018](decisions/0018-undo-and-unattended-row-updates.md), proposed 2026-11-23): the build plan for 0015's OneNote half — a two-phase write log that can be read back, a server-built `update_row`, `undo_write` at row level, and only then a digest that ticks or re-dates a task on explicit mail evidence. Step 1 built and verified locally on 2026-11-23 — appends and `append_row` record a pending line with the pre-image before writing and are refused if they cannot, the log reads back locally and through a new hosted `writes_for`, and the migration was exercised on a throwaway Postgres 16. Its migration was applied to production first, on 2026-11-23, and checked there: grants, columns and existing rows as intended. Step 2, a server-built `update_row` for a tick or a cell, built and verified live locally the same day, behind a preview until undo exists; the tool list grew by about 930 characters with `onenote-edit`, mostly its three parameters on two tools. Step 3, `undo_write` for an added row, a changed row and an appended line, built and verified live locally the same day, refusing whenever the target no longer reads as written; decision 4 (the tool may remove its own unchanged additions, never a page) recorded in `CLAUDE.md`. **Verified on hosted after #270**: an append and its undo through ChatGPT, a second undo refused, and production's `write_audit` holding exactly the append's and the undo's pending and done rows. `update_row` then dropped its token and commits in one call, verified locally; it is still not allowed unattended until step 4. Step 4 decided and written into the custom pack (at `8060dc6`): a scheduled run may set a Frist a mail states in so many words, at most five a run, each with its write id — and never ticks, by the owner's decision, because an open task wrongly marked done drops off every list. `update_row` now refuses a tick that leaves a Status column behind. Not yet run; decision 5 (pre-image retention) open
- [ ] **Retiring the previews** ([0019](decisions/0019-retiring-the-previews.md), proposed 2026-11-23): the rest of 0015 — first a pure split of `onenote-patch.ts`, then replace and insert on OneNote, then calendar edit and delete of another's event, each commit in one call once it records before writing, guards stale state without a token, and has an `undo_write`; then `preview_onenote_edit` and the tokens go. Unattended writes unchanged. Step 0 done 2026-11-25: `onenote-patch.ts` split into the editing core (1,811 lines), `onenote-rows.ts` and `onenote-undo.ts`, with no behaviour change; the suite passes with only import lines changed, and the boundary guard now scans both new files. Step 1 built 2026-11-25: replace and insert record a pending line (pre-image, what is written, write id) before the `PATCH` and are refused if they cannot, tested; a Microsoft disconnect forgets that user's OneNote lines locally and, through migration `20261125130000`, on hosted, exercised on a throwaway Postgres 16 and applied to production on 2026-11-25. Step 2 built 2026-11-25: `edit_onenote_page` takes `expect` (the element's text, or a table's rows, as read), re-checked against the page before the write and refused whole with what it reads now; optional until step 4, while the token is still required. Step 3 built 2026-11-25: `undo_write` removes an inserted paragraph or heading and puts back what a replace overwrote, a whole table included, each found by what was written and refused once edited since; tested, and verified live locally on the 0009 scratch page (paragraph, insert, whole table, a refused undo under a later edit, a stale `expect`). A test that leaked pending lines into the developer's real write log was fixed on the way. Step 4 built 2026-11-25: `preview_onenote_edit` and the edit token removed, `expect` required for a replace or insert, the border attribute added and a header-row rewrite refused with the house shape, `read_note` gained `all_parts`, and the grant text, bundled `policy:patch` and `CLAUDE.md` updated; the tool list with `onenote-edit` is 25,407 characters, down from 30,188 before 0019. The custom pack's `policy:patch` and `policy:tasks` followed (`8e8e7f6`, synced into `vendor/artist-pack`). Step 4 verified live locally on the 0009 scratch page the same day: a one-call replace, both refusals, the border taking effect, the header rule on OneNote's own markup, `update_row` showing before and after, each undone. Shipped with #278 and verified on hosted the same day through ChatGPT: an append and a one-call replace with `expect` on a new `Claude Test` scratch page, both undone, and production's `write_audit` holding each write's pending and done rows, the replace's pre-image recorded before the write. Decisions taken 2026-11-25 for the OneNote half: the musician's request is the yes, asking first only for a derived change or an ambiguous target; `onenote-edit`'s text loses "after showing" and existing grants are kept (one hosted holder); a Microsoft disconnect forgets that user's OneNote rows, no retention window yet (about 10 MB a year per musician, remedy recorded); elicitation (#155) is not a gate. The calendar half waits on [0022](decisions/0022-google-requires-mcp-for-agents.md)
- [x] **A section name passed as `section_id` is refused with the way that works** (found 2026-11-25 on hosted, during 0019's check). Asked to create a page "in Claude Test", ChatGPT passed the section's name as `section_id` and got only `section_id is malformed.`, then guessed its way to `source_page`. The cause is that no tool lists section ids: `list_notebooks` names sections, every other id a tool prints is a page's, and only `create_onenote_section` returns one, for a section it just made — while the schema said to pass `section_id` "when the musician named a different section". The refusal now says the value is not an id (a name, where it has a space), that only `create_onenote_section` returns one, and to pass one of the section's pages as `source_page`; the schema says the same. Tested before any request, failing with the old refusal. Not fixed: a page cannot be created by name in a section that has no pages yet, which would need `create_onenote_page` to resolve a section by name.

Checksums mean something narrower for a local file: derived from the directory as
it is read, they prove only that it did not change between being listed and being
loaded. The user is the authority on their own files. **The boundary does not
rest on the Markdown** — an edited playbook can make the analysis worse, but it
cannot reach a tool that was never registered.

That sentence used to read "it holds because no write tool exists". It does not
hold that way any more, and the weaker true version is worth stating plainly:
the boundary is a capability check plus a closed operation union, both of which
are this repository's own code rather than something Google enforces. See
[decisions/0001-opt-in-calendar-writes.md](decisions/0001-opt-in-calendar-writes.md).

## Opt-in Calendar writes (issue #85)

Off by default. A grant at install time, one event, previewed and confirmed.
Decisions and their cost: [decisions/0001-opt-in-calendar-writes.md](decisions/0001-opt-in-calendar-writes.md).

- [x] A decision record written before any code, because `CLAUDE.md` told a
      contributor to stop on seeing a write and would otherwise sit beside the
      new behaviour with no way to tell which was current
- [x] The operation table is enforced, not asserted: `test/operation-boundary`
      fails on any edit to it, and on any non-GET beyond the single sanctioned
      POST. This matters more than it reads — Google publishes no insert-only
      Calendar scope, `events.insert` and `events.delete` take the identical
      four, so the scopes stopped separating create from delete and this table
      is what replaced them
- [x] `calendar.calendarlist.readonly` added to both scope lists, guarded
      against drift, so absence can mean something: `list_calendars` names what
      was covered, and degrades to a stated limitation on a connection made
      before it rather than reporting an empty result
- [x] A 403 for a missing scope says which grant is missing rather than "this
      connection predates Calendar", which was about to be false and alarming
      for someone whose calendar reading works perfectly
- [x] The grant is one install argument naming capabilities, in the Desktop
      entry's args; an unknown name is refused by name, and `init`, `status` and
      the workflow briefing each report what is in force
- [x] An ungranted write tool is not registered at all — verified: 12 tools
      without the grant, exactly those two more with it. Those counts are what
      that run measured, before the page-attachment tools and the OneNote
      capabilities existed; the property they check still holds, against 14
      ungated tools and four capabilities today.
- [x] Preview then create, with the create bound to the previewed payload by a
      token; unsettled values (`UNKNOWN`, `TBC`, a disputed date) refused in
      code rather than only in a playbook; timed events refused without an IANA
      zone; no retry on create; a 409 reported as already there; an audit line
      per write in `~/.artist-mcp/writes.log`
- [x] The pack and the docs corrected in the same work, not deferred — every
      "read-only" claim across `CLAUDE.md`, `README.md`, `PRODUCT.md`, the brief,
      `agent-pack.md` and four pack files
- [x] Deleting, narrowed to events this tool created: the `artist` id prefix is
      the whole basis, checked before the event is even fetched, so a gig the
      musician typed in or one shared onto their calendar is unreachable. The
      confirmation token is over the event as Google returns it rather than as
      anyone described it, and the audit records the whole event, because nobody
      notices an absence. No new scope and no reconnect — Google has one scope
      for insert and delete
- [x] **Verified against a real calendar.** Not done. Every test is a `fetch`
      stub, so Google's actual behaviour for a client-set id, a 409 on a
      duplicate, and the 403 shape when a token lacks the write scope were all
      assumptions. Creating is now verified against a real calendar: the
      client-set id is accepted, the duplicate 409 is reported as already there,
      and the zone survives the round trip. Deleting is verified too: a real
      event the musician made was refused by the prefix check, a stale token was
      refused, the delete removed only what it showed, and recreating the same
      event afterwards fails because the trashed event still holds the id — now
      reported as "it is in the bin, restore it there" rather than as "already in
      the calendar", which was false and unactionable. Four bugs came out of
      running it for real: the audit sat above the write, the suite polluted the
      real audit log, the deletion preview showed a UTC instant labelled with the
      event's zone, and the duplicate message was wrong after a delete
- [ ] Verified end to end in Claude Desktop with the grant, against the
      disputed-date pair, confirming a write is refused while a page is in that
      state

- [x] **A read-only web view of Ruben's tasks** ([0020](decisions/0020-a-snapshot-of-the-task-pages.md), issue #267 phase 1, built 2026-11-23): `/aufgaben` shows a snapshot of the CL Aufgaben pages. The snapshot is stored per user, task text encrypted, and read only when Ruben presses refresh, through the hosted dispatcher. A refresh lists each notebook in one request and reads its pages in as many more as it takes, because the first live run showed one request cannot do both. Projekte, Neu, Warten / delegiert and Zu klären are built. Heute, Fristen and Menschen were built later the same day, from the `cells` map that landed with 0021. Tätigkeiten waits on `CL Aufgaben-Kategorien`. Every task links to its page, through `links` now on the page listing, and the CL Aufgaben page rule is shared from `@manudota/artist-mcp/task-pages`. Verified locally against the three season notebooks: 80 requests for a full refresh, 6 for a narrowed one, all 28 pages read. The migration was exercised on a throwaway Postgres, and the layout checked at phone width. The migration was applied to production on 2026-11-23 and checked there. **Verified on hosted after #273**: the owner signed in, chose the three season notebooks and refreshed. Production then held 24, 4 and 0 pages, none unread or pending, all 28 with both links, and 6, 7 and 5 sections without a CL Aufgaben page, the same as the local run. This amends "No copying or synchronizing source data" and "No workflow state in Supabase" below to one labelled display copy, and the dashboard now tells hosted users that `write_audit` keeps content
- [ ] **Tasks on a timeline, not in the calendar** ([0021](decisions/0021-a-timeline-from-rule-dates.md), proposed 2026-11-23, revised the same day). A Zeitplan tab in the task view, drawn from `Frist` cells, with the calendar's sliding rule applied for drawing only. The digest writes dates worked out from the six rules on `CL Projekt-Etappen Übersicht` into empty `Frist` cells on its own, in a short form such as `01.09.2026 (Regel: 2 Mon. vor Konzert)`, at most ten a run, each undoable by write id; this amends 0018's decision 3. The calendar projection of tasks is retired, so Ruben's calendar holds only events he asked for, and the calendar write tools stay for those. Today about 36 of 162 open tasks carry a usable date, and rule dates would add about 21. Bars where Ruben fills in a `Dauer` column on the rules table, markers elsewhere. An anchor may come from Ruben's calendar where no page gives one, if the event names the project and the date. The old projected events are his to clean up. Built 2026-11-23: the Zeitplan tab and the `cells` map in the shared parser, checked on the live pages (cells match on all 142 table tasks; 21 of 162 open tasks placed, 11 of them overdue) and seen at 375 px; the pack changes, synced at 0717321. Not yet: promoted to hosted, a refresh there, the new digest prompt pasted, and a watched digest run setting rule dates

- [ ] **Google requires AI tools to use its MCP servers** ([0022](decisions/0022-google-requires-mcp-for-agents.md), proposed 2026-11-24). From 1 February 2027 Gmail and Calendar must be reached through Google's MCP servers, not the REST APIs this server calls, so every Google tool here should be assumed to stop then. Google's servers cover searching and reading mail and most calendar work, but not reading attachments, and their event update has no etag guard. Separately, the Workspace AI Tools Addendum forbids keeping user data after disconnect, and a Google disconnect leaves calendar content in `write_audit` and the local write log today. OneNote and the task view are unaffected. Step 1 built 2026-11-24: a Google disconnect deletes that user's calendar entries from `write_audit` and the local write log, tested and exercised on a throwaway Postgres, migration applied to production on 2026-11-24. Step 3, the spike (`scripts/spike-google-mcp.mjs`), started 2026-11-24: sign-in and tool listing work, but every tool call is refused until the project is enrolled in the Developer Preview Program, so the preview is required after all. The live schemas show no custom event id on `create_event`, no etag on `update_event` or `get_event`, and an undocumented `RAW` format on `get_message` that may carry attachment contents. Enrolment needs a Workspace account, which the owner does not have, and Google's personal-mode quick setup is refused the same way (tried 2026-11-24), so no path open to a consumer account reaches a tool call. The preview terms also keep pre-GA features from end users outside your own domain. The owner decided on 2026-11-24 to wait for GA rather than ask Google; the spike resumes then. See 0022's Spike section. The rest waits on the owner's choice of option
## Not in scope

No autonomous agent processes run by this product. No writes to Gmail, ever. No message sending. No scheduled jobs held by this product. No teams or organisations. No billing. No copying or synchronizing source data. No workflow state in Supabase.

This line originally said "No autonomous agent processes" and "No scheduled jobs" without qualification. Both stay true of artist-mcp, which runs nothing on a schedule, but since [0009](decisions/0009-confirm-by-reversibility.md) a job someone else runs — a scheduled task in ChatGPT — can complete a reversible write without a person in the loop. Editing a page still cannot.

This line originally read "No writes to any source — not OneNote, Gmail, or Calendar", and then "No writes to OneNote or Gmail, ever". Both are corrected here rather than quietly left standing, and the OneNote half had already been stale for a release:

- **Creating a Calendar event** shipped as an opt-in, and deleting one this tool created followed. See [0001](decisions/0001-opt-in-calendar-writes.md). That line used to end "updating and moving an event are still out"; [0013](decisions/0013-editing-any-calendar-event.md) reversed it.
- [x] **Editing and deleting any calendar event, and colours** ([0013](decisions/0013-editing-any-calendar-event.md)): `delete_calendar_event` reaches the musician's own events and `edit_calendar_event` changes one in place, both behind a confirmation token bound to the event's etag, with the pre-image audited and `sendUpdates=none`. Invitations from others, whole recurring series and special event types are refused. Reads show each event's colour; create and edit set one of Google's 11. Existing grants carried over without a regrant, by the owner's decision. Verified live on 2026-10-03: a hand-made event recoloured and then deleted, each behind its confirmation, with both pre-images in the write log. Colour on create and the refusals ran in tests only.
- **Creating a OneNote page** shipped as an opt-in under [0003](decisions/0003-onenote-writes.md), which is what made "no OneNote writes, ever" stale.
- [ ] **Attachments read by their contents when the label is generic**: an attachment labelled `application/octet-stream` (Outlook for Android sends every attachment that way) or with no type used to be turned away even when it was a PDF. Now a generic label is replaced by what the file's first bytes say (`%PDF`, the image signatures, or an Office ZIP naming `word/` or `xl/`), with the extension as a fallback. The answer says "sent as application/octet-stream, read by its contents". A specific label is still trusted. This covers Gmail and OneNote attachments, maps, and pictures for a new page. Tested with stubs; not ticked until a mislabelled attachment, sent directly rather than forwarded from Gmail (which relabels on the way), is read live.
- [x] **Reading Excel workbooks**: `.xlsx` attachments, from Gmail or a OneNote page, are read through the same attachment tools as Word files, with no new dependency (an .xlsx is a ZIP of XML, read with the existing ZIP walk). Each sheet comes back under its name, one row per line. Dates are shown as dates, read from the cell's number format rather than as Excel's serial numbers. Hidden sheets are marked, a long workbook comes in parts, and the map lists sheets with row counts. A sheet that unpacks past 30 MB is refused. Legacy `.xls` is named and refused, like `.doc`. Formulas show their last saved value, and charts and pictures are not read. Verified live on 2026-10-03: a three-sheet workbook emailed to the test account was read through Claude Desktop, with dates as dates and the hidden sheet marked.
- [x] **Pictures on a new page** ([0012](decisions/0012-images-on-a-new-page.md)): `create_onenote_page` takes up to three pictures from Gmail attachments, either an image file as it arrived or a picture from a PDF, optionally cropped. The server fetches them, so the model never handles image data. Verified live on 2026-10-03: a PDF picture stored at its full resolution, a JPEG stored unchanged, a crop chosen by the model from the picture it was shown, and every source named in the write log. Word pictures, PDF text or drawing sections, OneNote-sourced images and adding to an existing page are out.
- **Editing a page this tool itself created** is opt-in under [0004](decisions/0004-onenote-page-maintenance.md), on a scope Microsoft enforces per application: a page the musician wrote is refused `401`, not merely unrequested. A replace captures what it overwrites first, because OneNote keeps no page version and that capture is the only undo there is. [0006](decisions/0006-replacing-a-whole-table.md) extends it to tables — where a filled-in page actually keeps its content — because OneNote supports no update to a `tr` or a `td` and the whole table is therefore the unit. A table is written as markup, previewed as its rows, and every cell not being changed has to be carried across unchanged.
- **Deleting a OneNote page is still out**, and not for want of a scope. A Graph delete leaves nothing in the notebook recycle bin, so there is nothing to capture and nothing to restore.

This line originally also read "No calendar. No Google. No web app deployment." All three have since shipped, so it is corrected here rather than quietly left standing:

- **Google is connected**, and Gmail and Calendar are read as **supporting evidence only** — they corroborate or fill gaps in a OneNote page and are never themselves a working unit. Reads only: `list_emails`, `read_email`, `read_thread`, `list_events`, `read_event`, and the attachment pair. That asymmetry is what kept the one-page-one-unit rule intact when the sources grew; see [CLAUDE.md](../CLAUDE.md).
- **The web app deploys** to one Vercel project, production, connected to the repository through the Vercel GitHub App. A staging project existed until 2026-09-13 and was retired with its Supabase project ([#194](https://github.com/ManudotaORG/artist-mcp/issues/194)); the `staging` branch and npm channel remain. See [operations.md](operations.md).

Each new source means re-deciding the rule, not repeating it. Google Tasks was considered and deliberately left out: a task list is a rival system of record for the work itself, not evidence about it.

## Known gaps — deferred, not forgotten

Deliberately out of the MVP. Recorded so they aren't rediscovered as surprises.

1. **Microsoft disconnect implemented and verified in staging.** The dashboard
   exposes a confirmed disconnect action backed by `disconnect_microsoft()`,
   which atomically deletes the user's encrypted Microsoft refresh token and
   every MCP key. A rollback-only authenticated staging fixture proved both
   rows disappear together and left no test user behind. The connection-key
   action is disabled while Microsoft is disconnected.

2. **Rate limiter can't limit unauthenticated callers.** It keys on the sha256
   of the presented key, so garbage keys get a fresh bucket every request. Keys
   are 32 random bytes, so this is a cost and availability risk, not a data one.
   A real fix needs shared state. Internal to the function — fixable without
   touching the `/v1/` contract.

3. **Key→user isolation was observed at the API, on a design since retired.**
   Verified 2026-08-12 against production with two real Supabase users, two real
   Microsoft accounts, and a temporary key per user, all revoked afterwards.
   Kept as a record rather than a live concern: connection keys and server-side
   token resolution are gone, so the mechanism these results describe no longer
   runs. What replaced it cannot leak between users because nothing holds both
   users' credentials.

   The results were:

   - A key resolves to its own user. A user holding no connection is refused
     — "No Microsoft connection" — rather than served another user's notes, on
     both the Microsoft and Google paths.
   - User B's page list excludes a page private to User A.
   - User B presenting User A's private page id to `read_note` is refused with
     a Graph 404. User A reading the same page succeeds, so the refusal is
     isolation, not a broken id.

   The clean-machine half is closed: the two-user test was run on two machines,
   and the published package has since been installed from npm and exercised
   directly. Neither is a database fixture, which was the original objection.

   **A shared notebook makes overlapping page lists meaningless as evidence.**
   The two accounts here shared sixteen of seventeen pages, so a naive "the
   lists must not intersect" check reports a leak where Microsoft is correctly
   honouring its own sharing. Any future isolation check needs a private page
   with a unique marker; the assertion needs a page the other account genuinely
   cannot reach, not merely a different list.

4. **One key per user.** Generating replaces the old, so two machines cannot
   hold separate keys.

5. **One Google web OAuth client serves production and local development.**
   Closed as a risk by retiring staging (#194). The concern was that staging and
   production shared one client, so a secret leaked from the environment holding
   no real data was usable against the one that did. With staging gone, the only
   other user of the client is a developer's own `localhost:3000`, holding the
   same secret production does. A second client still means a second Google
   verification review for `gmail.readonly`; revisit only if a hosted
   non-production environment returns.

6. **Email is read one message at a time, never as a thread.** Built, and
   verified live through Claude Desktop, and on hosted after #255 (2026-11-21): a Musikverein reply came back without the German Outlook `Von:` block and the history below it, both of which the `list_emails` snippet still showed. `read_thread` reads a whole conversation on the same
   `gmail.readonly` scope, oldest first. The question this entry left open —
   how to summarise a thread without pouring quoted history into chat — was
   answered by cutting each reply to what its sender added, not by
   summarising: English and German attributions and Outlook's header block are
   cut points, forwards are kept because what they carry is usually new, and
   the first message is left whole because what it quotes comes from outside
   the thread. Drafts are marked as never sent. A thread over about 24,000
   characters comes back in parts, and the partial answer says the unread rest
   may revise anything above it.

   `list_emails` now marks a reply with its thread id, and `read_email` on a
   reply points at `read_thread` — said in the output of the read that needs
   it rather than in a description every request pays for. The tool itself
   adds about 845 characters to the tool list.

   - [x] Verified live in a client: on 2026-11-21, through Claude Desktop
     after a restart onto this build, the same eight-message thread came back
     in one read with each reply cut to its sender's text and the forward
     keeping its content but not its quoted chain. Not yet through hosted
     ChatGPT, which needs a promotion. Before that, run live the same day
     against the real account by driving the rebuilt `createServer` from a
     shell. An eight-message hotel quote
     thread (English Gmail replies, a German Gmail reply, a forward inside the
     thread) and a four-message one with Outlook-sent replies came back with
     only each sender's new text. That run found three defects the stubs had
     not: German Gmail's name-first attribution ("… schrieb am Di., 27. Okt.
     2026, 22:19:", wrapped), an English one wrapped after "<", and a forward
     that brought its whole quoted reply chain along because scanning stopped
     at the forward marker. All three are fixed and pinned by tests; the long
     thread went from two reads and 29 KB to one read and 23 KB. Still open:
     signatures without a `-- ` delimiter stay in, and inline signature logos
     are listed on every reply.

   The failure it addresses, kept because it is why the tool exists: a fee,
   date, or lineup agreed in the first message and revised three replies later
   reads as settled, because the message carrying it looks complete on its own.
   Intake's rule is to surface contradictions with both sources named — a
   half-read thread hides the contradiction instead, which is worse than not
   reading the mail at all.

7. **`apps/mcp/dist/` is no longer tracked.** Resolved. It had drifted from
   `src/`: release-please rewrites the `x-release-please-version` line in `src/`
   and `package.json`, nothing rebuilt the committed copy, so on `main` at
   v1.0.1 the source said `1.0.1` and the committed `dist/server.js` said
   `0.8.0`.

   **No published version was ever affected**, which is worth stating because
   the opposite was assumed at first. The release job's test step runs
   `pnpm run build` before publishing and `prepublishOnly` builds again; the
   v1.0.1 tarball on npm was pulled and checked, and reports `1.0.1`. The drift
   existed only in git.

   What it cost was local: generated files turning up as diffs and conflicts,
   and `init --local` running stale code for anyone who checked out without
   building. Fixed by untracking it rather than by building in the release job —
   CI already builds, which is precisely why users never saw it. `files` in
   `package.json` is an allowlist that overrides `.gitignore`, so the tarball is
   unaffected; verified with `npm pack --dry-run`, and the suite passes with
   `dist/` deleted outright.

   `agent-pack/registry.json` stays tracked despite also being generated. It is
   small, reviewable, and regenerating it is part of changing executable policy,
   so a test asserts the committed copy still matches what the derivation
   produces — a review signal rather than noise.

8. **Node 20 reaches Vercel's build cutoff on 1 October 2026 — settled for the
   deployments, open for the repo's own versions.** Vercel emailed on
   14 August 2026: Node 20 is end-of-life, and after that date new builds using
   it fail. The mail named one affected project, `nextjs` in
   `highnets-projects` — **not** `artist-mcp` or `artist-mcp-staging`.

   Confirmed on 2 September 2026: `vercel project ls --scope highnets-projects`
   reports both `artist-mcp` and `artist-mcp-staging` on **24.x**. Neither was
   ever on 20, and the cutoff is no longer a risk to either deployment.
   (`artist-mcp-staging` has since been deleted, #194.) The
   version is a dashboard setting, so that command — not this repository — is
   where to read it.

   Nothing here overrides it, which is the part worth knowing. Vercel warns that
   an explicit `engines.node` in `package.json` beats the dashboard, and
   `apps/web` sets none — so whatever the dashboard says is what builds, and a
   repo change would not fix a project left on 20.

   Separately, the versions this repo names still disagree: `.nvmrc` pins
   `22.22.2`, CI, the release workflow and the Vercel project use `24`, the
   root and `apps/mcp` `engines.node` say `>=20`, and the README tells users
   "Node 20 or newer". `.nvmrc` is now the odd one out against everything that
   actually builds.
   The `engines` floor is a real compatibility promise about *users'* machines
   rather than untidiness, so raising it decides who can still install the
   package — but it currently promises support on a runtime with no security
   updates. Aligning `.nvmrc` with the 24 that CI actually uses is the smaller,
   separate half.

   Remaining action, no longer dated: decide whether `.nvmrc` should follow the
   24 that CI and the Vercel project actually run, and whether `engines.node`
   should still promise a runtime with no security updates. Nothing is failing
   on either count.

9. **Staging builds misreported their own version over MCP.** Fixed. `set-staging-version.mjs`
   rewrites `package.json` and nothing else, while `src/server.ts` carries the
   version as a Release Please `extra-file` updated on `main` only. So a staging
   build announces whatever `release` last committed: `1.0.2-staging.51` reported
   `1.0.0` in the MCP handshake, checked by pulling the published tarball.

   Same shape as gap 7 and a different mechanism, which is why fixing that one
   did not fix this. Production is unaffected — Release Please updates both files
   together — so this only misleads while testing staging, exactly when the
   version is what you are trying to confirm.

   The script now sets both, matching the `x-release-please-version` marker
   Release Please looks for, and throws if that marker is missing rather than
   skipping — a silent skip is what produced the bug. It rewrites files in CI
   before the build, so the value reaches `dist/` and the tarball and is never
   committed. Verified against the real package: `1.0.2-staging.99` landed in
   `package.json`, `src/server.ts`, and the built `dist/server.js`.

   The next staging publish is the first that will report itself correctly; worth
   a glance then, since this gap was found by checking a tarball rather than by a
   test.

