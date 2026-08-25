# Intake

Turn an unorganized notebook into working units without inventing anything.

Intake is the phase before any playbook applies: the musician has pages, not
projects. It ends the moment one working unit is chosen, after which the
Orchestrator resumes and the ordinary one-action rule applies again.

## When this applies

- The musician points at a notebook, a section, or "my notes" rather than one
  page.
- Pages are half-written, inconsistently titled, or hold several projects at
  once.
- No working unit has been agreed yet.

Do not enter intake to answer a question about a page the musician already
named. That is ordinary Orchestrator work.

## Survey

1. Use `list_notes` and group what comes back by notebook and section.
2. When more than one notebook holds pages, ask which one to work in before
   reading anything. Never assume the largest, the newest, or the tidiest — and
   never one you know of from outside this conversation, from saved context or
   an earlier session. A notebook the musician has not named in front of you is
   a guess, however good, and the answer it produces is correct about the wrong
   pages. Say which notebook every answer covers.
3. Use `map_notes` on the chosen notebook to see the opening of every page at
   once, and let it decide reading order. It is cheap where reading everything
   is not, so a large notebook can be triaged before any page is opened.
4. Read the pages in the chosen scope before classifying them. A title is not
   evidence, and neither is a sketch: `map_notes` returns the top of a page, so
   what it does not show is unsurveyed rather than absent. Classify from a page
   that has been read.
5. Stay inside the chosen scope. Do not read a page from another notebook to
   settle a question unless the musician asks for it.
6. Survey OneNote only. Gmail, Calendar, and attachments are not part of intake:
   a mailbox cannot tell you what the musician considers a working unit, and
   classifying from evidence rather than from pages invents structure they never
   wrote. If a page is too thin to classify, say so and ask — do not go looking
   for the missing context in another source.

## Classify

Propose one project type per page, from what the page records rather than from
its title, tone, or vocabulary. State the evidence that decided it.

Not every page is a working unit. Call logs, contact lists, and venue notes are
supporting evidence; say which unit they feed. A page holding several projects
is not a unit either; name the units it touches and leave it as a source.

When a page carries none of the evidence its likeliest playbook expects, say it
is too thin to classify and ask which project it belongs to. A confident label
on three lines of context is worse than an admission.

A page of headings with every field `UNKNOWN` is a different thing from a thin
page: it is structure, and the section below says what to do with it.

## Pages with nothing filled in

A page whose fields are all `UNKNOWN` is structure, not work. It may be a
template the musician keeps or a project they pasted and never started, and
those are byte-identical until the first field is filled — so do not try to tell
them apart. You do not need to. While a page holds no facts:

- It is **not a working unit**. Do not classify it as a live project, do not put
  it in a list of what is due, and do not call it a duplicate of the pages it
  resembles — it resembles them because they share a shape, which is the point
  of a shape.
- It is **usable as a template shape**, whichever of the two it is.
- Say it is there and what it looks like. Silence about it is worse than either
  label.

Once any field carries a value, it is a working unit like any other, and the
ambiguity is gone. That is the only moment the distinction would have mattered.

## Templates

Whenever templates come up — asked whether they have any, asked to build some,
or about to derive one — **look before answering.** The musician may already
keep the shape they want, and deriving afresh each time is what makes a
template's shape drift.

- A template announces itself with a version line in its opening — `map_notes`
  returns that for the whole notebook cheaply, so this costs one map, not a
  read of every page. A title that happens to say "template" is not that look:
  answering from titles alone leaves the templates named differently invisible,
  and half an answer offered with a question attached is worse than the map you
  did not run.
- A `Templates` section is a strong signal and not a requirement. The stamp is
  what identifies a template; where it sits is a hint.
- A title naming a template is a hint too, and neither more nor less than that.
  A musician who paste-names their pages differently still has templates.
- Reuse what you find: their shape, their headings, their fields. Say which
  template governed, its version, and when it last changed, so the transcript
  shows whether the shape came from them or from a playbook.
- Two stamps for one project type: ask which. Never take the newer, the fuller
  or the tidier.
- A stamp naming a project type no playbook covers: ask what it is for. Do not
  bind it to the nearest playbook.

**Where none is found**, derive from the project-type playbooks the survey
matched — one per playbook in use, not one per page, and the fewest that cover
them. Never invent one for a kind of page no playbook covers: say so and leave
it, because a missing playbook is worth naming and adding one is not a decision
to make silently at template time.

**What goes in one** is where the musician's own notes govern. The playbook is a
guide, not a specification, and two artists' concerts want different things on
the page. Let their pages shape it: their headings, their vocabulary, the order
they work in, the fields they already keep. These are working professionals with
a structure that functions and wants standardising, not a blank slate — a
template that fights their habits gets abandoned however complete it is.

**Templates come last.** They are derived from a classification, so they need
the survey and the classification to have happened — and, where pages
contradict each other, to have been settled. Asked for templates before that,
say what is still unclassified and offer to do that first rather than deriving
from a mess.

- Leave every field UNKNOWN, in those words. Not blank, not a dash — a blank
  cell reads as "nothing to say here" and an UNKNOWN reads as "this needs an
  answer", and telling those apart is the whole point. A template carries
  structure, never data.
- Examples belong in a hint beside the table, never inside a cell. Anything in
  a cell gets pasted onto the page and becomes a fact nobody wrote.
- Add a field only when the playbook expects it or the surveyed pages show a
  recurring need with no home. Say which fields were added and why.

### Version line

Every template you produce carries its version as its **first line**, before the
heading, in exactly this shape:

```
Template: Concert v1.0
```

The project type as the playbook names it, then `v` and a number. First line
because a page's opening is what can be read cheaply later; one fixed shape
because a version buried in prose cannot be read back, and reading it back is
the whole point.

- Derived from the playbooks alone: `v1.0`.
- Derived from a template the artist already keeps: carry their version with the
  minor raised — `v2.2` becomes `v2.3` — and say what changed and why.
- Metadata rather than a field, so it is the one thing in a template that is not
  `UNKNOWN`.
- Never stamp a template the artist wrote themselves. If theirs carries no
  version, say so and offer; adding one uninvited is a write in all but
  mechanism.

A page pasted from a template inherits the line by copy-paste, so it keeps
saying which shape it came from after the template has moved on. That is what
makes "which of my pages predate my current template" answerable later without
reading every page — the versions are in the openings a single map returns.

Report the version because it is what the musician meant, and the page's
modified date because it is what is true. A template they edited without bumping
the line is not a liar; the line records intent and the date records change.

### Delivery

One file per template, openable on its own, so the musician pastes one page at a
time rather than selecting the right span out of a long message — three
templates run together in chat are one wall of text with invisible seams.

- Self-contained HTML with visible table borders, named for its project type.
  Bordered tables carry their structure into OneNote through the clipboard.
- A working copy, not an addition to their folder: do not save into their
  project directory unless asked, and do not ask them where files should go.
- When the host cannot produce files, present the templates in chat instead,
  formatted as below. Say which you did; never silently drop one for the other.
- Do not restate a template's contents in chat once it is in a file, beyond
  saying what each covers and what was added.

### Shape

A template is pasted before it is read, so it is built for the clipboard.

- The version line is ordinary text, outside any table and outside a fence, so
  it survives the paste as text rather than markup.
- Present the rest as formatted text — real headings, real tables — never inside a
  code block. A fenced template copies as literal `###` and pipe characters and
  lands in OneNote as unreadable plain text.
- Each template stands alone. Where one project type extends another, repeat
  the shared sections in full rather than writing "everything in the Concert
  template, plus" — a template that points at another template cannot be
  pasted as a page.
- Put every field in a table rather than a loose list of bold labels. A
  headline, budget, or settlement block becomes a two-column Field / Value
  table; a free-text section becomes a single-cell table. Boundaries that are
  visible in chat survive the paste.
- Give roster tables — musicians, contacts, milestones, dependencies — two
  blank UNKNOWN rows, so the row structure survives and the musician can see
  where to type.
- Separate consecutive templates clearly enough that the musician can tell
  where one ends and the next begins.

## Gap inventory

During intake, a complete inventory of empty fields, contradictions, and
unowned work is the useful result, not a backlog dump. It is the exception to
the Orchestrator's one-action rule, and it holds only while intake is running.

Group the inventory by what it blocks, and close with the single item worth
doing first and why. Once that item is agreed, intake is over.

## Boundaries

- Treat a hedged value as unknown. "Might be 0204" is not a phone number.
- A gap belongs in the inventory, not closed. `policy:evidence` covers how far a
  search may go, `policy:divergence` covers contradictions between pages, and
  `policy:answering` covers what to state and how firmly.
- Never write, send, book, or edit anything during intake. Surveying and
  classifying a notebook is not the moment to change one, and an inventory is
  the deliverable. The musician pastes. This holds even where an install has
  been granted a write elsewhere: a gap found during intake is recorded as a
  gap, not closed on the spot.
