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
