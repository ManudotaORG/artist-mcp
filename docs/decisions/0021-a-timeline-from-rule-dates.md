# 0021 — Tasks on a timeline, not in the calendar

Status: **accepted 2026-11-23; the view and the pack changes are built, not
yet live.** Builds on [0020](0020-a-snapshot-of-the-task-pages.md) (the task view
reads a snapshot of the CL Aufgaben pages) and
[0018](0018-undo-and-unattended-row-updates.md) (`update_row` sets a Frist and
`undo_write` takes it back). It **amends 0018's decision 3** (no worked-out date
unattended) and **retires the calendar projection** in the custom pack's
`policy:tasks`. Calendar writes themselves stay.

The first draft kept rule dates attended and left the projection alone. The
owner changed both: the digest is to set worked-out dates on its own, and the
tasks are to leave Ruben's calendar.

## Why

Ruben asked for his tasks on a timeline, like a Gantt chart, following the rules
the calendar projection already uses.

**The projection was too much for Ruben.** His calendar is already busy, and
task events on top of rehearsals and concerts made it harder to read, not
easier. The timeline moves the tasks somewhere he looks at on purpose. That also
changes what his calendar *is*: once the tool stops filling it, every event in it
was put there by Ruben, or by the tool because he asked for that event. That is
worth more to the digest than the projection was, because `policy:tasks` could
never read a deadline back out of a calendar the tool had itself written.

**The pages carry too few dates for a timeline on their own.** The snapshot from
2026-11-23:

| `Frist` cell of the 162 open tasks | Tasks |
| --- | --- |
| One clear date | 29 |
| "idealerweise … spätestens …" | 1 |
| Two dates in other wording | 6 |
| Words, no date ("laufend", "mit dem Vertragsrücklauf") | 17 |
| `UNKNOWN` | 89 |
| No Frist cell | 20 |

That is about 36 tasks out of 162. The notebook carries more dates as rules:
`CL Projekt-Etappen Übersicht` records six, each counted back from an anchor the
project page has to state.

| Rule | Lead time | Anchor |
| --- | --- | --- |
| Strichfassung von der Notenbibliothek anfordern | 1 Monat | Probenbeginn (Opern) |
| Noten/Orchestermaterial an die Musiker verschicken | 2 Monate | Konzert |
| Verzierungen an die Sänger kommunizieren | 2 Wochen | Probenbeginn (Barockopern) |
| Eigene Partiturarbeit abschließen | idealerweise 1 Monat, spätestens 2 Wochen | Probenbeginn |
| Sängerpartien gelernt | 2 Wochen | erste Ensembleprobe (Opern) |
| Orchesterteil gelernt | 2 Wochen | erste OA (Opern) |

Matched by wording alone, about 21 of the 126 undated open tasks look like one of
these rules (11 on sending parts, 9 on score work, 5 on learning, 3 on cuts; a
few match twice). That takes the timeline from about 36 tasks to about 55. It
will not date most of Ruben's work, and the view must say so. Coverage grows only
as Ruben adds rules to the reference page.

## The decision

Three changes, which only make sense together:

1. **The digest writes rule dates into empty `Frist` cells on its own**, marked
   as worked out by a rule. The view never runs a rule itself.
2. **The tool stops putting tasks into the calendar.** The calendar write tools
   stay, for an event Ruben asks for.
3. **The task view gets a Zeitplan tab**, which is where tasks are seen in time,
   with the calendar's sliding rule applied for drawing only.

### 1. Rule dates, set unattended

**Why on the page, and not computed for the view.** Applying a rule takes three
judgements no deterministic code can make: whether a task *is* the rule's task
("Stimmen an Daria" is the parts rule, "Stimmen der Sänger klären" is not),
which category and format the project is (the cuts rule applies to operas, the
ornaments rule to Baroque operas), and where the anchor is written (Probenbeginn
is often on a schedule page, not on the CL Aufgaben page). The web app calls no
model, and storing session-made dates beside the snapshot would be a second
record of when work is due, outside OneNote. Written into the `Frist` cell, the
date is read by the digest, the view and Ruben in OneNote alike.

**Why unattended now.** 0018 kept worked-out dates attended because a wrong one
looks like a real one. What changes that is what the timeline needs: dates that
appear without Ruben having to ask, every morning, as the pages change. A rule
date is also the cheapest wrong date to catch. It names its rule and anchor in
the cell, so a wrong one is wrong visibly, and `undo_write` removes it by id.
The failure 0018 weighed against ticks — an open task dropping off every list —
does not follow from a wrong date: the task stays open and stays listed.

The bar, in `role:digest` beside step 4b:

- **Only into a cell with no date in it**: empty, `UNKNOWN`, or words only. A
  date the page already carries governs (`policy:tasks`). Where a rule disagrees
  with it, both are listed under *Zu klären* and the cell is left alone.
- **Only from a rule the reference page records, and an anchor read on a page.**
  The anchor is a full date written on the project's pages — the CL Aufgaben
  page or the one page holding the schedule — and the cell names the page it
  came from. An anchor from a mail or a calendar is not enough to write on (see
  open question 2). Where the rule applies and no anchor is written anywhere,
  nothing is written, and the digest names the missing date as the next thing
  to find out. That is the reference page's own rule.
- **Only where the match is plain.** The task's own wording names the rule's
  work, and the project's type matches the rule's. A task that only might be the
  rule's task is listed as *zu bestätigen* with the date it would get.
- **In the shortest format that still says it was worked out.** The date,
  then the rule as lead time and anchor, nothing else:
  - `01.09.2026 (Regel: 2 Mon. vor Konzert)`
  - `29.09.2026, spät. 13.10.2026 (Regel: vor Probenbeginn)`
  - with a duration: `15.–29.09.2026 (Regel: vor Probenbeginn)`

  The rule's name and the anchor's date and page are not in the cell. They are
  in the write log and the digest line, which is where anyone checking a date
  looks; the cell is read every day by someone who only needs the date and the
  fact that it was worked out.
- **Kept current.** A cell in that format, still reading exactly as the tool
  wrote it, may be re-dated unattended when the rule worked out again from the
  page's current anchor gives a different date. That is the same condition
  `undo_write` uses. A cell Ruben has edited is his, and is never re-dated.
- **At most ten a run, earliest first.** The first run on a season will find
  about twenty, so the cap spreads the backfill over two or three mornings
  instead of refusing it. This is separate from the five mail dates, whose
  "more means none" rule stays: many mail dates in one night suggests a
  misreading, many rule dates on the first night does not.
- **Each one is one line in the digest** under *Über Nacht geschrieben*:
  `Stimmen an Daria → 01.09.2026 (2 Mon. vor Konzert 01.11., Probenplan) · w_8f2c`.
  Ten writes are ten lines. How to undo is said once under the heading, not per
  line.
- **Cost.** Only candidates on pages the digest already reads for changes, plus
  one schedule page per project where the anchor is not on the Aufgaben page.
  About thirty requests on the first night of a season notebook, a handful on a
  normal one.

### 2. The calendar is Ruben's again

- **No more projection.** The reconciliation in `policy:tasks` — "Open and
  dated, with no event anywhere: offer to create one", sliding overdue events,
  retiring done ones — is retired. No session offers to put a task into the
  calendar, and the digest already never writes to it.
- **The calendar tools stay**, under the grants Ruben already gave:
  `create_calendar_event`, `edit_calendar_event`, `reschedule_calendar_event`
  and `delete_calendar_event`, with every confirmation 0001 and 0013 set. They
  are used when Ruben asks for an event — "trag mir die Probe ein", "verschieb
  das auf Donnerstag" — and the rule that an event is created only on a request
  for that event is the whole change.
- **The events already projected stay where they are.** Ruben cleans them up
  himself. No session offers a cleanup or deletes one unasked; if he asks to
  remove a particular one, the existing delete does it.
- **The calendar becomes evidence the digest may read.** Events without the
  `artist` prefix are Ruben's, so reading one is reading something he decided.
  `policy:evidence` still holds: an event corroborates a page or fills a gap
  in it, and never replaces it. "Never read a deadline back out of a calendar"
  is narrowed to events the tool created.

### 3. The Zeitplan tab

In 0020's view, built on the `cells` map the shared parser still has to provide.
Heute and Fristen wait on the same map.

- **The dates it reads:** a cell whose first date is a full `dd.mm.yyyy`, and
  the `idealerweise … spätestens …` pair. A cell holding anything else is listed
  under "ohne eindeutiges Datum", in the page's words, and never placed on the
  timeline.
- **Bars where a duration is written, markers elsewhere.** `policy:tasks`
  draws work that takes time as a span ending on the ideal date, with a
  duration the notebook records and never a guessed one. The rules table on
  `CL Projekt-Etappen Übersicht` gains a `Dauer` column, filled by Ruben — it
  is his page, and `onenote-edit` cannot touch it anyway. A rule with a Dauer
  writes a span into the cell (`15.–29.09.2026`), drawn as a bar; a rule
  without one, and every date someone wrote, is a marker on its day. A
  duration written against a single task on its page counts the same way.
  Where a pair is given, the bar or marker ends on the ideal date and the
  latest date is a thin tick after it, so the buffer is visible as empty space
  and not as work. An act (*verschicken*, *anfordern*) stays a marker whatever
  the table says.
- **Sliding, for drawing only.** An open task whose date has entirely passed is
  drawn from tomorrow, keeping its length, and labelled "überfällig seit
  <Datum>". Nothing is written: the page keeps its date. Where several slid
  tasks pile up on one day, the day says how many. The rule that used to keep
  overdue events in front of Ruben on his calendar now does it here.
- **A tick takes a task off.** An unsettled task is not drawn; it stays under
  Zu klären, as in every other view.
- **A worked-out date looks different from a written one.** The marker is
  outlined rather than filled, and tapping it shows the cell as written.
- **Undated work stays beside the timeline, never on it.** First the tasks
  flagged urgent with no date (PRIORITÄT 1, SOFORT, a HOCH, as `policy:tasks`
  lists them), then the rest. Their counts are in the tab's heading, so a short
  timeline is not read as a short list of work.
- **Layout.** One row per project, under a project column that stays put while
  the weeks scroll sideways. The view opens on a span from last week to eight
  weeks ahead, with a line for today. On a phone a week is about 48 px, so
  roughly seven weeks fit across the screen. No chart library: markers are
  positioned boxes in a grid, in the same type and colours as the rest of the
  view.

## What this does not do

- Write any date that is not worked out from a rule the reference page records,
  or overwrite a date somebody wrote.
- Invent a duration, a rule, or an anchor.
- Put a task into the calendar, or remove a calendar tool.
- Change a task's wording, its tick, or any cell but the `Frist`.
- Store a date anywhere but on the OneNote page.

## Where the changes land

- **Custom pack** (its own repository, vendored in at a recorded commit):
  `role:digest` gains the rule-date step beside 4b; `policy:tasks` loses the
  projection and reconciliation, keeps the timing rules (spans end on the ideal
  date, sliding) as rules for the timeline, and narrows its calendar boundary
  to the tool's own events; `role:project-manager`'s calendar section follows.
- **`apps/mcp`**: no new tool or capability. The calendar tool descriptions are
  checked for any wording that suggests projecting tasks. The `cells` map comes
  from the session that owns `tasks.ts`.
- **`apps/web`**: the Zeitplan tab.
- **0018**: decision 3 marked as amended here.

## How it would be verified

- The `cells` map, in the shared parser, tested on the live table shapes: a
  `Frist` column, a missing one, a merged cell.
- The view's date reading and sliding tested deterministically: one date, a
  pair, a written date beside a rule note, a past open task sliding to tomorrow
  with its length kept, a ticked task gone, an unsettled one not drawn.
- **A watched digest on one season notebook**: candidates against the rough
  count of about 21, at most ten written, every one checked by hand against its
  rule and anchor, a cell with a written date left alone, a missing anchor
  named rather than guessed, and each write's `undo_write` working. Then a
  second watched run that re-dates one cell after its anchor is moved on a
  scratch page, and leaves alone one Ruben edited.
- A session asked to "plan the tasks" offering no calendar event; asked to "trag
  die Probe ein", creating one.
- The tab checked at 375 px.

## Short by default

The tool is too verbose in general, and this record adds output in three
places, so each is held to the least that does its job: the cell carries date
and rule only, the digest gives one line per write, and the Zeitplan tab shows
the task text and its date, with the rule and anchor behind a tap. Anything
longer has to earn its place against being read every morning.

## Built, 2026-11-23

- **The Zeitplan tab**: `apps/web/src/lib/task-timeline.ts` reads a `Frist`
  cell (a date, a span, an ideal date with "spät."/"spätestens", "bis zum"
  before a date; "(Regel: …)" and the notebook's existing "(gerechnet)" mark a
  worked-out date) and slides overdue tasks; `Zeitplan.tsx` draws it, and the
  rows every view uses moved to `TaskRows.tsx`. Tested in
  `scripts/task-timeline.test.mjs`. Seen at 375 px on the 2026-11-23 snapshot
  with cells filled in from `details` for the preview only: 19 of 162 open
  tasks placed, sticky project column, span, latest-date tick and overdue all
  as above. **Until the parser returns `cells`, the tab says it is waiting**,
  as Heute and Fristen do.
- **The pack**, in a clone of the custom-pack repository, not committed:
  `role:digest` 4c (rule dates, unattended, at most ten), 4b no longer
  forbidding rule dates; `policy:patch` lists rule dates as allowed unattended
  and calendar events as on request only; `policy:tasks` "Calendars" rewritten
  (no projection, the musician's events as evidence, the `artist` events not,
  time rules moved to the Zeitplan) and a "(Regel: …)" cell named as worked
  out; `role:project-manager` follows; the scheduled and watched digest
  prompts gain "Fristen setzen: aus Mails (4b) und aus Regeln (4c)". The
  scheduled prompt is pasted into ChatGPT by hand, so it changes when Ruben
  pastes it.

Not yet verified: the watched digest run, and anything on hosted.

## Open questions for the owner

1. **Anchors from Ruben's calendar.** Once the calendar holds only his events,
   a Probenbeginn on it is a date he decided. Should the digest be allowed to
   count a rule back from it when no page states the anchor, naming the event?
   Proposed: not yet — list it as *zu bestätigen* with the date it would give,
   and decide once a few weeks show how often it happens.
2. **The `Dauer` values** are Ruben's to fill in on the reference page. Until
   he does, the timeline is markers.
3. **The `cells` map** is still owed by the session that owns `tasks.ts`.

Decided 2026-11-23: the format is as short as above; the old calendar events
are Ruben's to clean up; durations are wanted, from a `Dauer` column.
