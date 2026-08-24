import { Typography } from '@/components/ui/Typography';
import { SCOPE, admin, redirectAllowed } from '@/lib/oauth';
import { supabaseServer } from '@/lib/supabase/server';
import { approve } from './actions';
import { SignInToAuthorize } from './sign-in';

/**
 * The consent screen.
 *
 * Two failure modes are treated very differently, and the difference matters
 * more than it looks. If the client or its redirect_uri cannot be verified,
 * nothing is sent anywhere — the error is shown here, because redirecting to an
 * unverified target is exactly the attack the verification exists to stop.
 * Everything else is the client's business and travels back to it.
 */
export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;

const one = (params: Params, key: string): string => {
  const value = params[key];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};

const Refusal = ({ title, detail }: { title: string; detail: string }) => (
  <main className="mx-auto max-w-xl p-8">
    <Typography as="h1" variant="label" color="cyan">
      {title}
    </Typography>
    <Typography className="mt-4">{detail}</Typography>
    <Typography variant="small" className="mt-6">
      Nothing was sent back to the application that sent you here, because this request could not be
      verified.
    </Typography>
  </main>
);

const AuthorizePage = async ({ searchParams }: { searchParams: Promise<Params> }) => {
  const params = await searchParams;

  const clientId = one(params, 'client_id');
  const redirectUri = one(params, 'redirect_uri');
  const challenge = one(params, 'code_challenge');
  const method = one(params, 'code_challenge_method');
  const responseType = one(params, 'response_type');
  const state = one(params, 'state');

  if (!clientId || !redirectUri) {
    return (
      <Refusal title="INCOMPLETE REQUEST" detail="A client_id and redirect_uri are required." />
    );
  }

  const { data: client } = await admin()
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle();

  if (!client) {
    return <Refusal title="UNKNOWN APPLICATION" detail="This client is not registered here." />;
  }

  if (!redirectAllowed(client.redirect_uris as string[], redirectUri)) {
    return (
      <Refusal
        title="REDIRECT NOT REGISTERED"
        detail="This application asked to be sent somewhere it did not register."
      />
    );
  }

  // From here the client is verified, so failures can be reported to it.
  const back = (error: string, description: string) => {
    const target = new URL(redirectUri);
    target.searchParams.set('error', error);
    target.searchParams.set('error_description', description);
    if (state) target.searchParams.set('state', state);
    return target.toString();
  };

  if (responseType !== 'code') {
    return (
      <Refusal
        title="UNSUPPORTED"
        detail={`Only response_type=code is supported. Send the client to: ${back('unsupported_response_type', 'Only the authorization code flow is supported.')}`}
      />
    );
  }

  if (!challenge || method !== 'S256') {
    return (
      <Refusal
        title="PKCE REQUIRED"
        detail="A code_challenge with code_challenge_method=S256 is required. Plain challenges are refused rather than silently downgraded, because they can be replayed by anyone who saw the request."
      />
    );
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const selfUrl = `/oauth/authorize?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: method,
    response_type: responseType,
    ...(state ? { state } : {}),
  }).toString()}`;

  const name = (client.client_name as string | null) ?? 'An application';

  return (
    <main className="mx-auto max-w-xl p-8">
      <Typography as="h1" variant="label" color="cyan">
        CONNECT {name.toUpperCase()}
      </Typography>

      <Typography className="mt-4">
        {name} is asking to read your notes, mail and calendar through artist-mcp.
      </Typography>

      {/*
        The sentence issue #55 asks be said plainly, to the person it is about,
        at the moment they decide. It is the same sentence the public page
        carried while this architecture was live.
      */}
      <div className="mt-5 border border-foreground p-4">
        <Typography variant="small">
          YOUR TOKENS ARE STORED ON OUR INFRASTRUCTURE SO THIS WORKS WHILE YOUR MACHINE IS OFF. A
          MAINTAINER CAN TECHNICALLY READ WHAT THEY REACH.
        </Typography>
      </div>

      {user ? (
        <form action={approve} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={challenge} />
          <input type="hidden" name="state" value={state} />
          <Typography variant="small">SIGNED IN AS {user.email?.toUpperCase()}</Typography>
          <button
            type="submit"
            className="border border-foreground bg-signal-cyan p-2 font-mono text-sm text-black"
          >
            ALLOW ACCESS
          </button>
          <a
            href={back('access_denied', 'The person refused this request.')}
            className="text-center font-mono text-sm underline"
          >
            CANCEL
          </a>
        </form>
      ) : (
        <>
          <Typography variant="small" className="mt-6">
            SIGN IN TO CONTINUE. ACCOUNTS ARE NOT SELF-SERVED — IF YOURS DOES NOT EXIST, THIS WILL
            SAY SO RATHER THAN CREATING ONE.
          </Typography>
          <SignInToAuthorize next={selfUrl} />
        </>
      )}

      <Typography variant="small" className="mt-8">
        SCOPE: {SCOPE.toUpperCase()}
      </Typography>
    </main>
  );
};

export default AuthorizePage;
