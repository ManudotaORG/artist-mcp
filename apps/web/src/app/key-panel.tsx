'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { createKey, revokeKey } from './actions';

type KeyPanelProps = {
  hasKey: boolean;
  canGenerate: boolean;
};

const KeyPanel = ({ hasKey, canGenerate }: KeyPanelProps) => {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const generate = () =>
    start(async () => {
      setError(null);
      const response = await createKey();
      if (response.error) setError(response.error);
      else setKey(response.key ?? null);
    });

  const revoke = () =>
    start(async () => {
      setError(null);
      const response = await revokeKey();
      if (response.error) setError(response.error);
      else setKey(null);
    });

  return (
    <section className="border-t border-signal-cyan pt-5">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        CONNECTION KEY
      </Typography>
      {key ? (
        <div className="mt-4 grid gap-3">
          <code className="break-all border border-signal-yellow bg-signal-yellow p-3 font-mono text-sm text-black">
            {key}
          </code>
          <Typography variant="small" color="yellow">
            SHOWN ONCE — COPY IT NOW. DO NOT PASTE IT INTO CHAT OR SOURCE CODE.
          </Typography>
        </div>
      ) : (
        <Typography variant="small" className="mt-3">
          {hasKey
            ? 'STATUS: ACTIVE. GENERATING A NEW KEY DISCONNECTS MACHINES USING THE OLD KEY.'
            : 'STATUS: NO KEY. GENERATE ONE AFTER MICROSOFT IS CONNECTED.'}
        </Typography>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={generate} disabled={pending || !canGenerate}>
          {pending ? 'WORKING…' : hasKey || key ? 'GENERATE NEW KEY' : 'GENERATE KEY'}
        </Button>
        {hasKey || key ? (
          <Button onClick={revoke} disabled={pending} variant="outline">
            REVOKE
          </Button>
        ) : null}
      </div>
      {error ? (
        <Typography variant="small" color="red" className="mt-3" aria-live="polite">
          ERROR: {error}
        </Typography>
      ) : null}
    </section>
  );
};

export { KeyPanel };
