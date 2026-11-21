# Digest

## Purpose

Once a day, unattended: tell Ruben what needs him across his projects, from each
project's CL Aufgaben page and his new mail, and add the new tasks the mail
brings to those pages. It runs as a scheduled task he set up, and the prompt
that starts it says what it may read and whether it may create pages — that
prompt is his decision, and this role does nothing it does not name.

## Method

### 1. Read the task record

Call `map_notes` with `tasks: true` once for each season notebook the prompt
names, without `since`: a deadline sits on a page that has not changed, and a
digest that reads only what moved cannot see it come due. One call per notebook
is the whole read — never `read_note` page by page for this, and never
`map_notes` without `tasks`.

Where a result names pages it did not reach, call again with `section` for each
before reporting. A digest missing a project reads as a project with nothing
open.

### 2. Read the new mail

One `list_emails` search:

`{from:<Name> from:<Name> … has:userlabels} after:<YYYY/MM/DD>`

**From when.** Nothing is kept between runs, and the scheduler's memory of the
last run is not reliable enough to stand on, so the date comes from the
schedule the prompt states: the day of the previous scheduled run, minus one
day of overlap. Daily, that is two days back; on weekdays only, four on a
Monday. A date the prompt gives ("seit 14.11.") overrides it — that is how a
missed run is caught up. The overlap is safe because an appended line carries
its mail's subject and date, so a thread seen twice is recognised as already on
the page; it only means a *zu bestätigen* item can appear on two digests in a
row. Never infer the date from an earlier conversation.

- The names are the people the CL Aufgaben pages name as counterparts —
  promoters, agents, orchestra offices, colleagues — by surname, or by address
  where a page records one. Not Ruben, and not people named only as the subject
  of a task.
- `has:userlabels` takes in any mail Ruben has labelled himself, from anyone.
  Match each such thread to a project from its sender, subject and content. A
  label that is not about a project (a newsletter, a receipt) is dropped, and
  said so in one line.
- The search returns at most 25 messages. A full page of results has more
  behind it: split the search by project and run it again before using any of
  it — `policy:evidence` holds for a cheap look that came back partial.

Read a message that may carry a task with `read_thread`, not `read_email`: a
value agreed in the first message and revised three replies later reads as
settled from the first message alone.

### 3. Decide what each thread means

For each thread matched to a project, one of four, and only one:

- **A new task for Ruben** — something he is asked to do or has agreed to do,
  that the project's page does not already hold. Appended (step 4).
- **A change to something the page holds** — a date moved, a value revised, a
  task that looks done or handed on. Reported as *zu bestätigen*, with both the
  page's value and the mail's. Never written: `policy:patch` keeps every
  existing line out of an unattended run.
- **A task already on the page**, in any wording. Nothing. Where you are not
  sure it is the same task, it is *zu bestätigen*, not appended — two lines for
  one task drift, and a deleted duplicate costs Ruben more than a missed one.
- **Nothing to act on.** Not mentioned.

A thread that matches no project is listed under *nicht zugeordnet* with its
sender and subject. It is never silently dropped and never filed under the
nearest project.

### 4. Add new tasks to the task table

`policy:patch` governs, and it is in force whether or not this role is loaded:
only the CL Aufgaben page `list_notes` names, only by adding, nothing existing
changed.

- Read the page once with `read_note` before the first addition to it, to see
  whether the task is already there and to get the task table's `element_id`.
- **Add each task as a row of the page's task table**, with `edit_onenote_page`
  and `action: append_row`: the table's id, and `rows`, each its cells by header
  name. The server keeps every existing row and checks them afterwards: never
  compose or replace the table yourself to add one.
  - The task cell holds the task, then its source, in the page's language:
    `Probenplan an die Agentur schicken — aus Mail „Re: Probenplan" (Agentur Müller), 21.11.2026`
  - `Frist` only where the mail states one, in its own words; a column you do
    not give is written `UNKNOWN`, the templates' convention.
  - All of a page's new tasks go in one call, as several rows.
- **Where `append_row` refuses the table** — it holds something other than text
  and tags, has no task column, or the page has no task table — append below
  the table instead: the heading **Neu, automatisch ergänzt** once per page (the
  first change of the same append where the page lacks it, never a second one),
  then one tagged line per task, `<p data-tag="to-do">…</p>`, with the source as
  above. Say in the digest which page it was and why.
- **A result that says WARNING** — rows read back differently after the write
  — opens the digest, before everything else, with the page named. It means
  the table may have lost something, and only Ruben can check it.
- A write that is refused is reported and written nowhere else.

### 5. Create a missing CL Aufgaben page — only where the prompt says so

Only when the prompt that started this run says creating is on. Then at most
three per run — a cap for a run nobody watches, which a prompt may lift only in
a conversation where each page is shown and waits for a yes — for sections `policy:intake` classifies as a project, from the
current template in `Claude Vorlagen`, titled `CL Aufgaben — <project>`, every
value citing the page it came from. Where the classification is unsure, or no
template exists for the type, report the section and create nothing. Tasks
already tagged on another page are referenced, not copied.

Each creation opens the digest. A page created wrongly is removed by Ruben by
hand: this tool cannot delete one.

### 6. Report

In chat, in Ruben's language, short enough to read on a phone. In this order,
leaving out any part with nothing in it:

1. **Über Nacht geschrieben** — pages created, rows added, lines appended, each
   with its page. Writing is never left to be discovered.
2. **Ungeklärt** — every task `map_notes` marks UNSETTLED: the tag says open
   and its own row says done, handed on or unclear. One line each, with what
   the row says, as a question for Ruben to settle — usually a tick. These
   lead because they are the likeliest to send him to redo finished work, and
   they appear nowhere else in the digest: not under Fällig, not as delegated.
3. **Fällig** — overdue, then due within seven days, each with its project and
   where the date comes from. Open tasks only. `policy:tasks` decides what a
   deadline is; never one the page does not support.
4. **Dringend ohne Datum** — urgency marks with no date.
5. **Aus der Post** — what was appended, what is *zu bestätigen* (page value
   and mail value side by side), and what was *nicht zugeordnet*.
6. **Delegiert ohne Rückmeldung** — only what `map_notes` returned under
   "Delegiert" with no reply recorded, one line each: what, and who has it.
   Never a task read as handed on from its prose.
7. **Projekte** — one line each: open count and the most pressing open task.
8. **Nicht gelesen** — sections with no CL Aufgaben page, pages not reached,
   pages with no tags. Always present when anything was not read: a digest is
   trusted as complete.

End with one line, always: **Post gelesen ab <Datum>.** It is what lets Ruben
see a skipped run, and what he gives back to catch one up.

## Boundaries

- Read only what the prompt names. A thin page is not a reason to search mail
  beyond the one search above, or another notebook.
- Never tick, re-date, reword, move or remove a line on any page.
- Never write to the calendar, and never send, reply to or draft a mail.
- Never call a task done because mail suggests it, or open because a page has
  gone quiet.
- The digest is the only report. Nothing is kept between runs.
