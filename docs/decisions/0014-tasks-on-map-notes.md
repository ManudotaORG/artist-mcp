# 0014 — The CL Aufgaben page is the task record, and the tool keeps it current

Status: **reading half built and verified on 2026-11-21**, locally and on
hosted (see "Built" below); maintenance waits for the digest playbook. Written for review before any
code. Builds on
[0008](0008-tasks-are-onenote-tags.md) (a task is a to-do tag),
[0010](0010-two-discovery-paths.md) (where the requests go) and
[0006](0006-replacing-a-whole-table.md) (a table is replaced whole). Its
maintenance half depends on [0015](0015-recovery-replaces-confirmation.md) for
anything beyond appending.

**Revised on 2026-11-21.** The first draft of this record proposed a tasks mode
that read every page in scope and extracted its tasks. That answered the wrong
question: it made a full read cheaper per call without making it rarer, and a
full read is what the request budget cannot afford. This version replaces it.
The measurements from the first draft are kept below, because they are what
showed that reading every page was the wrong unit.

## Why

A daily digest for the musician, run as a ChatGPT scheduled task on the hosted
path: what needs them today, what is new in the mail, which deadlines are close.
It runs unattended, inside a 60-second function limit and OneNote's request
budget — 120 a minute and 400 an hour per app per user, shared by hosted and the
local install because they are one app registration (0010), with every request
inside a `$batch` counted.

Deadlines sit on pages that have not changed, so a digest that reads only what
moved cannot see an old task coming due. And a full read of the three season
notebooks measured about 270 requests on 2026-11-21. Reading everything every
morning is two-thirds of the hour; reading only changes is blind.

The way out is to stop treating every page as a place tasks might be. Each
project already has a page whose job is to hold its tasks.

## The decision

**A project's tasks live on its CL Aufgaben page, and that page is the record.
The tool keeps it current; the musician's other pages are sources it reads and
never writes.**

- **The CL Aufgaben pages are this app's own.** They were created through it, so
  `onenote-edit` (`Notes.ReadWrite.CreatedByApp`) reaches them, and Microsoft —
  not this repository — keeps the tool off every page the musician wrote. That
  is the separation the design rests on: CL Aufgaben pages are maintained with
  less oversight precisely because they are apart from the pages that are always
  human-managed.
- **The musician can still edit them.** Ticking, correcting a date, deleting a
  line — all fine. The page is the record, not a cache of something else, so
  there is no copy for an edit to drift from and nothing for the tool to
  overwrite it with. The tool reads whatever is there.
- **Why maintenance, and not only reading.** Kept by hand, a CL Aufgaben page
  drifts further from the truth the longer nobody has time for it, and a digest
  built on a stale record is confidently wrong. If the musician wants more
  automation, the record has to be fed automatically.

## Reading: the digest reads one page per project

`map_notes` gains `tasks: true`. Per section in scope it reads **the CL
Aufgaben page only**, found by the title rule `list_notes` already applies when
it names a section's update target.

| Scope | Requests, estimated |
| --- | --- |
| All three season notebooks | about 93: 1 sections call + 46 section listings + ~46 CL Aufgaben pages |
| Sections changed since yesterday (this week's input) | about 11: 1 + 5 listings + 5 pages |

Against about 270 for reading every page. A full read becomes affordable once a
morning — roughly a quarter of the hour — and the change-only read becomes
nearly free. The section listings are now the larger share, because a section's
page list is the only way to find its CL Aufgaben page; remembering those page
ids would remove them, and is deliberately not proposed (it is state).

What a page returns is facts in the page's own words. No date is parsed, no
urgency ranked, no task called overdue — that is `policy:tasks`, applied by the
model.

```
## CL Aufgaben — Vidala-Tournee (BCW Wigmore hall u.a. Vidala) — id: …
Lead: Die Reise- und Hotelbuchungen warten auf Vertragsabschluss und Gagenbestätigung. …
[ ] Bearbeitungen/Arrangements der neuen Lieder fertigstellen (12 Stücke, siehe Programm)
    Verantwortlich: Ruben · Frist: idealerweise 08.09.2026, spätestens 01.11.2026 … · Status: OFFEN
[ ] Gagenverhandlung für Soulier (Wien) abschließen
    Verantwortlich: Ruben · Frist: UNKNOWN · Status: OFFEN
18 open, 0 done.
```

- **A task in a table** is its tagged cell, then the other cells of its row
  labelled by the header row — the first row, on every task table seen live
  (`Aufgabe · Verantwortlich · Frist · Status`; the tag sits on a `span` in the
  cell).
- **A task on a line** (`p` or `li`) is that line — including the lines the tool
  itself appends (below).
- **The lead** is the page's opening prose up to its first task, capped at about
  400 characters. A page-wide deadline was found there on a live page.
- **Done tasks are counted, not listed**, unless `include_done` asks for them.
- **A section with no CL Aufgaben page says so**, and that its other pages were
  not read. Several CL Aufgaben pages in one section are named, not chosen
  between — the rule `list_notes` already follows.
- **A CL Aufgaben page whose shape is broken says so** — a task table with no
  header row, task-like lines without tags — rather than dropping what it
  cannot place. `policy:tasks` is explicit that untracked work is not absent
  work.
- **What it leaves out is said once, in the output:** prose elsewhere on the
  page and every other page in the section. A task is not called done, stale or
  unsettled on prose grounds without `read_note`.

Paging and pacing carry over from the first draft: the 45-second deadline
holds, pages it cut off are named as unread, the answer carries a cursor that
resumes from a section rather than re-walking every section, and reads are
paced under 120 a minute. With one page per section, a whole-notebook read of
2026-27 is about 31 pages and should fit in one call; the cursor is for the
cases that do not.

## Maintaining: what a scheduled run may do to a CL Aufgaben page

The digest's other job, on the same run: look at what changed and feed the
record.

**Inputs.** The sections that changed since the last run (by section date, the
same narrowing `since` already does), and new mail, read as threads
(`read_thread`) so a value revised three replies later is not mistaken for the
first one.

**What it may write, in this record: additions only, appended below.**

- A new task found in a source becomes a tagged line appended at the end of the
  project's CL Aufgaben page, under a heading the tool owns ("Neu, automatisch
  ergänzt"), each line carrying where it came from:
  `[ ] Probenplan an die Agentur schicken — Frist 15.12.2026 · aus Mail „Re: Probenplan" (Agentur), 21.11.`
- **Not into the table.** OneNote cannot add a row; adding one means replacing
  the whole table (0006), which overwrites every cell the musician has edited.
  An append overwrites nothing. The musician moves a line into the table when
  they want it there, or a later step does once 0015's undo exists.
- **Nothing existing is changed by a scheduled run.** No tick, no new date on an
  existing row, no rewording, no removal. A changed deadline in the mail, or a
  sign that a task is done, goes into the digest as something to confirm, not
  onto the page. That keeps the line the musician drew: the tool adds, a person
  decides what is finished.
- **Not added twice.** Recognising that "Gage Mittersill bestätigen" is already
  on the page is a judgement, not a string match. When unsure, the run does not
  append; it lists the candidate in the digest instead.
- **Tasks found on the musician's other pages are flagged, not copied.** Thirteen
  of 42 real tasks in the 2026-11-21 sample were on pages like `Mittersill` or
  `CL Arrangements neue Stücke`. Copying one makes two records that drift — tick
  one and the other stays open — and the tool cannot remove the original from a
  page it does not own. The digest says "3 open tasks on 'Mittersill', not on
  the CL Aufgaben page", and the musician moves them once. After that the
  convention holds.

### Creating a missing CL Aufgaben page

Decided on 2026-11-21: **a scheduled run creates the CL Aufgaben page a project
section lacks**, rather than only reporting it. The check below found thirteen
project sections without one, and a digest that can only say "no CL Aufgaben
page" for a third of the projects is not a digest of the work.

`policy:intake` already describes the act — classify the section, then a CL
Aufgaben page "from the current template for its type" — as something offered
to the musician. This makes it something done, under the same rules:

- **Only for a section classified as a project**, from what its pages record,
  with the section name as a hint and not evidence, exactly as intake
  classifies. Where the classification is unsure, or the section is plainly
  not a project (`Claude Test`, `Claude Vorlagen`, `Projekt Kontext`,
  `BCW ÜBERSICHT`, a stray `Neuer Abschnitt 1`), the run reports it and creates
  nothing.
- **From the current template for its type**, found in `Claude Vorlagen` by its
  `Template: <type> v<n>` line, in the project's own season notebook or the
  latest earlier one that has it. No template for the type: report, never
  improvise one.
- **Titled `CL Aufgaben — <project>`**, the templated form the update-target
  rule recognises. `create_onenote_page` already refuses an unsettled title.
- **Filled only with what the section's pages state, each value citing the page
  it came from** — intake's rule for a summary, unchanged. A field nothing
  states stays empty in the template's own convention for that, never a guess.
- **Commitments written as prose on the section's pages become tagged tasks**
  on the new page, citing their source. **Tasks already tagged on another page
  are not re-tagged here**: they are listed as references ("open on page
  `Michael`") and flagged in the digest, for the same reason as above — two
  tags for one task drift.
- **A section that keeps its state on another `CL` page** (`Köln Orfeo` and
  `Köln Nozze di Figaro` have `CL Status & Termine`) still gets a CL Aufgaben
  page. The other page stays where it is, as a source.
- **At most three creations per run**, and each one opens the digest ("Created
  CL Aufgaben — Köln Agrippina from template GPT v2, from 3 pages"). A
  classification that goes wrong across a whole notebook in one night is the
  failure this bounds.

The cost of a mistake here is higher than for an appended line, and it is said
so rather than hidden: `Notes.Create` cannot delete, so **a wrongly created page
is removed by the musician by hand** — the one write in this record the tool
cannot undo itself. That is why classification is conservative, creations are
capped, and every one is announced.

Creating a page already commits in one call (0009), so this needs no change to
the confirmation rules, only to what a scheduled run is told to do. It also
writes nothing onto an existing page.

**Why this needs only a small change, not 0015.** An append destroys nothing, so
under 0009's own rule it may commit in one call. Today `edit_onenote_page` asks
for a confirmation token even for an append. Letting appends commit in one call
is the first, smallest step, and it is independent of the undo machinery —
though 0015's verified undo for an appended line (replace it with `<p></p>`)
gives it one anyway.

**What waits for 0015.** Changing existing rows unattended — ticking from
evidence, updating a date, folding appended lines into the table — overwrites
the musician's content and stays behind a confirmation until 0015's recovery is
built and verified.

**Oversight moves to after the fact.** Every appended line names its source and
is in the write log. The digest opens with what was added overnight ("2 tasks
added to CL Aufgaben — Vidala"), so the musician reviews additions where they
already look. A wrong addition costs one deleted line.

## Built: the reading half, 2026-11-21

`map_notes` with `tasks: true` (and `include_done`), as described above, with
three choices the owner made at build time:

- **The lead is capped at 400 characters**, and says when it was cut.
- **No resume cursor.** Sections the deadline did not reach are named, to be
  asked for again with `section`. A cursor is added only if a live run shows a
  notebook not fitting in one call; none did.
- **`since` stays per notebook**: the digest makes one call per season. In tasks
  mode `since` narrows by section date only, so it works on accounts whose page
  dates are creation dates too, and the answer names how many sections it
  skipped and that their tasks, including any coming due, are not in it.

A section with exactly one CL Aufgaben page reads it, with no `includeIDs`, since
the ids serve only an edit. None and several are named and read nothing.

**Live, locally, against the three season notebooks:**

| Notebook | Sections | Pages read | OneNote requests | Open / done | Time |
| --- | --- | --- | --- | --- | --- |
| 2026-27 | 30 | 24 | 56 | 159 / 16 | 27.6 s |
| 2027-28 | 11 | 4 | 17 | 16 / 3 | 18.5 s |
| 2028-29 | 5 | 0 | 7 | 0 / 0 | 11.3 s |

80 requests for all three, against the estimate of about 93. Every page's open
tasks matched an independent count of open tags in the same HTML, taken through
`htmlToText` as each page arrived, so the check cost no requests: zero
mismatches. Nothing hit the deadline. The thirteen project sections without a
page are the ones the ownership check found.

The first run found one defect: an untagged table was reported as a task table
whenever a header cell *mentioned* "Aufgaben", and the live pages use one-cell
tables as boxes of prose — 30 false notes in one notebook. Now a header cell
must *be* a task word, in a table of more than one column. What is left is real:
two tables headed `Aufgabe · Übergeben an · Übergeben am · Rückmeldung erhalten`,
untagged. **That is where delegated tasks are kept**, which is what the digest
needs to count a delegated task as done with its recipient's name; tasks mode
names those tables but does not read their rows. Deciding that is the digest
playbook's question.

The 2026-27 answer is about 50,000 characters (~12.6k tokens) for every task
page in the notebook. The first draft's sample, 24 changed pages read whole, was
143,730.

**On hosted after #261**, through ChatGPT, the same counts: 2026-27 listed its
30 sections in 14.3 s and read all 24 pages in 13.4 s of the 27.0 s left;
2027-28 took 4.6 s and 2.0 s; 2028-29 listed in 4.3 s and had nothing to read.
Nothing was cut off.

## What the first draft measured, and why it changed direction

On 2026-11-21, the 24 pages in the five 2026-27 sections that changed since
14 November:

| | `read_note` per page | Task rows only |
| --- | --- | --- |
| OneNote requests | 25 | 25 — the same |
| Text returned to the model | 143,730 chars (~36k tokens) | 27,143 chars (~6.8k tokens), 19% |
| Tool calls | 24 | 1–2 |

Extracting tasks saves no requests per page — a page's tasks cannot be found
without fetching it. It saves text, and calls, which in a scheduled task is
probably the larger saving (every call is another model step carrying all that
came before; an estimate, not a measurement). Reading one page per project is
what saves requests. The tasks mode keeps the text and call savings and drops
the per-page cost from every page to one page per section.

`map_notes` was checked live before being extended, since it ran the account out
in September: three runs, no 429s, 13–21 s each, every page sketched. Not yet
measured on hosted.

## Cost on every request

One boolean, one optional boolean, and a sentence in the `map_notes`
description. Measured with `context-budget` before it ships.

## What this does not do

- **Store state.** No index, no cache. The CL Aufgaben page is the record, and
  it lives in the musician's notebook.
- **Judge.** No overdue, no ranking. The model does that under `policy:tasks`.
- **Touch the musician's pages.** Microsoft enforces it; nothing here asks it to.
- **Change existing lines unattended.** Until 0015.
- **Synchronise.** Nothing exists in two places: appended tasks come from mail
  and chat, which are evidence rather than records, and tasks already on other
  OneNote pages are flagged rather than copied.

## How it would be verified

- Request-level tests: only CL Aufgaben pages fetched in tasks mode, a section
  with none named, a broken table reported, the cursor resuming without
  re-walking, each failing with its guard removed.
- Fixtures shaped like the live pages: the Vidala table, an appended
  automatic line, an untagged task table.
- Live: a full tasks read of the three season notebooks, its request count
  against the estimate of about 93, and every open task on those CL Aufgaben
  pages present.
- Live, on a scratch CL Aufgaben page this tool creates: a scheduled-style run
  appends one task from a test mail with its source, and appends nothing on the
  second run.
- A check that every CL Aufgaben page really is this app's: each page's
  `createdByAppId` against the identifier the write log recorded at creation
  (0003). **Done on 2026-11-21**, from the page listing alone (62 requests, no
  page content): every page this install has created carries
  `WLID-000000004D91A800`, and so do all 29 pages titled `CL Aufgaben…` — 28
  project task pages plus the `CL Aufgaben-Kategorien` reference page, which the
  update-target rule already excludes. Ten of the eleven other `CL` pages are
  this app's too. The exception is `CL Projekt-Etappen Übersicht`, created on
  2026-08-11 by another app (`WLID-00000000418CF202`): it is the reference page
  `policy:tasks` reads deadline rules from, and it stays human-managed.
- On hosted after promotion, under 60 seconds including a cold start.

## Open questions

0. **Sections with no CL Aufgaben page.** Found by the same check: 18 of the 46
   sections in the three season notebooks have none. Five are not projects
   (`BCW ÜBERSICHT`, `Claude Test`, `Claude Vorlagen`, `Neuer Abschnitt 1`,
   `Projekt Kontext`). The other thirteen are, mostly in 2027-28 and 2028-29 —
   projects still early, such as `CD Alina`, `Köln Agrippina` and
   `Montepulciano 2028` — and two keep their state on a `CL Status & Termine`
   page instead (`Köln Orfeo`, `Köln Nozze di Figaro`). A digest built on
   CL Aufgaben pages says "no CL Aufgaben page" for each and sees none of their
   tasks. **Decided: a scheduled run creates the missing page**, under the rules
   in "Creating a missing CL Aufgaben page" above. What remains open is the cap
   of three per run, and whether the first run over the thirteen should be
   watched by a person rather than left to the schedule.
1. **Cadence.** A full CL Aufgaben read is about 93 requests. Every morning
   seems affordable; the scheduled task decides.
2. **The heading for appended lines**, and whether it is one block per page or
   one per run.
3. **Mail as a source of tasks.** Which mail is in scope — a label, the
   project's correspondents, anything mentioning the project — decides how
   noisy the additions are.
4. **Whether `since` should work across all notebooks** without one being chosen
   first, since the digest wants every season.
5. **The lead's cap.** 400 characters held the one page-wide deadline seen; a
   long preamble could push one past it.
