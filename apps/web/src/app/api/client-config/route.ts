import { NextResponse } from 'next/server';

/**
 * Hands the installed MCP the Google client secret it needs to complete OAuth.
 *
 * Google refuses the token exchange for a Desktop client without a secret, and
 * the client types that need none are the ones where the loopback redirect is
 * deprecated — so the package must present one. The alternative was baking it
 * into the published npm tarball, which puts a live Google credential in a
 * public package where Google's own tooling objects to finding it.
 *
 * This endpoint is deliberately unauthenticated, and that is not an oversight.
 * The value reaches every user's machine either way, so gating it would protect
 * nothing while forcing a new install to hold a credential before it has one.
 * What changes is only where the value is published from: an endpoint we can
 * rotate, rather than a tarball that is immutable once released.
 *
 * So: not a secret, despite the name Google gives it. PKCE is what binds the
 * authorization code to the request that started it; this adds no protection.
 * Nothing that actually needs protecting may be served from here.
 *
 * The client caches what it gets, because a refresh needs the secret too and
 * must keep working when this endpoint is unreachable.
 */
export const GET = () => {
  const googleClientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET;

  if (!googleClientSecret) {
    // 503 rather than 500: the deployment is missing configuration, and the
    // installed copy should treat it as "try later", not "this build is broken".
    return NextResponse.json(
      { error: 'This deployment has no Google desktop client configured.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { google_client_secret: googleClientSecret },
    {
      // Cached at the edge: the value changes only when it is rotated, and a
      // connect flow should not wait on a cold function.
      headers: { 'cache-control': 'public, max-age=300, s-maxage=3600' },
    },
  );
};
