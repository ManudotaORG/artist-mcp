# 0023 — Ruben ticks a task done from the task view

Status: **accepted 2026-11-25** with every open question settled as
recommended, **built the same day, verified on hosted on 2026-11-28** (see "Built" at the
end, including where the build departs from what is written here). Phase 2 of
[0020](0020-a-snapshot-of-the-task-pages.md) (issue #267), which left acting
on a task undecided until 0015's undo existed. It exists now:
[0018](0018-undo-and-unattended-row-updates.md) built `update_row` and
`undo_write`, and [0019](0019-retiring-the-previews.md) made a replace commit in
one call behind `expect`, undone by `undo_write`. This record adds no write
the tool cannot already make. It adds a second place a person can ask for one.

## Why

The task view shows Ruben 162 open tasks across 28 CL Aufgaben pages. When he
sees one that is finished, he has two ways to mark it done today. He can open
the page in OneNote, find the row, tick it and change the Status cell. Or he
can say so in a chat, which then reads the page and calls `update_row`. Both
take him out of the view he was using to decide. A tick box beside the task is
the obvious thing, and 0020 deliberately left out "even disabled ones" until
this was decided.

## What this does, and only this

**A click ticks one open task done, in one call, and offers to undo it.**

- **Ticking only.** No reopening (`done: false`), no handovers, no wording
  changes, no Frist, no other cell beyond the Status cell the tick requires.
  Each of those is a later decision. Reopening is left out because the view
  shows open tasks, so a done task is not there to untick. "Rückgängig",
  right after the tick, covers the mistake that matters: the wrong box.
- **Attended.** A click is Ruben's request, and by 0019 decision 1 the
  request is the yes. There is no confirmation dialog, because there is no
  derived change and no ambiguous target to ask about: he chose the task, and
  the change is fixed. The view is not an automation, and nothing here
  changes what an unattended run may do. 0018 decision 2, *ticking stays
  Ruben's*, is kept, and this is the first surface built for it.
- **No new operation and no new capability.** The view composes operations
  the dispatcher already has: a read, `update_row`, `replace_onenote_element`
  and `undo_write`. The operation table in `dispatch.ts` is not edited, so
  `test/operation-boundary` stays as it is, and no migration clears
  `write_grants`.

## The decision

### The grant, on hosted

The view is hosted-only (0020), so the grant is the hosted one: `onenote-edit`,
read per request with `writeGrantsFor(userId)`.

**The view checks the grant itself.** The task view calls `dispatchWith`
directly, not `createServer`, and `dispatchWith` checks no grant. In this
codebase a grant is enforced by *registration* (`isGranted` in `server.ts`):
a tool not granted does not exist. A server action is not a tool, so nothing
upstream would stop it. So every tick and every undo action calls
`writeGrantsFor` first and refuses without `onenote-edit`. A failure to read
the grants counts as no grant, as `writeGrantsFor` already makes it. A test
posts the action for a user without the grant and asserts that no Graph
request is made. It fails with the check removed.

**Without the grant, the view shows no tick boxes**, not disabled ones (0020's
reasoning holds: something that looks like an action invites a click). One
line at the foot of the view says:

> *Abhaken ist ausgeschaltet. Dafür braucht es im Dashboard die Freigabe zum
> Ändern von Seiten.*

It links to the dashboard's write switch. That switch grants every capability
(CLAUDE.md), so the sentence names what it is for here, not everything it
grants.

**With the grant but a token that cannot write** — a Microsoft connection made
before the scope was requested, which Graph answers with 401 or 403 — the tick
fails as in "When a tick cannot be made" below. If the same failure happens on
the scratch page during the live test, the view needs a "Microsoft neu
verbinden" line too. That is decided after the test, not guessed now.

### One tick, step by step

The snapshot holds a task's text, its page id, and for a table task its cells.
It holds no element ids and no table position, and it may be up to a day old.
So a tick never acts on the snapshot. It acts on the page as it is now, and it
uses the snapshot only to name the task.

1. **The form sends the page id and the task's key**, the `page id + text`
   key Neu already uses, not the text itself. The server action looks the
   task up in this user's own snapshot (`task_view_for`), so a browser cannot
   name a page outside the snapshot or a task that is not on it. A key that
   is not there is refused.
2. **The page is read fresh, with element ids** (`includeIDs=true`, as
   `read_note` reads it for an edit): one request.
3. **The task is found by exact text on that read**, by the same text function
   the snapshot was made with (see "The text match" below):
   - **in a table**: exactly one task row, across every table on the page,
     whose task text equals the snapshot's. Its table's id is the
     `element_id` for `update_row`;
   - **on a line**: exactly one tagged paragraph outside any table, whose
     whole text equals the snapshot's.

   None, several, or a match that is already ticked all stop here, before
   anything is written (below).
4. **The write:**
   - **A table row** goes through `update_row` with `done: true` and the
     Status cell, if the table has one (next section). `update_row` reads the
     table again, writes with `If-Match`, and checks every other row on the
     way back, as it does from chat.
   - **A line** goes through `replace_onenote_element`. The replacement is the
     element as read, with `data-tag="to-do"` changed to
     `data-tag="to-do:completed"` and its `id` and `data-id` removed, and
     nothing else changed. `expect` is the element's text as read in step 2.
     If the element holds anything the edit path would not write back
     unchanged (`validateFragment` refuses it, or a formatting run would be
     dropped), the tick is refused rather than flattened.
5. **The snapshot's copy of that one page is replaced** by a read of it after
   the write (next section but one).
6. **The view shows the task as done, with "Rückgängig"** (below).

About five OneNote requests a tick: the fresh read, `update_row`'s read,
`PATCH` and read-back, then the page read for the snapshot. A line costs the
same. The 400 an hour is shared with the refresh and the digest, so twenty
ticks in an hour is about 100 requests. The limit for that is open question 2.

The code that finds the task and builds the line's replacement is exported
from `apps/mcp`, next to `task-pages.ts`, not written in `apps/web`. 0020 kept
"which page" and "what is a task" in one place, so the view and the digest
cannot disagree. "Which element is this task" belongs in the same place, for
the same reason. Composing existing operations, it adds nothing to the
operation table.

### The Status cell: the page's own word for done

`update_row` refuses a tick on a table with a Status column unless the caller
gives that cell (0018 step 4: never a tick beside `OFFEN`). From chat the
model picks the word. Here the server has to, and it must not invent one.

**The word is read from the same table**: the Status cell of its rows that are
already ticked.

- If they agree on one word (say `ERLEDIGT`), that word is used.
- If the table has no ticked row with a Status cell, it is `ERLEDIGT`. That is
  the word `policy:tasks` names, and the one the parser's `stale_status`
  recognises.
- If ticked rows use more than one word, the tick is refused, with the words
  it found, as "In OneNote abhaken". The view does not choose between Ruben's
  own words.

A Status cell that said more than its status (`OFFEN — warte auf Agnes`) is
overwritten whole. The result line says what it said before ("Status war:
…"), and the pre-image in the write log keeps it, so "Rückgängig" brings it
back. That is an overwrite of Ruben's words on a click that did not mention
them, so it is the first thing to watch in the live test. See open
question 1.

A table with no Status column, and every line, is just ticked.

### When a tick cannot be made: "In OneNote abhaken"

Every refusal leaves the page untouched and says why in one line, next to a
link that opens the page (the client URL, as everywhere in the view):

| What happened | What the view says |
| --- | --- |
| No task with that text on the page now (reworded, moved, removed) | *Diese Aufgabe steht so nicht mehr auf der Seite.* — and the page is refreshed in the snapshot |
| Two or more with that text | *Diese Aufgabe steht mehrmals auf der Seite.* |
| Already ticked | *Schon erledigt.* — and the page is refreshed in the snapshot |
| Several words for done in the Status column | *Die Spalte Status nennt Erledigtes unterschiedlich (…).* |
| A line the edit path cannot write back unchanged | *Diese Zeile hat eine Formatierung, die hier nicht erhalten bliebe.* |
| Graph refuses the write: 401 or 403 | *Diese Seite kann nur in OneNote geändert werden.* (see "Pages this app did not create") |
| The page changed between the read and the write (412, or `expect` stale) | *Die Seite hat sich gerade geändert.* — refreshed, tick again if still wanted |
| Out of time, throttled, or anything else | *Abhaken hat nicht geklappt: …* with Graph's own message |

Each ends with **"In OneNote abhaken"**. None is retried by the server.

### Refreshing that one page in the snapshot

After a tick or an undo the task must show as done or open again without a
whole refresh. A refresh costs 7 to 85 requests and has a ten-minute cooldown,
so it is not usable for one tick. But the snapshot accepts pages only during a
refresh claim, and only those the claim's listing left pending
(`store_task_pages`). That is what keeps a browser from putting a page into it.

**A new migration adds one function**, `store_task_page(p_user_id, p_key,
p_page_id, p_tasks)`:

- It accepts **only a page already in `task_view_pages` for that user**. It
  replaces that row's `tasks` (encrypted, as `store_task_pages` does) and its
  `read_at`, and nothing else. Notebook, section, title and links stay as the
  last listing set them. A page id not already there changes nothing and
  returns 0, so it cannot add a page, and the rule that only the listing
  chooses pages still holds.
- It needs no claim and is not counted against the refresh cooldowns. It is
  called only by the tick and undo actions, after a write, with the server's
  own read of the page.
- A page read error is not stored over a good row. The old row stays, and the
  view says the page could not be re-read.
- Service role only, with both revokes, added to `hosted-custody.test.mjs`.
  RLS stays with no policies.

`read_at` then differs per page, which the status line already shows
("Stand: <oldest> – <newest>"). Neu is unaffected: a ticked task leaves the
open set, and a "Gesehen" press stores keys as before.

### "Rückgängig"

The tick action returns the `write_id` that `update_row` or the replace
recorded. The view shows the task struck through, in place:

> *~~Hotel für Montepulciano buchen~~ — erledigt in OneNote · **Rückgängig***

"Rückgängig" posts the `write_id` to an undo action. That action checks the
grant and calls `undo_write` through a dispatcher given this user's own log
(`readLog: hostedWriteLog(userId)`), so a `write_id` from another user's log
is not found. Then it refreshes the page as above. `undo_write` brings the row
back, Status cell included, or turns the line back to `to-do`. It refuses, as
it always does, if the row or line has changed since. The view then says so,
with "In OneNote abhaken".

- **The link lasts as long as the view stays open.** The `write_id` is held
  only in the page, not stored anywhere new. After a reload the tick is undone
  in OneNote. Storing it in the snapshot would make it a per-task state that
  0020 avoided, for a rare case.
- **The undo action accepts only a `write_id` whose log entry is a tick of a
  page in this user's snapshot**: an `update_table_row` with `done: true`, or
  a `replace_onenote_element` that only changed a to-do tag. So the button
  cannot undo something else in the log.

### What the view looks like

- A tick box on every open and unsettled task (an unsettled task is open as
  far as the tag goes, and ticking it is how Ruben settles it as done). It is
  not shown on handovers, which are already counted done, or on tasks of a
  page that was not read.
- At least 44 px, as the view's links are. A plain form posting to a server
  action, so it works before the page's script has loaded.
- While the tick runs, the box shows *wird abgehakt…*, and a second click on
  the same task is ignored.
- The custody sentence at the foot gains a clause: *"Abhaken ändert die Seite
  in OneNote. Jede Änderung wird mit dem vorherigen Stand aufgezeichnet."*

## The text match: the first risk to settle

The tick finds the task by its text, so the snapshot's text and the text the
write path compares must be the same string. **Today they come from two
different functions**:

- the snapshot's text is `pageTasks()`'s: `cellText` for a table cell and
  `taggedLines` for a line, both through `htmlToText` in `notes.ts`;
- `update_row` matches on `taskTextOf`, which goes through `asText` in
  `onenote-patch.ts`, and `expect` is compared through `asText` too.

The two handle `<br/>`, entities, nested spans and checkbox markers
separately. Where they disagree, a click finds no row. The same disagreement
already reaches chat, because `update_row` asks for the task "exactly as
map_notes shows it". So:

1. **Measured first, read-only**: on the live pages, every table task's
   `cellText` against `taskTextOf` of the same cell, and every line's
   `taggedLines` text against its element's `asText`, counting mismatches.
   0021 matched `cells` on all 142 table tasks, but that compared the parser
   with itself.
2. **Then made one function either way.** `update_row`'s row match and the
   tick's line match use the parser's own text function, so the two cannot
   drift later. That changes `update_row` from chat too, for the better, and
   is tested with markup from the live pages. Any mismatch found in step 1
   becomes a test.

## Pages this app did not create: the second risk

`onenote-edit` holds `Notes.ReadWrite.CreatedByApp`. Microsoft refuses an edit
to a page this app did not create (0004 verified `401`). A CL Aufgaben page
Ruben made by hand in OneNote cannot be ticked from the view at all, and
nothing in our code can change that. The view says *Diese Seite kann nur in
OneNote geändert werden* the first time, but a box that fails on every click
on that page is poor.

**Counted before the build, without a write**: the hosted `write_audit` and
the owner's local log record every `create_onenote_page`, with its page id.
The snapshot's 28 page ids against those gives a lower bound on the pages this
app created. A page with an append or `append_row` in the log was writable at
that time too. A page in neither is unknown, not refused.

- **If every page is accounted for**, nothing more is needed.
- **If some are not**, the first refusal on a page is remembered in its
  snapshot row (`writable: false`, cleared at the page's next read in a
  refresh). Its boxes are then replaced by the one line above, so Ruben is
  not invited to click again. That is one column in the same migration, built
  only if the count shows it is needed.

Moving a hand-made page's content onto an app-created page would make it
writable, but it is a migration of Ruben's own pages and not part of this
record.

## What this does not do

- Reopen a task, hand one over, reword one, change a Frist or any cell other
  than Status.
- Tick from the digest, a schedule, or anything but Ruben's click.
- Tick more than one task per click. There is no "alle abhaken".
- Delete anything. Undo of a line turns its tag back, and nothing is removed.
- Change a page outside the snapshot, or the snapshot outside the one page
  just written.
- Add a capability, an operation, or a local-install equivalent. Locally, a
  tick is still `update_row` from chat, which is the parity 0020 settled.

## How it would be verified

- **Tests, each failing with its guard removed:**
  - no grant, no Graph request;
  - a key not in the snapshot refused before any read;
  - no match, two matches and already ticked each refused with nothing written;
  - the done word taken from the table, `ERLEDIGT` with no ticked rows, and
    refused on two words;
  - a line's replacement differing from the read only in its tag, and refused
    when the edit path would drop a formatting run;
  - `store_task_page` refusing a page not already stored;
  - the undo action refusing a `write_id` that is not a tick, and one from
    another user's log.
- **The migration on a throwaway Postgres 16**: both revokes, no access as
  `anon` or `authenticated`, an unknown page id changing nothing, the cipher
  unreadable without the key.
- **The two risks, measured read-only, before any write:** the text match
  across all 162 open tasks, and the page count against the write logs.
- **Live, locally** through `apps/web` dev once a Supabase stack runs, else on
  hosted after the migration: on the scratch page, a table tick with a Status
  cell, a table tick without one, a line tick, each undone. One refused for a
  stale read (edited in OneNote between view and click). Then one real task on
  a real CL Aufgaben page, ticked and undone, every other row read back
  unchanged.
- At 375 px: the box, *wird abgehakt…*, the struck line with "Rückgängig", and
  a refusal with its link.

## Open questions for the owner

*Decided 2026-11-25: all four as recommended.* The Status cell is
overwritten whole, with its old text in the result and the log; no limit on
ticks yet; "Rückgängig" lives only in the open page; unsettled tasks can be
ticked like any open task.

1. **The Status cell**: overwrite it whole with the done word, keeping the old
   text in the result and the log (recommended above), or refuse the tick
   when the cell holds more than a bare status word, so nothing Ruben wrote
   there is replaced without him seeing it?
2. **A limit on ticks.** At about five requests each, sixty ticks in an hour
   would use most of the 400 an hour. Recommended: none at first, because each
   tick is a click and Graph's own throttling is answered with the refusal
   line. Add one, counted from `write_audit`, if a session of tidying is seen
   to crowd out the digest.
3. **"Rückgängig" after a reload**: held only in the open page (recommended),
   or stored on the snapshot row so it survives a reload until the next
   refresh?
4. **Unsettled tasks**: tickable like any open task (recommended, as ticking
   is how Ruben settles one as done), or only from Zu klären, where the row's
   own words are shown beside the box?

## Built: 2026-11-25

Built as decided, with three departures, each from reading the code or the
live pages before any write.

**Measured first, read-only**, on the three season notebooks with the local
install's tokens, in two passes. The first (63 requests) read the 28 CL
Aufgaben pages with ids, as a tick reads them, and each page's
`createdByAppId`, and found the done-word defect below. The second (34
requests) read the pages again after the fix. Nothing was written.

- **The text match is not a risk on today's pages.** Of 180 open tasks, every
  one was found exactly once by `planTick` on the fresh read: 160 table rows
  and 20 lines, none missing, none doubled. The old `update_row` match, the
  whole cell through `asText`, would also have found all 160 rows. The two
  text functions differ only in markup the pages do not hold yet, such as a
  note on a second line under a task in its cell. `update_row` now also
  matches by the parser's own text (`taggedLines`, exported from `tasks.ts`)
  when the task cell holds exactly that one task, so the two cannot drift
  apart later. A test of that case fails with the new match removed.
- **Every CL Aufgaben page was created by this app.** All 28 carry
  `createdByAppId` `WLID-000000004D91A800`, the id recorded with every
  `create_onenote_page` in the local log. Counting the logs was the plan, but
  Graph's own stamp is exact and cost one request a page. So the
  `writable: false` column described above was not built.
- **The done word is the word a Status cell opens with, not the whole cell.**
  The first measurement took the whole cell. On the live pages a done cell
  reads "ERLEDIGT — beantwortet; die Vorprobe …", so the build would have
  written that clause into every tick on that table (three tables, 43 ticks),
  and refused 26 more where two ticked rows had different clauses. The word is
  now the cell's first word (`statusWord`). On the same pages every table
  yields `ERLEDIGT`, and none is refused.

**What was built:**

- **`apps/mcp/src/task-tick.ts`**, exported as `@manudota/artist-mcp/task-tick`:
  - `planTick`: pure; finds the task and plans the write;
  - `tickTask`: read, write, read again, composed from `read_note`,
    `edit_onenote_page` and `undo_write`;
  - `isTick`: the undo guard;
  - `undoTick`.

  The operation table is unchanged. `read_note` gained an `include_html`
  parameter on the operation, not on the tool: the tool handler builds its
  parameters itself and never passes it. The write-shaped-export guard scans
  the new file, and `tick` joined its pattern, because a write named for what
  the musician does would otherwise have slipped past it, a sixth way.
- **A line's replace** sends the paragraph as read, with its tag ticked and its
  ids removed. A tagged list item, a second tag on the paragraph, or markup the
  edit path refuses all go to "In OneNote abhaken".
- **Migration `20261126120000_task_view_tick.sql`**: `store_task_page`, service
  role only with both revokes. On a throwaway Postgres 16 with every migration
  applied:
  - it replaced a stored page's tasks and `read_at`, and kept its section and
    title;
  - it returned 0 for an unknown page id, for another user naming the same id,
    and for a null read, adding no row;
  - the ciphertext held no task text, and a wrong key was refused;
  - `anon` and `authenticated` were refused the function.

  It is in `hosted-custody.test.mjs`. **Applied to production on 2026-11-28**
  with `supabase db push`, after a dry run showed it was the only migration
  production lacked. Checked there, by counts and grants only:
  - `store_task_page` is refused to `anon` and `authenticated` and
    executable by `service_role`;
  - the migration is recorded;
  - the snapshot's 28 pages are intact, each with its tasks and no error.

  The checkout was unlinked afterwards.
- **`apps/web`**:
  - `lib/task-tick-view.ts` has the grant check, the key lookup and the undo
    guard, with no `@/` imports, so `scripts/task-tick-view.test.mjs` drives it
    with stubs. Removing the grant check fails a test, and so does removing
    the tick check on undo;
  - `task-view.ts` binds them to one user: their tokens, their audit, and
    `hostedWriteLog` as the dispatcher's `readLog`;
  - `TickBox.tsx` is the box, "wird abgehakt…", the struck line with "Status
    war: …" and "Rückgängig", and a refusal with "In OneNote abhaken";
  - the tick actions revalidate nothing, so the row keeps its "Rückgängig" until
    the page is left. The snapshot already holds the page as read after the
    write, so the next load shows the task done;
  - the footer says what a tick does, or that ticking is off and why.
- **Checked at 375 px** through `/aufgaben/vorschau?abhaken=1`, on a snapshot
  built from the cached live pages:
  - 13 boxes on Heute and 20 on Projekte, each 44 × 44 px;
  - no sideways scroll;
  - without `abhaken=1`, no box and the "ausgeschaltet" line.

  The ticked and refused states were not seen, because a click needs a
  signed-in user and a database.
- `pnpm test` passes: 101 tests in `scripts/` and 802 in the package, with lint
  and the Next build.

**Verified on hosted after #280**, 2026-11-28, on a scratch page made for it:
`CL Aufgaben — Claude Test 0023 (delete me)` in `Claude Test` (2026-27),
created and filled from the local install. It holds one done row, one open
row and one open line. A full refresh picked it up (2026-27: 25 pages), and
Neu showed the two open tasks with their boxes.
- **The table row:** ticked in about two seconds. The view showed "erledigt in
  OneNote · Status war: OFFEN — Test", with no read-back warning. OneNote read
  back the row ticked with Status `ERLEDIGT`, and the done row untouched.
  "Rückgängig" put the row back, Status "OFFEN — Test" included.
- **The line:** ticked through the replace. OneNote kept its own
  `style="margin-top:5.5pt;margin-bottom:5.5pt"`, and `undo_write` found the
  paragraph by its text and put its tag back.
- **The page afterwards** read exactly as created, and a reload of the view
  showed both tasks open.
- **Production's `write_audit`** for that page holds exactly eight rows: a
  pending row before each write and a done row after it, for the tick, its
  undo, the line tick and its undo. Each pending row carries its pre-image.

**A write whose response is lost**, handled 2026-11-28 after the live run. A
timeout or a dropped connection after OneNote saved a tick looks, from the
server, exactly like a refusal, and the view used to say "nicht geklappt" for
a task OneNote held ticked. Now:
- **The page decides.** `tickTask` already re-reads the page after a failed
  write, for the snapshot. If that read shows the task done, the tick is
  reported as done, with "OneNote hat nicht geantwortet, die Seite zeigt die
  Aufgabe aber erledigt", and not as a failure.
- **"Rückgängig" still works.** The write id is in the pending line recorded
  before the write, and `undo_write` works from that line. The view looks in
  this user's own log for pending ticks of this task on this page since the
  tick began (`isTickOf`). It uses the write id only if exactly one matches.
  With none or two, it links to OneNote instead of guessing which write to
  undo.
- **A failed write that did not land** is still a refusal.

Tests cover each of those, and the guards were checked: without the re-read
check a package test fails, and without the single-match rule or the page and
task filter two web tests fail. Not seen live, because a lost response cannot
be produced on demand.

**Not verified yet:**

- One tick and undo on a real task. The scratch page is for deleting by hand.
- The "Microsoft neu verbinden" line was folded into the 401/403 refusal,
  rather than decided after the live test as written above. With all 28 pages
  created by this app, a 401 or 403 now most likely means the token's scope.

