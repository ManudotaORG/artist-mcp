# Tasks

A task is a OneNote to-do tag on the line that states it: `[ ]` open, `[x]`
done. The tag is the record of whether the work is done — read it that way,
write every task that way, and keep everything else on the page in step with it.

The prose around a task is what the musician wrote about it, and a status cell
is a summary of it. Neither is the record. Both are still evidence, which is why
they are read and not ignored.

## Reading

- **Where the tag and the prose disagree, the task is unsettled.** Report it in
  neither the open list nor the done one, say what the box says and what the
  prose says, and let the musician settle it. Never resolve it by preferring
  one: the box may be waiting to be ticked, or the prose may describe a step of
  the work rather than its finish. Lead with it — it is the state most likely
  to send someone to redo finished work.
- **Where a status cell disagrees with its tag, the tag stands** and the cell is
  out of date. Say so; do not report the task as
  unsettled on the strength of a cell alone.
- **A line with no tag is not a tracked task, which is not the same as no
  task.** A page whose work is prose, or a task table without tags, has not
  been converted yet. Say that. Never report it as having no open work: silence
  reads as handled, and a page of untracked commitments reported as empty is the
  worst answer available.
- **Weigh a list by how much of it is tracked.** Two tags and four pages of
  prose have not been surveyed by reading the tags.
- **A delegated task is done, and its handover is the record.** A task Ruben
  has handed on counts as done, with who has it. It is recorded one of two
  ways: a ticked task whose line names the person ("→ übergeben an Katharina
  Würgau, 12.10.2026"), or a filled row of a delegation table — one with an
  "Übergeben an" column, as the Festivalleitung template has. `map_notes` with
  `tasks` returns both under "Delegiert". Report them apart from open and done,
  each with who has it. A handover with no reply recorded is still done: say
  that nothing has come back, once, and never move it into the open list. An
  open task whose prose says it was handed on is unsettled under the first rule
  here, not delegated. And "Verantwortlich" naming someone else is not a
  handover: that column says who should do the work, not that it was passed on
  and taken. **Done for Ruben is not carried out.** A handover takes the task
  off his open list; whether the person it went to has done the work is what
  *Warten / delegiert* tracks, and a project type that says never to infer a
  delegated step was carried out is about exactly that.
- **A ticked box carries no date.** *What* is finished can be answered; *when*
  cannot. Never date a completed task, never report what was finished "this
  week", and never read a tick as done on time. A date written beside the task
  is the evidence for that; the tag never is.

## Writing

Under `policy:patch`, and only on a page this tool may change.

- **Every task written gets a tag.** A new row in a task table, a task added by
  filling a template, a task carried across in a table replace — each is
  `<p data-tag="to-do">` in its cell, or on its list item. A task table written
  without them is a table of text that looks like tasks, and every later reading
  of it will say the page is unconverted.
- **Finishing a task ticks it.** "I sent the programme" sets
  `data-tag="to-do:completed"` on that task's line and leaves its wording alone.
  The line stays: nothing is deleted, and nothing is rewritten into the past
  tense. A removed task and a task that never existed are the same page.
- **Handing a task on ticks it and names who got it.** "Georgija kümmert sich
  um die Übernachtungen" sets `to-do:completed` and adds to the end of that
  line "→ übergeben an Georgija, <Datum>" — the date of the handover where it
  is stated, and otherwise the date it was said, stamped the way the page
  stamps chat values. That addition is the one change to a task's wording this
  policy allows. `update_row` never changes a task's wording, so in a
  conversation a handover is a replace of the table, with its preview — or, on a
  page with a delegation table, a row there instead, never both: two records of
  one handover drift. Never unattended.
- **The status cell follows the tag, in the same change.** Ticking a task sets
  its status cell to the page's word for done — `ERLEDIGT` where the page uses
  it — in the same `changes` call. Never change a status cell without the tag,
  and never tick a tag and leave its cell saying `OFFEN`.
- **An untagged task on a page you are already changing gets its tag** in that
  change, and the preview says so as its own line. Tagging is not a change of
  meaning, but it is a change the musician should see.
- **Only the two tags.** `to-do` and `to-do:completed`, on a paragraph or a list
  item — never on a header, a heading, or a cell that is not a task. Every other
  OneNote tag is a judgement about the line, and none has been agreed.
- **No categories yet.** `CL Aufgaben-Kategorien` sets out a taxonomy
  (Kategorie, Ausführung, Tätigkeitsart, Ansprechpartner), but that page leaves
  open whether they become table columns or tags. Read it when the musician asks
  about categories. Never write a category onto a task, and never report a task
  as uncategorised, until the page says how they are recorded.
- **Reopening is a decision like any other.** A task ticked in error goes back to
  `to-do` only when the musician says so, never because the prose looks
  unfinished.

## Reading dates and steps

### Urgency without a date

A task can be marked urgent without being dated, and here that is common:
PRIORITÄT 1, SEHR DRINGEND, höchste Priorität, JETZT, SOFORT, or a HOCH in a
priority column. These are the musician's own marks, and they outrank the
absence of a date.

Report undated work in two groups, never one:

- **Flagged urgent, no date.** The likeliest work to be lost, because nothing
  is watching a date on its behalf. Lead with these.
- **Open, no date, no flag.** An inventory, not a queue.

An urgency mark is not a deadline. Never turn one into a date, and never rank a
flagged task below a dated one merely because the dated one sorts.

### Where a deadline comes from

Three sources, and they are not stated alike.

1. **A date written on the task line or in the prose around it.** A page fact:
   state it plainly and name the page.
2. **A rule the notebook itself records**, applied to a date the notebook also
   records. The rules live on the reference page "CL Projekt-Etappen Übersicht" —
   read them from there. They are not repeated here: a rule written in two
   places is two records that drift, and the musician adds a rule by typing it
   on that page, not by anyone editing this one.
   A deadline reached this way is worked out, not read. Say so, name the rule
   and the date it was counted back from, and doubt the arithmetic before the
   page — `policy:answering` governs. A cell ending `(Regel: …)` is such a date,
   already written by the digest (`role:digest` 4c): still worked out, and a
   date written on the page by anyone else governs over it.
3. **Nothing.** The task is undated. That is a finding, not a gap in the answer.

Where two of these give different dates for one task, the **page-written date
governs**. It is the specific case, and the musician may have had a reason for
it the general rule cannot see.

Reporting is the other half of that, and it is not optional. A rule disagreeing
with a written date means one of the two is out of date, and only the musician
knows which. Give both, name the rule and the anchor it counted from, and leave
them standing. Never drop the derived date because the written one governs, and
never quietly raise the rule above the page.

A day or two apart is arithmetic rather than disagreement. Report the gap where
it would change what gets done this week.

A rule names the date it counts back from. Where the page does not record that
date, the task is **undatable** rather than undated: the rule applies and cannot
be run, and the missing anchor is itself the next thing to find out. Say which
date is missing.

Never derive a deadline from a rule the reference page does not state. A
convention holding across three projects is still not written down, and the
fourth project is not bound by it, and a rule noticed is never a rule applied.

### What is missing, not only what is late

Overdue answers what slipped. It cannot answer what was never written down, and
the absent step is the more common failure: a section holding only repertoire
research, a project with no task page yet, a phase nobody has begun.

"CL Projekt-Etappen Übersicht" sets out the steps each category is expected to
carry — BCW, GPT, Gastdirigate, Festivalleitung — across Verkauf/Akquise,
Produktion, Konzert/Auftritt, Presse/Marketing and Abrechnung. Compare the tasks
a project records against the steps its category expects, and report the steps
carrying no task at all.

- Classify the category from what the page records, the way a project type is
  classified. A section name is a hint and not evidence.
- Not every step applies to every project; the reference page says so itself. A
  missing step is worth naming and is not thereby a failure. Say it is
  unrecorded and let the musician say whether it applies.
- Unrecorded is never handled. That is `policy:answering`'s rule about silence,
  and it is the whole reason for the comparison.
- Report the missing steps as an inventory rather than as one recommended
  action — the same exception `policy:intake` makes for a gap inventory.

## Calendars

### The calendar is the musician's

Tasks are not put into the calendar. It holds what the musician set, plus any
event they asked this tool for, one request at a time ("trag mir die Probe
ein"). Never offer to project, reconcile, slide or retire task events: tasks
are seen in time in the task view's Zeitplan, not in the calendar.

- **Asked for an event, write it** with the calendar tools, under their own
  confirmations, and never on a result that said it was partial. Rescheduling is a create and a delete: reminders on the old
  event do not come across, so say so before offering the move. A deleted event
  holds its id in the bin for 30 days, so a re-create of the same values is
  refused there; restoring it is the answer.
- **The musician's events are evidence** under `policy:evidence`, read only
  when they ask or a prompt names it. An event corroborates a page or fills a
  gap in it, and never replaces it. A date only the calendar has is offered to
  the page as a patch.
- **Events this tool created (the `artist` prefix) are not evidence** of
  anything. Many were projected from pages before this rule, and the musician
  is clearing them; never offer a cleanup.
- **Completion is never read from a calendar**, and a task with no event is
  not thereby unscheduled.

### Time on the Zeitplan

- **A duration only from the notebook**: the `Dauer` column of
  `CL Projekt-Etappen Übersicht`, or a figure written against the task. Never
  guessed. An act (*verschicken*, *anfordern*) is one day; a process
  (*abschließen*, *lernen*) is a span **ending on the ideal date**, the latest
  date left as buffer after it.
- **Overdue slides, for display only**: an open task whose date has passed is
  drawn from the next day, keeping its length, marked overdue since its date.
  Nothing is written. A slid span that now ends after what it prepares for is
  the project in trouble; say so.
- **A tick takes a task off. An unsettled task is not drawn.**
