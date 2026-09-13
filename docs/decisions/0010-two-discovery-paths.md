# 0010 — Two ways into a notebook: intake surveys, working goes by section

Status: **accepted and built.** Changes what `list_notes` returns for a notebook
and where `map_notes` belongs. Leaves intake's method intact.

## What happened

On 2026-09-13 hosted `map_notes` timed out every time and then, once that was
fixed, ran the account out of OneNote requests. The timeout had a cause of its
own (#212: one Graph round trip per section, at 3.4–4.4 s each). The rate limit
did not, and it is the one this record is about.

Microsoft limits OneNote to **120 requests a minute and 400 an hour per app per
user**, five concurrent, and sends no `Retry-After` on most refusals
([throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits)).
Requests inside a `$batch` count one by one. Hosted and the local CLI are one app
registration, so ChatGPT and Claude Desktop spend the same 400.

## Where the requests went

| Operation | OneNote requests |
| --- | --- |
| Every section on the account, with last-changed dates | 1 |
| The pages of one section | 1 per section |
| The preview of a page | 1 per page |
| `read_note` | 1 |

On a 28-section notebook, a typical question — `list_notes`, then `map_notes`,
then one read — walked every section twice, because each call is stateless on
hosted: about 1 + 28 + 1 + 28 + 20 + 1 ≈ 79 requests. Five questions and the
hour is gone. #215 cut a map to about 50, which still leaves the walk as the
dominant cost and repeats it on every notebook-wide call.

## Why the map existed, and why that is still right for intake

`map_notes` was built to save requests: a preview is cheaper than a read, so a
notebook could be triaged before any page was opened. For a notebook nobody has
sorted, that is still the cheapest honest way in. There are no sections to lean
on and no summary pages, and `policy:intake` depends on it — the survey reads
every page's opening, and templates are found by the `Template: … vN` line in
that opening, which one map returns for the whole notebook.

What changed is the notebook. Most of it is past intake: a project is a section,
and its CL Aufgaben page is the summary. There the sketch already exists, curated,
and the section list that points at it is one request. Mapping the notebook to
answer a question about one project pays for every page to find a page whose
name was known.

## The decision

**Discovery has two paths, and the tools default to the cheap one.**

- **`list_notes` on a notebook returns its sections**, with when each last
  changed, from the request the notebook question already made: no page is
  fetched. Pages come back for a named `section`, one request more. `since`
  still walks pages, because what changed is a page-level question.
- **`map_notes` stays notebook-wide and gains `section`.** Its description states
  its cost and that it is for surveying an unfamiliar notebook once.
- **Intake** (both packs) keeps the map and runs it once per intake, or on one
  section when intake is scoped to one.
- **Working in an organised notebook** (the custom pack, in `policy:intake`, which
  loads in full): a question about a project goes section → CL Aufgaben page →
  read. No notebook-wide map. The Project Manager's "what is due across the
  notebook" reads each project's CL Aufgaben page instead of sketching every
  page, which is also where dated work actually is.
- **Reuse.** List results say that names and ids stay valid for the
  conversation. Hosted cannot cache between calls; the conversation can.

"What is open on Melk?" goes from about 79 requests to about three.

## What this gives up

- **Page-level change detection across a notebook** is no longer the default. A
  notebook answers "which sections changed", and pages are listed only for those.
  On this account page dates are creation dates anyway (#122).
- **A sketch of pages never sorted into sections**, without asking for it. Intake
  still does exactly that, deliberately and once.

## Not done

A short-lived cache of the page listing was considered and left for a separate
decision: it helps local installs more than hosted, and it means holding page
titles in memory, which `scope.md`'s "no workflow state" has to be weighed
against first.

## What would reverse this

- Microsoft raising or removing the hourly limit for delegated OneNote access.
- A way to list a notebook's pages in one request. `$expand=pages` on sections
  was tried on 2026-09-13 and refused with `501 20111`.
