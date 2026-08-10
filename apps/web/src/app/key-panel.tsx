'use client';

import { useState, useTransition } from 'react';
import { createKey, revokeKey } from './actions';
import { Button } from '@/components/ui/button';

export const KeyPanel = ({ hasKey }: { hasKey: boolean }) => {
  // Held in component state only. The server cannot show it again, so leaving
  // the page loses it — which the copy below says plainly.
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const generate = () =>
    start(async () => {
      setError(null);
      const res = await createKey();
      if (res.error) setError(res.error);
      else setKey(res.key ?? null);
    });

  const revoke = () =>
    start(async () => {
      setError(null);
      const res = await revokeKey();
      if (res.error) setError(res.error);
      else setKey(null);
    });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Connection key</h2>

      {key ? (
        <div className="flex flex-col gap-2">
          <code className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{key}</code>
          <p className="text-xs text-muted-foreground">
            Shown once — copy it now. Then run{' '}
            <code className="font-mono">npx @manudota/artist-mcp init</code> and paste it.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hasKey
            ? 'A key is active. Generating a new one replaces it and disconnects any machine using the old key.'
            : 'No key yet.'}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={generate} disabled={pending} size="sm">
          {hasKey || key ? 'Generate new key' : 'Generate key'}
        </Button>
        {hasKey || key ? (
          <Button onClick={revoke} disabled={pending} size="sm" variant="outline">
            Revoke
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
};
