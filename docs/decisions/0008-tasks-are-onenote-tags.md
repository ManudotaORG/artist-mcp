# 0008 — A task is a OneNote tag, and a finished one is ticked

Status: **accepted.** Extends [0006](0006-replacing-a-whole-table.md), which
widened what one confirmed change may rewrite. Raised by the hosted workflow in
issue #181.

## What was undecided

Whether a task on a CL Aufgabe page is a OneNote to-do tag or a line of prose
was deliberately left open. Both were in use, the pages were being brought to
v1.1 by hand, and settling it while the shape of the page was still moving would
have been settling it twice.

It is settled now, because the hosted workflow depends on it. The musician types
an update and the page is corrected to match; "the programme went to the
Musikverein" has to land somewhere a later question can find it, and prose that
says a thing is done reads exactly like prose that says it should be done.

## The decision

A task is `data-tag="to-do"` on the paragraph or list item that states it. A
finished task is `data-tag="to-do:completed"` on that same line — ticked, not
deleted, and not rewritten into the past tense.

Nothing else is written. OneNote defines dozens of tags — `important`,
`question`, `remember-for-later` — and every one of them is a claim about the
line it marks. A model writing `important` is a judgement arriving as page
markup, which is the thing this repository spends most of its rules preventing.
Two values have an agreed meaning here; the rest stay out until something
actually asks for them.

The tag is allowed on `p` and `li` only. OneNote renders a checkbox wherever the
attribute lands, so a tag on a table cell or a heading is a checkbox in a place
nobody put a task.

## Why ticking rather than removing

A removed task and a task that was never there are the same page. The record of
what was done is most of what a project page is for, and the musician asking
"did we send the programme?" in March needs the answer to survive, which a
deletion does not.

Ticking also matches what the page already looks like in OneNote's own UI, where
the box is the control. A page this tool maintains should not be distinguishable
from one the musician maintains.

## What this cost in code

`htmlToText` has rendered these tags as `[ ]` and `[x]` since before anything
could write. The attribute allowlist in `onenote-patch.ts` refused them, so a
patch carrying one was rejected outright.

That asymmetry is the interesting part of this record. A task could be read,
reported in an answer, and never recorded — the page kept whichever checkbox it
already had, and a task the musician had just finished stayed open. Nothing
failed loudly: the read path was complete, the write path refused, and the two
were never exercised together until a hosted session tried to tick something.

`data-tag` is now allowed on `p` and `li`, with the value checked against the
two above. The check sits beside the `style` one, in the same pass, for the same
reason: an attribute this tool will send is not the same question as a value it
will send.

## What would reverse it

A tag whose meaning the musician has actually agreed — a `question` marking
something genuinely open, say, used consistently on their own pages first. The
list is cheap to widen and expensive to narrow again, which is the order to do
it in.
