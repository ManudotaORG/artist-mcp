# 0016 — A named notebook lists only its own sections

Status: **accepted and built; the first deploy regressed on hosted and was fixed — fix verified locally, not yet on hosted.** Amends the
request table in [0010](0010-two-discovery-paths.md), whose first row, "every
section on the account: 1 request", is true only below a hundred sections.

## What happened

On 2026-11-21, once hosted `map_notes` on the 30-section 2026-27 notebook
finally returned (after #257 and #258), its new log lines showed where the
budget went. The map was handed 11.9 s of its 45, so about 33 s were spent
before it started. Listing 2026-27's pages took 10 s, and the token lookups
together under a third of a second. That leaves about 23 s, and the only call
in that stretch is `list_notebooks`.

The account hosted serves has **57 notebooks and 429 sections**. Graph returns at
most 100 sections a response and sends no `@odata.nextLink` on this endpoint
(`fetchSections` pages with `$skip` for that reason), so the listing is **five
requests in a row**, each one waiting for the last. Measured locally the same
day, one such request takes 4.5–5.3 s, so five is about 23 s: the gap,
accounted for by arithmetic. No log line measures it directly. Shipping one
would have cost a promotion to print a number already known, so none was added.

The local account has 7 notebooks and 61 sections, so the same listing is one
request there. This is why nobody saw it: the path is slow only on an account
the developer does not use.

## Who pays for the whole account

Every call that names a notebook pays first for every section on the account,
because the full list serves four purposes:

1. **The notebook question.** Names, and a section count per notebook, so the
   user can tell them apart.
2. **Checking a named notebook.** The name must exist, and `notebook_key` is
   derived from the full list of names.
3. **A named notebook's sections**, handed on to `list_notes` so it does not
   fetch them again.
4. **A section named without a notebook** (`findSectionAcrossNotebooks`), and
   the near-miss suggestions when a section name matches nothing, which search
   across notebooks.

Only (3) is about one notebook, and it is the path every working call takes.
(2) needs names, not sections. (1) and (4) genuinely span the account.

## The decision

**When a notebook is named, list its notebooks and its sections, not the
account's.**

- **Names** from `GET /me/onenote/notebooks?$select=id,displayName`: one
  request, 1.7 s locally. Enough for the existence check and `notebook_key`.
  The key is derived from the same names as now, so a key already issued stays
  valid.
- **Sections** from `GET /me/onenote/sections?$filter=parentNotebook/id eq '{id}'`,
  with the same `$select`/`$expand` as today and paged the same way. Accepted by
  Graph and measured locally: 30 sections in one request, 4.3 s, matching the
  full listing section for section.
- The two requests do not depend on each other except for the notebook id, so
  the names come first and the filtered listing second. Two requests, about
  6 s, against five and about 23 s on the hosted account.

The notebook question (1) and the cross-notebook search (4) keep the full
listing. Both are about the whole account, both are asked far less often than
the working path, and both still fit the budget on their own.

### Why the filter and not `/notebooks/{id}/sections`

`/notebooks/{id}/sections` is faster (2.0 s locally) and returned the same 30.
But it returns only sections directly under the notebook. **Sections inside a
section group are left out**, and so are they from
`/notebooks?$expand=sections`, which would otherwise give every notebook's count
in one request (2.5 s).

The local account has no section groups, so that could not be tested here, and
the hosted account cannot be inspected from this machine. A section missing
from the list reads as a section that does not exist, which is the failure the
`$skip` paging was written to stop. The filter runs against the same
account-wide listing as today, so a section in a group still carries its
`parentNotebook` and is included. It is the variant that stays correct without
knowing the account's shape. The 2 s difference is not worth that risk.

## What this knowingly accepts

- **The saving is measured on one side only.** The filtered request was timed on
  a 61-section account. Whether Graph filters 429 sections as fast as 61 is not
  known; if it scans the whole account to filter, the request may cost close to
  one full page. Even then it is one round trip instead of five.
- **Two requests where there was one** on small accounts: 1.7 s + 4.3 s against
  5.3 s locally, so roughly even there. The win is on large accounts, which is
  where the budget runs out.
- **The `since` narrowing still works**, because `narrowSections` filters on each
  section's `lastModifiedDateTime`, which the filtered listing still returns.

## How it would be verified

- Request-level tests: a named notebook makes the names request and one filtered
  listing and never the account-wide one. An unknown name is refused after the
  names request alone. The `notebook_key` from the new path equals the one from
  the old. A notebook over 100 sections pages with `$skip` on the filtered
  listing. Each fails with the old path restored.
- Live, locally: 2026-27 gives the same sections and pages through both paths.
- **On hosted, the measurement this record is missing:** the same `map_notes`
  on 2026-27, read from the existing log lines. The map's `deadline=` should rise
  from about 12 s to about 29 s, and that rise is the saving, measured where it
  matters.

## As built

- `listNotebooks(token, { notebook })` takes the narrow path only for a name
  matching exactly one notebook, and says so with `scoped`. Any other name takes
  the full path, so a refusal reads exactly as before.
- `selectNotebook` asks narrowly only when both a name and a `notebook_key` were
  given, since a name without a key is answered with the question, which needs
  the counts. If the key does not prove against the notebook listing's names, it
  asks again for the full listing. That covers a key issued from section-derived
  names on an account with an empty notebook, which the notebook listing
  includes and the section listing never does. Such an account pays the old
  cost plus one request, and is answered correctly.
- One thing narrows with it: when a notebook is named, a section name that
  matches nothing is answered with near misses from that notebook only, not
  from the whole account.

Verified on 2026-11-21:

- Five request-level tests (`one-notebook-sections.test.mjs`): no account-wide
  listing for a named, proven notebook; the question's key accepted by the
  narrow path; the empty-notebook fallback; an unknown name refused; a filtered
  listing paged past 100. The first two fail with the narrow path disabled; the
  other three exercise the function directly.
- Live on the 61-section local account: the narrow path returned the same 30
  sections for 2026-27 as the full listing, in 2 requests. A full `map_notes`
  made no account-wide section listing and was given 29.3 s of its 45. On this
  small account the narrow listing is about a second slower (5.6 s against
  4.5 s), as expected above.

## The first deploy made hosted slower

Run on hosted after #259, the same `map_notes` returned, but the map was handed
**7.0 s** of its 45, against 11.9 s before the change. The log showed three
token lookups before the listing instead of two: `list_notebooks` had run twice.
The narrow path ran, failed its own `notebook_key`, and fell back to the full
listing, so the call paid the old 23 s plus the narrow requests.

The key was the cause. The question issued it from the notebooks the *section*
listing shows; the narrow path checked it against the *notebook* listing's names.
The two differ wherever the account has a notebook the other listing does not
show — most plausibly one with no sections. The fallback built for exactly that
case turned it from a refusal into a slowdown on every call, which is why the
tests stayed green: they checked that the fallback answered, not what it cost.

Fixed by giving the key one source on both paths: the notebook listing's names
(`keyFor`). The question now fetches those names alongside the full section
listing, in parallel, so it costs a request and no time. It shows every notebook
either listing knows, so an empty notebook appears with 0 sections rather than
not at all. A key issued before the fix no longer proves, and is asked for again
once. Tests now cover an account with an empty notebook end to end: the issued
key proves the narrow path with no account-wide listing, and they fail with the
old key source restored. Still to be measured on hosted.

## Open questions

1. **Does the hosted account use section groups?** If it does not, the faster
   `/notebooks/{id}/sections` would be safe there. The filter is right either
   way, so this changes the speed, not the decision.
2. **Should the notebook question drop its per-notebook counts** to use the names
   request alone (1.7 s instead of about 23 s on hosted)? The counts help tell
   notebooks apart, and the question is asked once per session, so this record
   leaves them.
3. **Is there a cheaper cross-notebook search** for (4) than the full listing?
   Graph's `$filter` on `displayName` might do it, but that is a different change.
