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
  out of date. Say so, and offer to correct the cell; do not report the task as
  unsettled on the strength of a cell alone.
- **A line with no tag is not a tracked task, which is not the same as no
  task.** A page whose work is prose, or a task table without tags, has not
  been converted yet. Say that. Never report it as having no open work: silence
  reads as handled, and a page of untracked commitments reported as empty is the
  worst answer available.
- **Weigh a list by how much of it is tracked.** Two tags and four pages of
  prose have not been surveyed by reading the tags.
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
   page — `policy:answering` governs.
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
fourth project is not bound by it. Where a rule seems to be missing, say so and
offer it for the page — that is a patch under `policy:patch`, decided by the
musician, never a rule applied on the strength of having noticed it.

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
