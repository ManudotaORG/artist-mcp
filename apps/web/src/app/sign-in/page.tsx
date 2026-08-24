import Link from 'next/link';
import { Typography } from '@/components/ui/Typography';
import { SignInForm } from '../sign-in-form';

/**
 * Sign-in, reachable but unlinked.
 *
 * Not on the landing page, because signup is closed and a form that refuses
 * every visitor is a worse promise than none. Not deleted either: hosted
 * customers sign in here, and `/oauth/authorize` sends people through the same
 * flow when a connector asks for access.
 *
 * The distinction worth keeping: an address that exists gets a link, and one
 * that does not is told plainly rather than being quietly turned into an
 * account.
 */
export const dynamic = 'force-dynamic';

const SignInPage = () => (
  <main className="mx-auto max-w-xl p-8">
    <Typography as="h1" variant="pageTitle" color="yellow">
      SIGN IN
    </Typography>

    <Typography className="mt-4">
      For accounts set up directly with us. We email you a secure link — no password.
    </Typography>

    <div className="mt-6 border border-signal-cyan p-5">
      <SignInForm />
    </div>

    <Typography variant="small" className="mt-6">
      NOTHING TO SIGN IN FOR IF YOU RUN ARTIST-MCP ON YOUR OWN MACHINE. THE INSTALL INSTRUCTIONS ON
      THE HOME PAGE ARE ALL YOU NEED, AND YOUR TOKENS STAY WITH YOU.
    </Typography>

    <Typography variant="small" className="mt-4">
      <Link href="/" className="underline">
        BACK
      </Link>
    </Typography>
  </main>
);

export default SignInPage;
