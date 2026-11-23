'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { loadNotebooks, saveNotebooks } from './actions';

/**
 * Which notebooks are in the view. Chosen once, by hand: the account has
 * hundreds of sections, so reading every notebook is not affordable, and
 * which ones hold the season's projects is Ruben's to say.
 *
 * Loading the names is one listing, made only on a press.
 */

type NotebookPickerProps = {
  chosen: string[];
};

const NotebookPicker = ({ chosen }: NotebookPickerProps) => {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    const result = await loadNotebooks();
    if ('error' in result) setError(result.error);
    else setNames([...new Set([...chosen, ...result.names])]);
    setBusy(false);
  };

  return (
    <div className="grid gap-3 border border-signal-cyan p-3">
      <Typography variant="label" color="cyan">
        Notizbücher in der Ansicht
      </Typography>
      {chosen.length > 0 ? (
        <Typography variant="small">{chosen.join(', ')}</Typography>
      ) : (
        <Typography variant="small">Noch keine ausgewählt.</Typography>
      )}
      {names === null ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 justify-self-start"
          disabled={busy}
          onClick={load}
        >
          {busy ? 'Lädt …' : chosen.length > 0 ? 'Auswahl ändern' : 'Notizbücher laden'}
        </Button>
      ) : (
        <form action={saveNotebooks} className="grid gap-2">
          {names.map((name) => (
            <label key={name} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                name="notebook"
                value={name}
                defaultChecked={chosen.includes(name)}
                className="size-5 accent-signal-yellow"
              />
              <Typography as="span" variant="small">
                {name}
              </Typography>
            </label>
          ))}
          <Button type="submit" className="min-h-11 justify-self-start">
            Speichern
          </Button>
        </form>
      )}
      {error !== null ? (
        <Typography variant="small" color="red">
          {error}
        </Typography>
      ) : null}
    </div>
  );
};

export { NotebookPicker };
