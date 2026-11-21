# 0014 — Reading tasks across pages: a tasks mode on `map_notes`

Status: **proposed, not built.** Written for review before any code. Builds on
[0008](0008-tasks-are-onenote-tags.md) (a task is a to-do tag) and
[0010](0010-two-discovery-paths.md) (where the requests go). Nothing here
writes, and no row is added to the operation table.

## Why this is wanted

A daily digest for the musician, run as a ChatGPT scheduled task on the hosted
path: what needs them today, what is new in the mail, which deadlines are close.
It has to see the tasks of many pages in one run, unattended, inside a 60-second
function limit and OneNote's request budget. Today the only way to see a page's
tasks is `read_note`, one call per page.

## What it saves, and what it does not

Measured on 2026-11-21 against a realistic digest input: the 24 pages in the
five 2026-27 sections that changed since 14 November.

| | `read_note` per page | Task rows only |
| --- | --- | --- |
| OneNote requests | 25 | 25 — the same |
| Text returned to the model | 143,730 chars (~36k tokens) | 27,143 chars (~6.8k tokens), 19% |
| Tool calls | 24 | 1–2 |

**It saves no OneNote requests.** A page's tasks cannot be found without
fetching its content, which is exactly what `read_note` costs. The request saving
for a digest comes from `since` narrowing the section walk (27827c5: 6 requests
for that listing instead of 31), not from this. Anyone reading this later should
not mistake a tasks mode for a throttling fix.

What it does save:

- **Text.** About a fifth, with a caveat: the sample is dominated by one 69 KB
  test page carrying 108 tasks. Real project pages run at a similar ratio —
  `CL Aufgaben — Vidala-Tournee` is 19.6 KB for 18 tasks.
- **Calls.** In a scheduled task, every `read_note` is another model step that
  carries everything gathered so far. Twenty-four steps grow into several
  hundred thousand tokens processed; one or two calls stay in the tens of
  thousands. That is an estimate from the shape of the loop, not a measurement,
  and it is probably the larger saving.

Two findings from the same run shape what the mode must do:

- **Tasks are not only on `CL Aufgaben` pages.** Of 42 tasks on real project
  pages, 29 were on CL Aufgaben pages; `CL Arrangements neue Stücke` holds 11,
  and two more sit on pages named for a venue. Reading CL pages alone would
  miss a third. Every page in scope is read.
- **The date is not always on the task.** On `CL Arrangements neue Stücke` the
  deadline for all eleven tasks is in the paragraph above them ("Deadline:
  idealerweise bis 08.09.2026, spätestens bis 01.11.2026"). Rows alone would
  drop the one date that governs the page.

## Why on `map_notes`, and why that was checked first

A new tool costs its whole description on every request — `read_thread` added
about 845 characters. A mode on an existing tool costs a parameter. `map_notes`
already reads many pages in one call, stops at a deadline and names what it did
not reach, which is the hard part.

It was also the tool that ran the account out in September, so it was checked
before being extended. Three live runs on 2026-11-21, local, against the real
notebooks: no 429s, 13–21 s each, every page sketched.

| Run | Requests | 429s | Total | Map step |
| --- | --- | --- | --- | --- |
| 2027-28, whole notebook, default 20 | 32 | 0 | 13 s | 2.8 s |
| 2026-27, one section, 14 pages | 17 | 0 | 13 s | 4.1 s |
| 2026-27, whole notebook, default 20 | 56 | 0 | 21 s | 8.4 s |

Not measured on hosted, where September's timeouts appeared and a cold start
counts against the same 60 seconds.

## The proposal

### Interface

`map_notes` gains `tasks: true`. With it, each page in scope is read in full
instead of previewed, and the answer is its tasks instead of its opening.

It requires `section` or `since`. A whole-notebook task read with neither is
refused, naming the cost: 2026-27 is 161 pages behind 30 section listings, about
190 requests, nearly half the hour. The "20 newest by date" default that the map
uses is not offered here, because on this account the date is the creation date
— the twenty newest-created pages are not the twenty that matter.

With `since`, every page in a changed section is read. On an account whose page
dates are creation dates that is the only honest scope, and the answer says so:
these are the tasks on pages in sections that changed, not tasks that changed.

### What a page returns

Facts the page states, in its own words. No date is parsed, no urgency is
ranked, no task is called overdue — that is `policy:tasks`, applied by the model
to what this returns.

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
  labelled by the header row. The header is the first row, as on every task
  table seen live (`Aufgabe · Verantwortlich · Frist · Status`).
- **A task on a line** (`p` or `li`) is that line.
- **The lead** is the page's opening prose up to its first task, capped (about
  400 characters). It is where a page-wide deadline was found.
- **Done tasks are counted, not listed**, unless asked for (`include_done`). The
  digest is about open work; the janitor and the calendar reconciliation, which
  need the ticked ones, can ask.
- **A page with no tags says what it has instead**: its length, and whether it
  holds a table that looks like a task table without tags. `policy:tasks` is
  explicit that an untracked page is not a page with no work, and the tool
  saying so on the page is stronger than the policy hoping to be remembered.
- **What it leaves out is said once, in the output**: prose elsewhere on the
  page is not included, so a task is not called unsettled, done or stale on
  prose grounds without `read_note`. That is the one judgement a rows view
  cannot support, and the rule belongs where the gap is.

### Requests, time and paging

- One content request per page, the same as `read_note`. Section listing as
  today, narrowed by `since`.
- Paced under OneNote's 120 a minute. The page reads of 2026-11-21's sweep ran
  at about 127 a minute at four concurrent and drew 429s; the September cap of
  four bounds concurrency, not rate. This mode reads more pages per call than
  anything else, so it ships with a rate limit rather than relearning it.
- The 45-second deadline holds, pages it cut off are named as unread, and the
  answer carries a cursor to continue from. The cursor names a section and a
  position in it, so a continuation re-lists only from there — the sections
  call is one request; re-walking every section per continuation would cost
  thirty.
- Estimated, not measured: this week's digest input (24 pages) is one call of
  roughly 10–15 s of reads on top of a six-request listing.

### Cost on every request

One boolean, one optional boolean and a sentence in the description. Measured
with `context-budget` before it ships; anything much over 300 characters is a
sign the description is carrying rules the output should.

## What this does not do

- **Save OneNote requests per page.** See above.
- **Judge.** No overdue, no ranking, no "unsettled". The model does that, under
  `policy:tasks`, with what this returns.
- **Write.** Ticking stays where 0004 and 0008 put it.
- **Remember.** Nothing is stored between calls; the hosted scope stands.
- **Replace `read_note`.** A task the digest needs to act on, or one whose prose
  matters, is still read in full.

## How it would be verified

- Tests at request level, as for `since`: content fetched only for pages in
  scope, a cursor that resumes without re-walking, the deadline naming pages it
  cut off, and the tests failing with each guard removed.
- Fixtures shaped like the live pages: the Vidala table (spans in cells, header
  as first row), the Arrangements list with its deadline in the lead, a page of
  untagged prose, an untagged task table.
- Live, against the same 24-page input: every task the measurement script found
  is present, with the Arrangements deadline in its lead, at no more requests
  than reading the pages one by one.
- On hosted after promotion, under 60 seconds including a cold start.

## Open questions

1. **How often a whole-notebook read is acceptable.** Deadlines live on pages
   that have not changed, so a digest that only reads changed sections cannot
   see an old task coming due. A full read of the three season notebooks is
   about 270 requests. Once a morning, at a quiet hour, it fits inside the hour;
   twice does not leave room for anything else. Daily, weekly, or not at all is
   a product decision.
2. **Whether `since` alone should be allowed without `notebook`.** The digest
   wants every season's changes; today a notebook is chosen first.
3. **The lead's cap.** 400 characters held the Arrangements deadline; a page
   with a long preamble may push its deadline past it.
