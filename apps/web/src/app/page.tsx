import { supabaseServer } from '@/lib/supabase/server';
import { signOut } from './actions';
import { SignInForm } from './sign-in-form';
import { KeyPanel } from './key-panel';
import { Button, buttonVariants } from '@/components/ui/button';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  // Async in Next 16.
  const { error, connected } = await searchParams;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS scopes both of these to the signed-in user.
  const [{ data: connection }, { data: keyRow }] = user
    ? await Promise.all([
        supabase.from('connections').select('updated_at').maybeSingle(),
        supabase.from('mcp_keys').select('last_used_at').maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 p-8">
      <div>
        <h1 className="text-xl font-semibold">artist-mcp</h1>
        <p className="text-sm text-muted-foreground">
          Connect your Microsoft account so Claude can read your OneNote notes.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {connected ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Microsoft connected.
        </p>
      ) : null}

      {!user ? (
        <SignInForm />
      ) : (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Microsoft</h2>
            <p className="text-sm text-muted-foreground">
              {connection
                ? `Connected. Last updated ${new Date(connection.updated_at).toLocaleString()}.`
                : 'Not connected.'}
            </p>
            <div>
              {/* A plain link, not a form: the route issues a redirect to
                  Microsoft, and this Button has no `asChild` slot support. */}
              <a
                href="/api/auth/microsoft"
                className={buttonVariants({
                  size: 'sm',
                  variant: connection ? 'outline' : 'default',
                })}
              >
                {connection ? 'Reconnect' : 'Connect Microsoft'}
              </a>
            </div>
          </div>

          <KeyPanel hasKey={Boolean(keyRow)} />

          <form action={signOut} className="border-t pt-4">
            <p className="mb-2 text-xs text-muted-foreground">{user.email}</p>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      )}
    </main>
  );
}
