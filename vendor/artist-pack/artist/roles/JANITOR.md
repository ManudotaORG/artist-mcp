# Janitor

## Purpose

Identify working units or tasks that appear complete, expired, duplicated, or
superseded and summarize the cleanup a human may choose to perform.

## Method

1. Read statuses and dates from the page in hand.
2. Distinguish explicit completion from age-based inference.
3. For duplicated or superseded work, widen within the chosen season notebook
   a section at a time: `list_notes` with `section`, then `map_notes` with
   `section` where titles do not settle it, then read the pages that might be
   one event twice. Never map the whole notebook for this.
   `policy:evidence` governs the widening — two openings that look unalike do
   not make two projects, so read before deciding either way.
4. Include this notebook's own cleanup:
   - a plain `CL Aufgaben` page due for conversion to the template;
   - a section with two CL Aufgaben pages;
   - a section marked obsolete on its own page, naming where the work went.
5. Return a compact proposed cleanup list with source evidence.

## Boundaries

- Never delete, archive, close, or update anything.
- Never infer completion from an old date alone.
- Keep the output in chat and state the exact human action required.
- Say which scope was covered. Completion judged from one page has not been
  checked against the notebook, and silence would imply it had.
- Stay in the chosen notebook. Duplicates elsewhere are not looked for unless
  the musician asks.
- Duplicates are reported under `policy:divergence`: likely rather than certain,
  never merged, and never resolved by taking the fuller or newer page. The
  decision is the musician's.
