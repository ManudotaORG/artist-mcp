'use client';

import { useState, useTransition } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { disconnectMicrosoft } from './actions';

type MicrosoftConnectionPanelProps = {
  connection: { updated_at: string } | null;
};

const MicrosoftConnectionPanel = ({ connection }: MicrosoftConnectionPanelProps) => {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const disconnect = () =>
    start(async () => {
      setError(null);
      const response = await disconnectMicrosoft();
      if (response.error) {
        setError(response.error);
        return;
      }
      setConfirming(false);
    });

  return (
    <section className="border-t border-signal-cyan pt-5">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        MICROSOFT / ONENOTE
      </Typography>
      <Typography variant="small" className="mt-3">
        {connection
          ? `STATUS: CONNECTED · LAST UPDATED ${new Date(connection.updated_at).toLocaleString()}`
          : 'STATUS: NOT CONNECTED'}
      </Typography>
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href="/api/auth/microsoft"
          className={buttonVariants({ variant: connection ? 'outline' : 'default' })}
        >
          {connection ? 'RECONNECT MICROSOFT' : 'CONNECT MICROSOFT'}
        </a>
        {connection && !confirming ? (
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            DISCONNECT
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div
          className="mt-4 border border-signal-red p-4"
          role="group"
          aria-label="Confirm disconnect"
        >
          <Typography variant="small" color="red">
            DISCONNECT MICROSOFT AND REVOKE EVERY CONNECTION KEY? YOUR ONENOTE DATA IS NOT DELETED.
          </Typography>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="destructive" disabled={pending} onClick={disconnect}>
              {pending ? 'DISCONNECTING…' : 'YES, DISCONNECT'}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              CANCEL
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <Typography variant="small" color="red" className="mt-3" aria-live="polite">
          ERROR: {error}
        </Typography>
      ) : null}
    </section>
  );
};

export { MicrosoftConnectionPanel };
