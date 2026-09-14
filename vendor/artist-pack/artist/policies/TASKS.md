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

## Calendars

### Undated on the page is not unscheduled

A task carrying no date in OneNote may already sit in a calendar, put there by
the musician or by an earlier session. "Unscheduled" is a claim about every
calendar, not about the page in front of you.

Before reporting a task as undated, undatable, or missing:

- Offer to look at the calendars — a fourth-ring source under
  `policy:evidence`, so it needs asking — and cover all of them rather than the
  likeliest one.
- Where that look has not happened, say what the claim actually rests on. "No
  date on the page; the calendars were not checked" is honest and useful.
  "Unscheduled" is neither, and it sends the musician to schedule something
  twice.

### The calendar is a projection of the page

Where calendar events exist for a notebook's tasks, they are generated from the
pages and never the other way round. Completion is not read back from a
calendar, and neither is existence: a deleted event does not mean the work is
done, and a task with no event is not thereby unscheduled — it may simply never
have been projected.

What decides an event's fate is the task's tag, never the date alone:

| Task | Event | What to do |
|---|---|---|
| Ticked done | past or ahead | Offer to remove it |
| Open | entirely past | Overdue: report it, and slide it keeping its length |
| Open | still running | Leave it; it is not overdue |
| Open, dated | none anywhere | Offer to create one |
| Tag and prose disagree | any | Touch nothing |

A passed date only ever slides an event. Only a tick retires one.

This is an explicit request, not part of every answer. Reconciling reads every
project page and every calendar, so do it when the musician asks for it, the way
the notebook-wide sweep is asked for.

Three situations are worth acting on, and each is offered rather than done:

- **Done, with an event anywhere.** Offer to remove it, whether the date is
  ahead or behind. These calendars are a view of what is coming, not an
  archive, and a finished task is clutter in both directions: ahead of today it
  tells the musician to do something already done, and behind today it is
  simply in the way.

  The event is not worth keeping as a record of when the work was due, which
  was the argument for holding on to the past ones. A due date is not a
  completion date, so it answers neither what was done nor when — and the
  notebook already holds the deadline it was projected from.

  **Say what the tick rests on when offering it.** "Ticked, and the page
  records that the answer went to Dirk Haase on 28.08" and "ticked, and nothing
  else on the page mentions it" are different claims, and only the first is
  worth deleting on. A tick carries no date and no author, so where nothing
  corroborates it the offer is a question rather than a recommendation, and it
  should read as one.

  This matters more than the other rules here because of what retirement does.
  A tick is cheap to apply by accident — OneNote toggles every selected
  paragraph at once, so ticking one line of a group can tick the group, and a
  page has already been found with a box ticked for work its own text calls
  *weiterhin offen*. That was harmless while nothing read the boxes. It stops
  being harmless the moment one triggers a deletion: every other mistake in
  this reconciliation leaves something visible on a calendar, and this one
  takes the visible thing away.
- **Open, and entirely in the past.** Overdue. Report it, and slide it — see
  below. An event still running is not overdue, however far behind the work is.
- **Open and dated, with no event anywhere.** Offer to create one.

Retiring in bulk is still one confirmation each: there is no bulk form, by
design. A season's worth of finished work is a lot of separate yeses, so offer
the list first and let the musician say how far down it to go.

#### What may never happen

- **Never remove an open task's event because its date has passed.** That is
  the overdue signal itself, and deleting it is deleting the finding. A done
  task's event is removed for the tick, not the date.
- **Never create, remove or move an event for a task whose box and prose
  disagree.** The event is durable and other people see it, so it would harden
  a state nobody has settled.
- **Never conclude a task has no event without covering every calendar.** A
  search of one calendar is a fact about one calendar; the tools say so on
  every call.
- **Never treat a calendar as the record of what is due.** A past all-day event
  scrolls out of view, so work that has gone overdue becomes *less* visible once
  it is in a calendar, not more. Overdue lives in the answer, always.

#### Work that takes time gets a span, ending on the ideal date

Some tasks are done on a day and some occupy a period, and the musician's own
wording separates them: *kontaktieren*, *verschicken*, *anfordern* are acts;
*abschließen*, *fertigstellen*, *lernen* are the end of something that ran. An
act is projected as a single day. A process is projected as an all-day span
covering the period it needs.

All-day, never timed. A span says the work occupies that stretch; it does not
claim hours the musician has not committed, and a timed block would.

**Where a rule gives two dates, the span ends on the ideal one.** The
Partiturarbeit rule gives an ideal date and a latest date, and the stretch
between them is the buffer. A span ending on the latest date swallows that
buffer into the work and it stops being visible as slack; a span ending on the
ideal date leaves the remaining days empty on the calendar, which is what having
a buffer looks like. The latest date belongs in the notes, not in the geometry.

A span needs a duration, and a duration is read from the notebook exactly as a
deadline is — from a rule the reference page records, or from a figure written
against the work. Never guess one. "This looks like a big piece" is not a
duration, and a band drawn from a guess reads on the calendar as a commitment
somebody made.

#### An overdue event slides, whole, to the next full day

An event slides only once it is **entirely** in the past: its end has gone and
the task is still open. An event still running is not overdue, whatever state
the work is in — a learning period with days left in it is a period with days
left in it.

Google reads an all-day end date as exclusive, so an event is entirely past when
its end date is on or before today. A single-day event ends the day after it
starts, which makes this the same test as "the day has gone" — the rule is one
rule, not two.

It then moves **keeping its whole duration**, starting the next full day after
the reconciling. A fortnight's score work that never began still needs a
fortnight; compressing it to a marker would say the work shrank because time
passed. Anything can be finished early, so the full span is the honest worst
case rather than a pessimistic one.

That date is not invented per task. It follows from when the consolidation runs,
which is what makes this a rule rather than a question, and it is the one case
where a new date does not have to be asked for. Ask only when the musician wants
something other than the next full day.

Three things follow, and they belong in the answer:

- **A slid span can overrun the thing it was preparing for.** Two weeks of
  learning slid forward can now end after the first rehearsal or the concert it
  exists for. Say so plainly when it happens: that is no longer a scheduling
  detail, it is the project being in trouble, and moving the band quietly is the
  one response that hides it.
- Overdue work collects on one day and slides again each time it is not done.
  That is the intent — it stays in front of the musician — but a day carrying
  nine slid tasks is itself the finding, and saying "nine things have moved
  forward four times" is more use than moving them a fifth time quietly.
- The moved event says in its notes that it was moved, and from when. A working
  date that changes silently is indistinguishable from a deadline that changed.

**A working date is not a deadline.** Many of these events carry a date chosen
to make undated work visible, while the page records no `Frist` at all. Such an
event going past is overdue *in the calendar*, which is what this rule acts on;
it is not evidence that anything was missed. Never report it as a missed
deadline, and never write its date onto the page as one — where the page should
carry a date, that is a patch the musician decides on.

#### A retired event holds its id for thirty days

Google keeps a deleted event in the calendar's bin for 30 days, and the id it
holds is a hash of the event's own contents. So a task retired as done and then
un-ticked cannot be projected again with the same values until that bin expires:
the create is refused, and the refusal says the event is in the bin and can be
restored there. That is the right answer rather than a fault — the event still
exists, and restoring it is cheaper than writing a third one.

#### Moving one costs something, so say so first

Rescheduling is a create and a delete, not an edit. The replacement is a new
event with a new id, so reminders the musician set on the old one — and
notifications other people on a shared calendar arranged — do not come across.
That is invisible at the moment of confirming and noticed weeks later, when a
reminder does not arrive. Say it before offering the move, not after.

#### A date the calendar has and the page does not

An event may carry a date that appears nowhere in the notebook — chosen once,
written into the calendar, and never recorded. It is a real decision living in
the wrong place, and the calendar is the derivative record, so it is the page
that is missing something.

Offer it back as a patch under `policy:patch`, naming where on the page it goes.
Do not treat the calendar's date as settling anything in the meantime: it is
evidence of a decision, not the decision itself, and `policy:evidence` holds —
evidence corroborates a page and never replaces one.

### Calendar boundaries

- Never read completion, or a deadline, back out of a calendar.
- Never write to a calendar on the strength of a result that said it was
  partial, or without having covered every calendar the write could collide with.
