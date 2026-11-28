'use client';

import { useActionState, type ReactNode } from 'react';

import { Typography } from '@/components/ui/Typography';
import type { TickState } from '@/lib/task-tick-view';
import { cn } from '@/lib/utils';
import { tickOne, undoOne } from './actions';

/**
 * The box beside an open task (0023): one click ticks it done in OneNote, in
 * one call, and "Rückgängig" takes that tick back through undo_write. Ruben's
 * click is the yes (0019 decision 1), so nothing asks first.
 *
 * A plain form posting to a server action, so it works before this script has
 * loaded. The write id that "Rückgängig" needs is held here and nowhere else:
 * once the page is left, a tick is undone in OneNote (0023, question 3).
 */

const IDLE: TickState = { status: 'idle' };

type TickBoxProps = {
  taskKey: string;
  /** The page in OneNote, for when a tick cannot be made from here. */
  onenoteHref: string | null;
  children: ReactNode;
};

const TickBox = ({ taskKey, onenoteHref, children }: TickBoxProps) => {
  const [ticked, tick, ticking] = useActionState(tickOne, IDLE);
  const [undone, undo, undoing] = useActionState(undoOne, IDLE);

  const done =
    ticked.status === 'ticked' &&
    !(undone.status === 'undone' && undone.write_id === ticked.write_id);
  const refusal =
    undone.status === 'refused' && done
      ? undone.message
      : ticked.status === 'refused'
        ? ticked.message
        : null;

  return (
    <div>
      <div className="flex items-start gap-1">
        {done ? (
          <span
            aria-label="Erledigt"
            className="flex size-11 shrink-0 items-center justify-center text-xl text-signal-cyan"
          >
            ☑
          </span>
        ) : (
          <form action={tick}>
            <input type="hidden" name="key" value={taskKey} />
            <button
              type="submit"
              disabled={ticking}
              aria-label="Abhaken"
              title="Abhaken"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center text-xl text-muted-foreground hover:text-foreground disabled:cursor-wait"
            >
              {ticking ? '…' : '☐'}
            </button>
          </form>
        )}
        <div className={cn('min-w-0 flex-1', done && 'text-muted-foreground line-through')}>
          {children}
        </div>
      </div>
      {ticking ? (
        <Typography variant="small" color="muted" className="pb-2 pl-12">
          wird abgehakt…
        </Typography>
      ) : null}
      {done && ticked.status === 'ticked' ? (
        <div className="flex flex-wrap items-center gap-x-3 pb-2 pl-12">
          <Typography as="span" variant="small" color="muted">
            erledigt in OneNote
            {ticked.status_before !== null ? ` · Status war: ${ticked.status_before}` : ''}
            {ticked.verified ? '' : ' · noch nicht zurückgelesen'}
            {ticked.response_lost
              ? ' · OneNote hat nicht geantwortet, die Seite zeigt die Aufgabe aber erledigt'
              : ''}
          </Typography>
          {ticked.write_id !== null ? (
            <form action={undo}>
              <input type="hidden" name="write_id" value={ticked.write_id} />
              <input type="hidden" name="page_id" value={ticked.page_id} />
              <button
                type="submit"
                disabled={undoing}
                className="inline-flex min-h-11 cursor-pointer items-center font-mono text-sm font-bold text-signal-cyan underline underline-offset-4 disabled:cursor-wait"
              >
                {undoing ? 'wird zurückgenommen…' : 'Rückgängig'}
              </button>
            </form>
          ) : onenoteHref !== null ? (
            <a
              href={onenoteHref}
              className="inline-flex min-h-11 items-center font-mono text-sm font-bold text-signal-cyan underline underline-offset-4"
            >
              In OneNote rückgängig machen
            </a>
          ) : null}
        </div>
      ) : null}
      {refusal !== null ? (
        <div className="flex flex-wrap items-center gap-x-3 pb-2 pl-12">
          <Typography as="span" variant="small" color="yellow">
            {refusal}
          </Typography>
          {onenoteHref !== null ? (
            <a
              href={onenoteHref}
              className="inline-flex min-h-11 items-center font-mono text-sm font-bold text-signal-cyan underline underline-offset-4"
            >
              In OneNote abhaken
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export { TickBox };
