"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import { Button } from "@/components/ui/button";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, null);

  if (state && "sent" in state && state.sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Check your email for a sign-in link.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        className="h-9 rounded-md border px-3 text-sm"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
      {state && "error" in state && state.error ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}
    </form>
  );
}
