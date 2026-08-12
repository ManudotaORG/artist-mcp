'use client';

import { useState, useTransition } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { disconnectProvider } from './actions';

type Provider = 'microsoft' | 'google';

/**
 * Everything that differs between the two providers, so the panel itself does
 * not branch on which one it is rendering.
 */
const PROVIDERS: Record<
  Provider,
  { title: string; label: string; connectHref: string; disconnectWarning: string }
> = {
  microsoft: {
    title: 'MICROSOFT / ONENOTE',
    label: 'MICROSOFT',
    connectHref: '/api/auth/microsoft',
    disconnectWarning:
      'DISCONNECT MICROSOFT? YOUR ONENOTE DATA IS NOT DELETED. ' +
      'CONNECTION KEYS ARE REVOKED ONLY IF THIS IS YOUR LAST CONNECTION.',
  },
  google: {
    title: 'GOOGLE / GMAIL',
    label: 'GMAIL',
    connectHref: '/api/auth/google',
    disconnectWarning:
      'DISCONNECT GMAIL? YOUR MAIL IS NOT DELETED. ' +
      'CONNECTION KEYS ARE REVOKED ONLY IF THIS IS YOUR LAST CONNECTION.',
  },
};

/**
 * Fixed locale and time zone.
 *
 * toLocaleString() renders in the server's locale during SSR and the browser's
 * on hydration, so a connected account produced a hydration mismatch on every
 * load — 12/08/2026, 19:20:29 against 8/12/2026, 7:20:29 PM. Pinning both ends
 * of the format is what makes the two agree.
 */
const formatTimestamp = (iso: string): string =>
  `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(iso))} UTC`;

type ConnectionPanelProps = {
  provider: Provider;
  connection: { updated_at: string } | null;
};

const ConnectionPanel = ({ provider, connection }: ConnectionPanelProps) => {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = PROVIDERS[provider];

  const disconnect = () =>
    start(async () => {
      setError(null);
      const response = await disconnectProvider(provider);
      if (response.error) {
        setError(response.error);
        return;
      }
      setConfirming(false);
    });

  return (
    <section className="border-t border-signal-cyan pt-5">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        {copy.title}
      </Typography>
      <Typography variant="small" className="mt-3">
        {connection
          ? `STATUS: CONNECTED · LAST UPDATED ${formatTimestamp(connection.updated_at)}`
          : 'STATUS: NOT CONNECTED'}
      </Typography>
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={copy.connectHref}
          className={buttonVariants({ variant: connection ? 'outline' : 'default' })}
        >
          {connection ? `RECONNECT ${copy.label}` : `CONNECT ${copy.label}`}
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
          aria-label={`Confirm disconnect ${copy.label}`}
        >
          <Typography variant="small" color="red">
            {copy.disconnectWarning}
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

export { ConnectionPanel };
