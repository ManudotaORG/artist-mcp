# 0020 — A stored snapshot of the CL Aufgaben pages, shown on the web

Status: **accepted 2026-11-23 and built the same day** (issue #267, phase 1:
see, read-only). Verified locally, not yet on hosted: see "Built" at the end,
including where the build departs from what is written here. Builds on [0014](0014-tasks-on-map-notes.md) (the CL Aufgaben
page is the task record), [0010](0010-two-discovery-paths.md) and
[0016](0016-one-notebooks-sections.md) (where the requests go). Phase 2, acting
on a task, is not decided here and waits for 0015's undo.

## Why

Ruben wants his open tasks across projects in one place, in the views he thinks
in: Heute, Neu, Projekte, Menschen, Tätigkeiten, Warten / delegiert, Fristen.
OneNote shows him one project's CL Aufgaben page at a time. Chat can show the
cross-project views but is not something he opens on his phone and looks at.

Reading the pages live on every load is out. OneNote allows 400 requests an hour
per user, shared by hosted and the local install. The digest's three tasks reads
already measured 80 of them, and a page that read all of that on every load would
use up the hour after five loads.

## What this reverses, said rather than slipped past

This record changes three things that are currently written down as out of
scope:

- [scope.md](../scope.md), "Not in scope": *"No copying or synchronizing source
  data. No workflow state in Supabase."*
- 0014, "What this does not do": *"Store state. No index, no cache."*
- CLAUDE.md: *"a feature that ships to one custody model ships to both."*

The first two are amended to a single exception: **a read-only, labelled
snapshot of what the CL Aufgaben pages held when they were last read, kept for
display.** It is not a sync. Nothing writes back from it, nothing in it can be
edited, and it is never used as a source for a write. It is a copy in the same
sense a digest in a chat transcript is a copy. The difference is that it lives
in our database, which is why custody is addressed below. Parity holds where it
matters: no capability is hosted-only. A local install reads the same tasks with
`map_notes` and `tasks: true` in chat. Only the **surface** is hosted, because
only hosted has a server that can keep anything.

## The decision

### Where the snapshot lives, and exactly what it stores

There are three tables in `public`. All have RLS enabled and **no policies**, the
pattern every custody table already follows. They are read and written only
through `security definer` functions callable by the service role, with
`EXECUTE` revoked from `PUBLIC` **and** from `anon, authenticated` (both revokes,
see operations.md, "The grants trap"). `scripts/hosted-custody.test.mjs` gains
these functions.

| Table | One row per | Holds |
| --- | --- | --- |
| `task_view_notebooks` | user × notebook in the view | notebook name; `listed_at` and `full_at`; the sections with **no** CL Aufgaben page and those with **several** (names only); the CL Aufgaben pages the last listing found that no read has reached yet (`pending`: id, section, title, links) |
| `task_view_pages` | user × CL Aufgaben page | page id, title, section, notebook; `onenote_web_url` and `onenote_client_url`; `read_at`, the time *this page* was read; the page's `pageTasks()` result **encrypted** (below), or the read error in its place |
| `task_view_seen` | user | `seen_at`, plus the hashes of the task keys as they stood then (for Neu, below). It holds no text |

Exactly what is stored from a page is what `pageTasks()` returns: `lead`
(at most 400 characters), each task's `text`, `done`, `details`, `unsettled` and
`stale_status`, each handover's `text`, `to`, `on` and `reply`, and `problems`.
Nothing from any other page is stored, and nothing from Gmail or Calendar.
`last_modified` is **not** stored. On this account it is a creation date, and a
column called that would sooner or later be shown as "updated".

- **The payload is encrypted** with `pgp_sym_encrypt`, using the same key
  `connections` uses, passed per call and never kept in the database. With
  that, the protection that already holds for tokens holds here too: a stolen
  dump yields nothing readable. Titles, section names and URLs stay in plain
  text so the functions can index and prune them. They are already in the
  hosted logs.
- **Only the newest state is kept.** Each page has one row, replaced on every
  read, and there is no history. A page that is no longer the CL Aufgaben page of
  a section in the view is deleted at the next refresh that lists that section.
- **The snapshot is deleted** when the user is (`on delete cascade`) and when
  they disconnect Microsoft. `disconnect_microsoft()` gains the delete, so that
  disconnecting means the same thing it means today.
- **User identity comes from the signed-in Supabase session** on the server,
  never from the request body. The read functions take the user id from the
  server action, the same way `write_grants_for` does.

### Custody, and what hosted users must be told

Today a hosted user is told: *"Your tokens are stored on our infrastructure so
this works while your machine is off. A maintainer can technically read what
they reach."* That sentence covers what the tokens can reach. It does not say
that **content** is kept. `write_audit` already keeps content in plain text
(every hosted write and its pre-image), and nothing on any screen says so. That
gap exists before this record. This record closes it for both tables rather than
adding a second unmentioned one.

- **The hosted connections section of the dashboard gains one sentence**, shown
  before the first refresh and on the view itself: *"For the task view we keep
  a copy of the tasks on your CL Aufgaben pages, encrypted, until the next
  refresh or until you disconnect. A record of every change this tool makes to
  your notes or calendar is also kept, including what it replaced."* (in
  German on the view).
- **operations.md, "What is stored, and what protects it"**, gains the three
  tables.
- **The view is off until its first refresh**, and that first refresh is a
  button the user presses after reading the sentence. A hosted user who never
  opens the view never has a snapshot.

This adds no new reach. Everything stored is something the tokens we already
hold can read at any time. What it adds is **persistence**: a copy that outlives
the request. That is the thing users have to be told about.

### Refresh: how it is triggered, how often, and how it finds the pages

- **Triggered only by the user pressing "Aktualisieren"** on the view. There is
  no cron and no background job, so "no scheduled jobs held by this product"
  stays true. A page load reads the snapshot and never reads OneNote.
- **The refresh goes through the hosted dispatcher**, reads only:
  `dispatchWith(hostedTokens(userId), hostedAudit(userId), { paceKey: userId,
  budgetMs })`, in a server action. It needs no `createServer`, because no MCP
  tool is involved. It uses the same tokens, the same per-user pacing and the
  same read budget, and it calls no write operation.
- **Several server actions per notebook**, called in turn by the page: one
  that lists the notebook and stores which CL Aufgaben pages are to be read
  (`pending`), then as many as it takes to read them, each storing what it
  read. One per notebook was the first design; the first live run broke it
  (see "Built"). A refresh that fails partway leaves every page it did not
  reach at its older `read_at`, labelled as such, never blank. The store
  accepts only page ids its own listing left pending, with the listing's titles
  and links, so nothing a browser sends can put another page into the snapshot.
- **Which notebooks are in the view is set once.** The hosted account has 429
  sections, so "all notebooks" is not affordable. On the first visit Ruben
  presses "Notizbücher laden", which lists the notebooks (on the hosted
  account, about five requests, because the listing counts sections), and
  ticks the ones in the view, presumably the three seasons. The ticked ids go in `task_view_notebooks`. Changing the
  selection is the same screen.
- **Finding the pages uses 0014's rule, from 0014's code, unchanged.** Per
  notebook: its sections (two requests, 0016), each section's page listing, and
  the one page the update-target rule picks. None or several are recorded and
  shown, never guessed. That rule (`isUpdateTarget` and the walk in
  `taskDigest`) is currently private to `apps/mcp/src/server.ts`. It needs **an
  additive export** from `apps/mcp`, returning the structured pages, sections
  and reads rather than text. Then the view and the digest cannot disagree about
  which page is a project's CL Aufgaben page, just as `pageTasks` keeps them
  from disagreeing about what a task is. Where that export lives is for the
  session that owns `tasks.ts` to agree. This record does not edit either file.
- **`since` is used for every refresh except a full one.** A section whose date
  is earlier than that notebook's last `listed_at` holds no page that changed
  since (the control recorded on `narrowSections`, verified live). Its rows are
  kept as they are, each with its own older `read_at`. Only changed sections are
  listed and their CL Aufgaben page re-read. A new section has a new date, so it
  is listed. A section that is gone disappears from the sections listing, and its
  rows are deleted.
- **A full refresh** ignores `since` and re-reads every page. It runs when no
  full refresh has happened in 24 hours, and when Ruben asks for one
  ("Alles neu lesen"). This is the backstop for anything a section date might
  miss.

**Cost, against the 400 an hour shared with the digest and the local install:**

| Refresh | OneNote requests, estimated from 0014's and 0016's measurements |
| --- | --- |
| Full, three season notebooks | about 85: 1 notebook listing + 3 × 2 for sections + 46 section listings + ~29 pages |
| Narrowed, a typical day (~5 sections changed) | about 17: 1 + 3 × 2 + 5 listings + 5 pages |
| Narrowed, nothing changed | about 7 |

**Limits, enforced on the server from the stored times rather than trusted from
the client:** at most one refresh every 10 minutes, and at most one full
refresh an hour. A refused press says when the next one is possible. The worst
case, then, is one full and five narrowed refreshes in an hour, about 170
requests. That is under half the hour, with the digest's ~85 on top of it once
a morning. Hosted pacing is approximate across instances (scope.md) and the
hourly 400 is not paced, which is why these limits are counted in refreshes and
not left to the pacer.

**Not decided here: the digest writing the snapshot.** The digest's tasks reads
are the same reads and would refresh the view for free. But that means a read
tool with a storage side effect, on hosted only. Phase 1 does not do it. It is
worth a short record of its own once the view has been used.

### Neu, without per-task state

A task has no id, so its key is `page id + text`, with whitespace and case
normalised. **Neu is every open, unsettled or delegated task whose key was not
there when Ruben last pressed "Gesehen"**, compared against the hashed keys
stored in `task_view_seen`. Pressing it stores the current keys and the time.

- **An explicit button, not opening the page.** If merely opening the page
  counted as seeing, a reload, or a glance at the wrong view, would empty Neu
  before he had read it.
- **Honest limits, said on the view.** A reworded task shows as new. A task
  moved to another project's page shows as new. A task ticked and then unticked
  does not. Before the first "Gesehen" there is nothing to compare against, and
  the view says so rather than calling everything new.
- **Only hashes are kept.** The keys are compared and never shown, so storing
  their text would be a second copy for nothing.

### The views, and what `details` can honestly carry

`details` is a display string. The parser labels each cell by its header and
joins the cells with `·`, and a cell may itself contain `·` or `:`. Splitting it
back up would be a second parser, and it would go wrong on exactly the cells that
matter. The instruction for phase 1 is not to do that.

| View | From | Phase 1 |
| --- | --- | --- |
| **Projekte** | `page.section`, one group per CL Aufgaben page; sections with none or several listed beneath; read errors as "nicht gelesen", never as an empty project | **Yes** |
| **Warten / delegiert** | `delegated`: who has it, since when, and whether anything came back ("keine Rückmeldung vermerkt"); counted as done | **Yes** |
| **Zu klären** (not one of his seven, but needed) | `unsettled`, shown with the row's own words, in no other view; `stale_status` shown on the task | **Yes**: an unsettled task is neither open nor done, so it needs a place of its own |
| **Neu** | above | **Yes** |
| **Fristen** | the `Frist` cell | **Needs `cells`** |
| **Heute** | Fristen on or before today | **Needs `cells`**, and a rule (below) |
| **Menschen** | `Verantwortlich` and `delegated.to` | **Needs `cells`** |
| **Tätigkeiten** | nothing on the pages records a kind of work | **No.** Shown as a placeholder saying why |

**Requested from the parser's owner: an additive `cells` map on `PageTask`**,
`Record<header, cell text>` in the page's own words, alongside `details`, which
stays as it is. This is the route agreed in the brief, and it belongs to the
shared parser so the digest gets it too. With it:

- **Fristen** shows the `Frist` cell verbatim. It sorts only by a cell that holds
  exactly one full date (`dd.mm.yyyy`). A cell with two dates ("idealerweise
  08.09.2026, spätestens 01.11.2026"), a partial date ("Ende Oktober") or
  `UNKNOWN` goes in its own group, "Frist ohne eindeutiges Datum", unsorted,
  rather than being placed by a date the view picked. Reading a single date
  in order to sort is ordering, not judging. Calling a task overdue is
  `policy:tasks`' job, which uses the deadline rules on `CL Projekt-Etappen
  Übersicht`, and the view does not make that call.
- **Heute** is defined narrowly and says so: open tasks whose `Frist` cell holds
  exactly one full date, today or earlier, headed "Frist heute oder vorbei,
  laut Seite". It is not the digest's Heute, which the model judges. If Ruben
  wants that, it means storing the digest's judgement, which is a later
  decision.
- **Menschen** groups by the `Verantwortlich` cell as written, and separately by
  who has a handover. It is labelled "Verantwortlich laut Seite", because 0014
  found that cell often names "Büro" and means who should do the work, not that
  it was handed on. The view does not split names out of a cell or merge
  spellings.
- **Tätigkeiten** waits on `CL Aufgaben-Kategorien` deciding between a column
  and a tag, as the digest already says. No grouping is inferred: the web app
  calls no model, and a guessed category presented as a fact is the failure the
  rest of this design avoids.

Until `cells` lands, phase 1 ships Projekte, Neu, Warten / delegiert and Zu
klären, with the other four visible as tabs that say what they are waiting for.

### Every view says how complete it is

At the top of every view, always:

- *"Stand: <oldest `read_at`> – <newest>"*, or a single time when they agree,
  in Europe/Vienna;
- *"Zeigt, was auf den CL Aufgaben-Seiten steht. Aufgaben auf anderen Seiten
  fehlen, bis der Digest sie überträgt."* (13 of 42 in the 2026-11-21 sample);
- how many sections have no CL Aufgaben page or several, linked to the list;
- any page that was not read, by name.

**Every task links to its OneNote page.** `NoteSummary` carries no URL today, and
a OneNote URL cannot be built from an id. Graph returns `links.oneNoteClientUrl`
and `links.oneNoteWebUrl` on the page listing that is already made, so this
needs `links` added to that listing's `$select`. That is an additive field on
`NoteSummary`, in `notes.ts`, and costs no requests. It is a second small
request to `apps/mcp`, next to `cells`. On a phone the client URL opens the
OneNote app. The web URL is the fallback.

`problems` are shown under their project, word for word, and never dropped.

### Layout: phone first

- **One column**, readable at 360 px, with the same layout widened and centred on
  a desktop.
- **The views are a horizontal row of tabs** that scrolls sideways and sticks
  under the status line, with a count on each. Each view has its own URL
  (`/aufgaben?ansicht=fristen`), so the back button works and a view can be
  bookmarked.
- **One card per task**: the task text first, then the project, then `details` in
  smaller type, then a link at least 44 px tall, "In OneNote öffnen". Unsettled
  and stale-status tasks are marked in words, not by colour alone.
- **The status line and "Aktualisieren" sit at the top.** The button shows
  progress per notebook ("2026-27 … fertig") and why it is refused when it is.
- **Server-rendered.** The only client code is the refresh progress and the
  "Gesehen" button, so a phone on a poor connection gets the snapshot in one
  response.
- **German throughout**, because this is Ruben's view. The dashboard stays as it
  is.

## What this does not do

- Write to OneNote, or offer anything that looks like an action. No tick boxes,
  not even disabled ones. Phase 2 decides those.
- Send, notify or push anything.
- Read pages other than CL Aufgaben pages, or Gmail or Calendar.
- Infer a person, a kind of work or an urgency.
- Run on a schedule.

## How it would be verified

- Migration on a throwaway Postgres: both revokes on every new function
  (`hosted-custody.test.mjs`), no PostgREST access as `anon` or
  `authenticated` with valid arguments, a payload unreadable without the key,
  and rows gone after `disconnect_microsoft()`.
- Request-level tests on the refresh: a narrowed refresh lists only changed
  sections and keeps the others' rows and `read_at`; a vanished section's rows
  are deleted; a page read error is stored as unread; the cooldowns refuse.
  Each test fails with its guard removed.
- Neu: a reworded task is new, a ticked one is not, and nothing is new before
  the first "Gesehen".
- Live, locally against the real account through `apps/web` dev: one full and
  one narrowed refresh of the three season notebooks, with request counts
  against the table above, and each project's open count matching a
  `map_notes` tasks read of the same notebooks.
- On a phone-sized viewport: every view, a OneNote link opening the app.

## Open questions for the owner

1. **Encrypt the payload?** Recommended above. The cost is that every read goes
   through a function holding the key. Plain text behind RLS is simpler and is
   what `write_audit` does today.
2. **The two `apps/mcp` additions**, the `cells` map and `links` on the
   listing, plus the export of the CL Aufgaben page walk: who builds them, and
   when, given that another session owns `tasks.ts`.
3. **The custody sentence's wording**, and whether it also goes on the OAuth
   consent screen, which today mentions tokens only.
4. **Cooldowns**: 10 minutes between refreshes and 1 hour between full ones, or
   something else.

## Built: 2026-11-23

Built as decided, with the open questions settled by the owner's go-ahead on
the recommendations: the payload encrypted, the cooldowns at 10 minutes and one
hour, the custody sentence on the dashboard and before the first refresh (not
yet on the OAuth consent screen).

- **`apps/mcp`**, additive and not in `tasks.ts`: `links` selected on the page
  listing, carried as `web_url` and `client_url` on `NoteSummary` when Graph
  returns them, at no extra request; and the CL Aufgaben page rule moved from
  `server.ts` into `task-pages.ts` (`isUpdateTarget`, `pickTaskPages`),
  exported as `@manudota/artist-mcp/task-pages`, with `map_notes` in tasks
  mode now calling the same function. The `cells` map was not built: Heute,
  Fristen and Menschen show what they are waiting for.
- **Migration** `20261124120000_task_view.sql`: the three tables, the
  functions, and `disconnect_provider` deleting the snapshot on a Microsoft
  disconnect. **Not applied to production.** The page needs it, so it goes in
  before the web deploy that carries this.
- **`apps/web`**: `/aufgaben` (Projekte, Neu, Warten / delegiert, Zu klären,
  and the other four as placeholders), a link from the dashboard for an
  account with Microsoft connected, and `/aufgaben/vorschau`, which renders a
  snapshot file and is a 404 outside `next dev`.

**What the first live run changed.** One request per notebook (list, then read
the pages under one 40-second deadline) was run locally against the three
season notebooks: 2026-27 read 12 of its 24 pages. A second run drew 429s, its
listing took 21.8 s, and the pages were left 5 s; 2 of 24 were read. The
listing alone is the larger share, as on hosted (0014), and how long it takes
depends on Microsoft. So listing and reading became separate requests, with
`pending` carrying the pages between them. The `not_reached` column this record
first described is gone.

**Verified locally on 2026-11-23**, driving the same `listNotebookTasks` and
`readTaskPages` with the local install's tokens and counting Graph requests,
`$batch` items one by one:

| Refresh | Requests | Time | Result |
| --- | --- | --- | --- |
| Full, 2026-27 | 32 listing + 24 reading | 23.5 s + 13.2 s | 30 sections, 24 pages, all read in one reading request |
| Full, 2027-28 | 13 + 4 | 16.1 s + 2.7 s | 11 sections, 4 pages |
| Full, 2028-29 | 7 | 13.2 s | 5 sections, no CL Aufgaben page |
| Narrowed, all three, nothing changed | 6 | 31.8 s | every stored page kept |

80 requests for a full refresh against the estimate of about 85, and 6 for a
narrowed one against about 7. 162 open tasks, 18 unsettled (the 18 the digest's
run marked) and 4 handovers (Mittersill's four), and every page carried both
links. A narrowed refresh where a section *had* changed was not run live,
because that needs an edit in the notebook; it is covered on the database
(below) and in `scripts/task-view.test.mjs`.

The migration was applied, with every earlier one, to a throwaway Postgres 16
with stub `auth` and `extensions` schemas, and exercised: a claim refused
inside 10 minutes and a full one inside an hour; a read before the listing, a
second listing in one refresh, a stale refresh id, and a forged page id that was
never pending all refused or ignored; a renamed CL Aufgaben page replacing the
old one on a narrowed refresh while an unchanged section kept its page; no task
text in the ciphertext and a wrong key refused; `anon` and `authenticated`
refused every service-role function with valid arguments and saw no rows; a
user's `forget_my_task_view()` leaving another's rows; and `disconnect_provider`
as `authenticated` deleting the snapshot.

The page was checked at 375 px and at desktop width through
`/aufgaben/vorschau` on the live snapshot: no horizontal page scroll, every
OneNote link 44 px tall and opening the `onenote:` link, the selected view
scrolled into sight, no console errors. Signed out, `/aufgaben` sends to
`/sign-in`.

**The layout was simplified after the owner looked at it** on the same day,
replacing the card per task described under "Layout: phone first". The site's
colours stay, but the type is proportional and in sentence case (`.skin-lesen`
in `globals.css`, applied by `aufgaben/layout.tsx`), because monospace capitals
tired the eye over a long list. Projekte opens as one line per project with its
counts. Every task is one line that opens on a tap to show the rest of its row,
using the browser's own `<details>`, so no script is needed. The OneNote link
appears once per project, and on a task only in the cross-project views. The
header holds only the time and the refresh, plus warnings when something was not
read. The explanations and the notebook choice moved to the bottom. Checked
again at 375 px.

**Not verified:** the signed-in page against a real database. No local
Supabase runs here (no Docker), and `apps/web/.env.local` still points at the
staging project deleted on 2026-09-13. So the server actions, the RPC calls
from `task-view.ts`, the notebook picker and the dashboard sentence have not
run end to end. That is the next check, on hosted after the migration and a
promotion, or locally once a Supabase stack runs.
