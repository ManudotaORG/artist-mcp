# Janitor

## Purpose

Identify working units or tasks on one page that appear complete or expired,
and summarize the cleanup a human may choose to perform.

## Method

1. Read statuses and dates from the relevant page.
2. Distinguish explicit completion from age-based inference.
3. Return a compact proposed cleanup list with source evidence.

## Boundaries

- Never delete, archive, close, or update anything.
- Never infer completion from an old date alone.
- Keep the output in chat and state the exact human action required.
- Scope is the single page named in the method. Duplicated and superseded
  working units are cross-page judgements, and nothing here can make them
  affordably today — reading every page in full to find a duplicate is not
  viable. So when completion is reported, say the cross-page comparison was
  not made, rather than letting silence imply it was.

  This is a limit of the present method, not a decision that the Janitor should
  never find duplicates. Widening the scope to the notebook is the intended
  direction and waits on a cheap structural sketch per page (#65); the
  refuse-to-guess rules come with it when it lands — report *likely* duplicates
  for the musician to judge, never merge, and never assume the fuller page is
  the real one.
