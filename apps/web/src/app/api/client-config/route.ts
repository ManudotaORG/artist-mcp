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
/**
 * How long a Google refresh token survives, published rather than compiled in.
 *
 * Google expires refresh tokens issued by an app in **Testing** publishing
 * status after seven days (#94). That is a fact about the OAuth consent screen
 * in the Google Cloud console, not about this repository, and an installed copy
 * has no way to read it. Baking it into the package would mean every install
 * kept warning about a limit that no longer applied for as long as it took
 * everyone to upgrade — the package telling users something false about its own
 * provider.
 *
 * So it is served, like the secret above and for the same reason: publishing
 * the app becomes an environment change, and every new connection stops
 * claiming an expiry without a release.
 *
 * Unset means no stated limit, which is what a verified app should say. It is
 * set explicitly on both deployments while the app is in Testing rather than
 * defaulting to seven, so a deployment cannot assert a limit nobody configured.
 */
const refreshTokenDays = (): number | undefined => {
  const raw = process.env.GOOGLE_REFRESH_TOKEN_DAYS;
  if (raw === undefined || raw.trim() === '') return undefined;

  const days = Number(raw);
  // A misconfigured value is dropped rather than served. A connection that
  // records no expiry warns about nothing, which is the harmless failure; one
  // that records NaN days would report nonsense to the user in a terminal.
  return Number.isFinite(days) && days > 0 ? days : undefined;
};

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

  const days = refreshTokenDays();

  return NextResponse.json(
    {
      google_client_secret: googleClientSecret,
      // Omitted rather than null when there is no limit, so an older install
      // that never reads it is unaffected and a newer one records no expiry.
      ...(days === undefined ? {} : { google_refresh_token_days: days }),
    },
    {
      // Cached at the edge: the value changes only when it is rotated, and a
      // connect flow should not wait on a cold function.
      headers: { 'cache-control': 'public, max-age=300, s-maxage=3600' },
    },
  );
};
