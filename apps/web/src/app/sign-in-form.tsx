'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { signIn } from './actions';

const SignInForm = () => {
  const [state, action, pending] = useActionState(signIn, null);

  if (state && 'sent' in state && state.sent) {
    return (
      <div className="border border-signal-green p-4" role="status">
        <Typography variant="label" color="green">
          LINK SENT
        </Typography>
        <Typography variant="small" className="mt-2">
          Check your email and open the secure sign-in link in this browser.
        </Typography>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="sr-only" htmlFor="email">
        Email address
      </label>
      <input
        id="email"
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="YOU@EXAMPLE.COM"
        className="h-11 border border-foreground bg-background px-3 font-mono text-base uppercase outline-none placeholder:text-muted-foreground focus:border-signal-yellow focus:ring-2 focus:ring-signal-yellow"
      />
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? 'SENDING…' : 'SEND MAGIC LINK'}
      </Button>
      {state && 'error' in state && state.error ? (
        <Typography variant="small" color="red" className="sm:col-span-2" as="p">
          ERROR: {state.error} Try again.
        </Typography>
      ) : null}
    </form>
  );
};

export { SignInForm };
