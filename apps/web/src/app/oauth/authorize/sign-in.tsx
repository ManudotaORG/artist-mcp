'use client';

import { useActionState } from 'react';
import { Typography } from '@/components/ui/Typography';
import { sendLink } from './actions';

/**
 * Sign-in, in the middle of an authorization request. The link returns here
 * rather than to the home page, so the flow the client started can continue
 * instead of stranding someone on a page with no way back.
 */
export const SignInToAuthorize = ({ next }: { next: string }) => {
  const [state, action, pending] = useActionState(
    sendLink,
    null as null | {
      error?: string;
      sent?: boolean;
    },
  );

  if (state?.sent) {
    return (
      <Typography variant="small" className="mt-3">
        CHECK YOUR EMAIL. THE LINK RETURNS YOU HERE TO FINISH CONNECTING.
      </Typography>
    );
  }

  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        className="border border-foreground bg-transparent p-2 font-mono text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="border border-foreground p-2 font-mono text-sm disabled:opacity-50"
      >
        {pending ? 'SENDING…' : 'EMAIL ME A LINK'}
      </button>
      {state?.error ? (
        <Typography variant="small" className="text-signal-red">
          {state.error}
        </Typography>
      ) : null}
    </form>
  );
};
