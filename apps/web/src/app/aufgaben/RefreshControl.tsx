'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { finishRefresh, listOneNotebook, readOneNotebook, startRefresh } from './actions';

/**
 * "Aktualisieren": claims a refresh, then for each notebook in turn lists it
 * in one request and reads its CL Aufgaben pages in as many more as it takes,
 * because one function cannot always do both in sixty seconds. Each request
 * stores what it read, so a refresh that fails partway leaves the rest at
 * their older, labelled state.
 *
 * The limits are the server's, from stored times: this only reports them.
 */

/** A notebook's pages are read in at most this many requests. */
const MAX_READ_ROUNDS = 6;

type Line = { notebook: string; state: 'waiting' | 'reading' | 'done' | 'failed'; note?: string };

type RefreshControlProps = {
  disabled?: boolean;
};

const formatNext = (iso: string) =>
  new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', timeStyle: 'short' }).format(
    new Date(iso),
  );

const RefreshControl = ({ disabled = false }: RefreshControlProps) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const run = async (full: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const { claim, notebooks } = await startRefresh(full);
      if (!claim.ok) {
        setMessage(
          claim.reason === 'no_view'
            ? 'Zuerst Notizbücher auswählen.'
            : claim.reason === 'full_cooldown'
              ? `Alles neu lesen geht höchstens einmal pro Stunde, wieder ab ${claim.next_at ? formatNext(claim.next_at) : 'später'}.`
              : `Höchstens eine Aktualisierung alle zehn Minuten, wieder ab ${claim.next_at ? formatNext(claim.next_at) : 'später'}. OneNote erlaubt 400 Anfragen pro Stunde, geteilt mit dem Digest.`,
        );
        return;
      }
      setMessage(
        claim.full ? 'Alles wird neu gelesen.' : 'Nur geänderte Abschnitte werden gelesen.',
      );
      const state: Line[] = notebooks.map((notebook) => ({ notebook, state: 'waiting' }));
      setLines([...state]);
      for (const [i, notebook] of notebooks.entries()) {
        state[i] = { notebook, state: 'reading', note: 'Abschnitte' };
        setLines([...state]);
        const listed = await listOneNotebook(notebook, claim.started_at);
        if (!listed.ok) {
          state[i] = { notebook, state: 'failed', note: listed.error };
          setLines([...state]);
          continue;
        }
        // Read in as many requests as it takes, each storing what it read. One
        // that reads nothing stops the loop: whatever is left stays pending and
        // is shown with its older copy.
        let left = listed.left;
        let read = 0;
        let failure: string | null = null;
        for (let round = 0; left > 0 && round < MAX_READ_ROUNDS; round++) {
          state[i] = { notebook, state: 'reading', note: `${read} gelesen, ${left} offen` };
          setLines([...state]);
          const step = await readOneNotebook(notebook, claim.started_at);
          if (!step.ok) {
            failure = step.error;
            break;
          }
          read += step.pages;
          if (step.pages === 0) break;
          left = step.left;
        }
        state[i] =
          failure !== null
            ? { notebook, state: 'failed', note: failure }
            : left > 0
              ? {
                  notebook,
                  state: 'failed',
                  note: `${read} Seiten gelesen, ${left} nicht erreicht`,
                }
              : { notebook, state: 'done', note: `${read} Seiten gelesen` };
        setLines([...state]);
      }
      await finishRefresh();
      router.refresh();
    } catch (err) {
      setMessage(
        `Aktualisieren fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          className="min-h-11"
          disabled={busy || disabled}
          onClick={() => run(false)}
        >
          {busy ? 'Liest …' : 'Aktualisieren'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy || disabled}
          onClick={() => run(true)}
        >
          Alles neu lesen
        </Button>
      </div>
      {message !== null ? <Typography variant="small">{message}</Typography> : null}
      {lines.length > 0 ? (
        <ul className="grid gap-1" aria-live="polite">
          {lines.map((line) => (
            <li key={line.notebook}>
              <Typography
                variant="small"
                color={line.state === 'failed' ? 'red' : line.state === 'done' ? 'green' : 'muted'}
              >
                {line.notebook}:{' '}
                {line.state === 'waiting'
                  ? 'wartet'
                  : line.state === 'reading'
                    ? 'wird gelesen …'
                    : line.state === 'done'
                      ? `fertig, ${line.note}`
                      : `nicht gelesen, ${line.note}`}
              </Typography>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export { RefreshControl };
