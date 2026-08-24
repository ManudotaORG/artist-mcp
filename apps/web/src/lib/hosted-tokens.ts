import 'server-only';

import { GraphError } from '@manudota/artist-mcp/client';
import { PROVIDERS, postToken } from '@manudota/artist-mcp/oauth';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side token custody, for clients that cannot run a local process.
 *
 * This is the half of issue #55 that no protocol removes: acting for someone
 * while their machine is off means holding their credentials. What follows is
 * the mechanics of doing that without losing them.
 *
 * The local package refreshes on every call, which is correct on one machine
 * running one thing at a time. Here it is not, for a reason that is easy to
 * miss: Microsoft invalidates a refresh token the instant it issues the
 * replacement, so two concurrent requests both refresh, both write, and the
 * loser's token is the one the next call spends. The connection dies silently,
 * one call later, and nothing in the failure names the cause.
 *
 * Two mechanisms, doing different jobs:
 *
 *   The cache turns refreshing from a per-request event into an hourly one.
 *   That is not about speed. It is how often the window opens at all.
 *
 *   The lease makes the window safe when it does open, because rarely is not
 *   never and the failure is silent.
 */

type ProviderName = 'microsoft' | 'google';

/** Slightly longer than a token exchange should ever take, and self-expiring. */
const LEASE_SECONDS = 20;
const WAIT_STEP_MS = 250;
const WAIT_ATTEMPTS = 40; // 10s, comfortably past a normal exchange.

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new GraphError(`${name} is not set on this deployment.`, false);
  }
  return value;
};

/**
 * The service role bypasses RLS, which is the point: it reads a row on behalf
 * of a user who is not the one holding a browser session. It must never reach
 * anything the browser can call.
 */
const admin = () =>
  createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The token a request may spend, refreshing it only if nobody else already is.
 *
 * Bound to one user, so the dispatcher built from it cannot reach another's
 * connection even by mistake — there is no argument that would express it.
 */
export const hostedTokens =
  (userId: string) =>
  async (provider: ProviderName): Promise<string> => {
    const db = admin();
    const config = PROVIDERS[provider];

    const cached = async (): Promise<string | null> => {
      const { data, error } = await db.rpc('connection_access_token', {
        p_user_id: userId,
        p_key: need('TOKEN_ENCRYPTION_KEY'),
        p_provider: provider,
      });
      if (error) throw new GraphError(`Could not read the stored token: ${error.message}`, false);
      return data as string | null;
    };

    const hit = await cached();
    if (hit !== null) return hit;

    // Whoever gets the lease does the exchange. Everyone else waits for the
    // token they are about to write, rather than spending the same refresh
    // token a second time and killing it for both.
    const { data: locked, error: lockError } = await db.rpc('try_lock_refresh', {
      p_user_id: userId,
      p_provider: provider,
      p_seconds: LEASE_SECONDS,
    });
    if (lockError) throw new GraphError(`Could not claim a refresh: ${lockError.message}`, false);

    if (locked !== true) {
      for (let i = 0; i < WAIT_ATTEMPTS; i += 1) {
        await sleep(WAIT_STEP_MS);
        const written = await cached();
        if (written !== null) return written;
      }
      // The holder crashed or is pathologically slow. Its lease expires on its
      // own, so the next request recovers; failing here is better than a second
      // refresh racing the first one home.
      throw new GraphError(
        `Timed out waiting for a ${config.label} token refresh already in progress. Try again.`,
        false,
      );
    }

    try {
      const { data: refreshToken, error: readError } = await db.rpc('connection_refresh_token', {
        p_user_id: userId,
        p_key: need('TOKEN_ENCRYPTION_KEY'),
        p_provider: provider,
      });
      if (readError) {
        throw new GraphError(`Could not read the stored token: ${readError.message}`, false);
      }
      if (refreshToken === null) {
        throw new GraphError(`No ${config.label} connection for this account.`, true);
      }

      // Google demands its secret on every refresh; Microsoft has none. This is
      // a deployment secret here rather than a value cached beside the token,
      // because unlike an install this server can simply be given it.
      const clientSecret = config.needsClientSecret
        ? need('GOOGLE_DESKTOP_CLIENT_SECRET')
        : undefined;

      const tokens = await postToken(
        config,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken as string,
          scope: config.scope,
        },
        clientSecret,
      );

      if (tokens.access_token === undefined) {
        throw new GraphError(`${config.label} returned no access token.`, false);
      }

      // A shorter life is assumed when the provider does not say, so a missing
      // expires_in cannot produce a token cached as valid long after it is not.
      const lifetime = typeof tokens.expires_in === 'number' ? tokens.expires_in : 300;

      // Written only when one came back and it actually changed. Google does
      // not always return one, and treating that as a revocation would delete a
      // connection that still works.
      const rotated =
        tokens.refresh_token !== undefined && tokens.refresh_token !== refreshToken
          ? tokens.refresh_token
          : null;

      const { error: writeError } = await db.rpc('store_refreshed_tokens', {
        p_user_id: userId,
        p_key: need('TOKEN_ENCRYPTION_KEY'),
        p_access_token: tokens.access_token,
        p_expires_at: new Date(Date.now() + lifetime * 1000).toISOString(),
        p_refresh_token: rotated,
        p_provider: provider,
      });

      // The exchange already happened, so the old refresh token is dead
      // whatever this says. Reporting the write failure is the honest outcome:
      // the connection may genuinely need reconnecting, and a silent success
      // here would surface as an unexplained failure on some later call.
      if (writeError) {
        throw new GraphError(
          `Refreshed the ${config.label} connection but could not store it: ${writeError.message}`,
          true,
        );
      }

      return tokens.access_token;
    } catch (err) {
      // Without this a failed exchange blocks every later attempt until the
      // lease runs out, turning one provider hiccup into twenty seconds of
      // outage for that user.
      await db.rpc('release_refresh_lock', { p_user_id: userId, p_provider: provider });
      throw err;
    }
  };
