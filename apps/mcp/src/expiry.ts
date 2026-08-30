/**
 * What a connection's age means, and what to say about it.
 *
 * Split out and pure because it is a decision rather than an integration: the
 * refresh failure in oauth.ts and the report in connect.ts must not describe
 * the same connection differently, and the only way to be sure of that is for
 * both to call this. It also makes the arithmetic testable against a fixed
 * clock, which is the half that is easy to get wrong and hard to notice.
 *
 * The fact being reasoned about is #94: Google expires refresh tokens issued
 * by an app in Testing publishing status after seven days. Nothing here knows
 * that number — it arrives with the connection, from the deployment (see
 * `statedExpiry`), so this file stays true when the app is verified.
 */

import type { ProviderName, StoredTokens } from './tokens.js';

/** Where a provider's own page for withdrawing an app's access lives. */
const CONNECTED_APPS: Record<ProviderName, string> = {
  google: 'https://myaccount.google.com/connections',
  microsoft: 'https://account.live.com/consent/Manage',
};

/** The one command that fixes any of this, per provider. */
export const reconnectCommand = (provider: ProviderName): string =>
  `artist-mcp connect ${provider}`;

export type ExpiryState =
  /** The provider stated no limit, so there is nothing to say. */
  | { kind: 'unlimited' }
  /** Stated a limit, still inside it. */
  | { kind: 'valid'; daysLeft: number; expiresAt: string }
  /** Stated a limit, and it has passed. */
  | { kind: 'lapsed'; daysAgo: number; expiresAt: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The two directions round opposite ways, because the honest answer differs.
 *
 * Time remaining rounds **up**: a connection with eleven hours left reads as
 * "1 day", never "0 days", since reporting zero days left on something that
 * still works teaches someone to ignore the line.
 *
 * Time elapsed rounds **down**: something that lapsed two days and three hours
 * ago is "2 days ago", not "3". Overstating how long a connection has been
 * dead is a small lie in the one place the user is checking the facts.
 */
const daysLeftFrom = (from: number, to: number): number => Math.max(1, Math.ceil((to - from) / DAY_MS));
const daysSince = (from: number, to: number): number => Math.floor((to - from) / DAY_MS);

export const expiryState = (tokens: StoredTokens, now: Date = new Date()): ExpiryState => {
  const { expiresAt } = tokens;
  if (expiresAt === undefined) return { kind: 'unlimited' };

  const at = Date.parse(expiresAt);
  // A stored date that will not parse is treated as no limit rather than as
  // an expiry. A connection wrongly declared dead is worse than one whose
  // warning is missing: the second still works.
  if (Number.isNaN(at)) return { kind: 'unlimited' };

  const ms = now.getTime();
  return ms >= at
    ? { kind: 'lapsed', daysAgo: daysSince(at, ms), expiresAt }
    : { kind: 'valid', daysLeft: daysLeftFrom(ms, at), expiresAt };
};

/**
 * The line `status` prints, or nothing when there is nothing to say.
 *
 * Silent while the limit is comfortably far off. A warning shown every single
 * day is read as decoration by the third day, and the whole point of this is to
 * be believed on the day it matters.
 */
export const expiryNotice = (
  provider: ProviderName,
  tokens: StoredTokens,
  now: Date = new Date(),
): string | undefined => {
  const state = expiryState(tokens, now);

  if (state.kind === 'lapsed') {
    // Under a day is "today" rather than "0 days ago", which reads as a bug.
    const when = state.daysAgo === 0 ? 'today' : `${state.daysAgo} day${state.daysAgo === 1 ? '' : 's'} ago`;
    return `LAPSED ${when}. Reconnect: ${reconnectCommand(provider)}`;
  }

  if (state.kind === 'valid' && state.daysLeft <= 2) {
    return (
      `expires in ${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'}. ` +
      `Reconnect any time: ${reconnectCommand(provider)}`
    );
  }

  return undefined;
};

/**
 * What to say at the end of a successful connect.
 *
 * Said here rather than discovered later, which is the entire complaint in #94:
 * the connection simply stopped, the error advised a reconnect, the advice was
 * right, and the cause stayed invisible for as long as anyone cared to look.
 */
export const expiryAtConnect = (
  provider: ProviderName,
  expiresAt: string | undefined,
  now: Date = new Date(),
): string | undefined => {
  if (expiresAt === undefined) return undefined;

  const state = expiryState({ refreshToken: '', scope: '', connectedAt: '', expiresAt }, now);
  if (state.kind !== 'valid') return undefined;

  return (
    `This connection lapses in ${state.daysLeft} days, on ${state.expiresAt.slice(0, 10)}. ` +
    `That is a limit ${provider === 'google' ? 'Google' : 'the provider'} applies to this ` +
    `app, not a fault, and reconnecting takes one command: ${reconnectCommand(provider)}`
  );
};

/**
 * Why a refresh was rejected, inferred from the connection's own age.
 *
 * The provider cannot tell us: Google answers `invalid_grant` with "Token has
 * been expired or revoked" whether it lapsed on schedule or someone withdrew
 * the app in their account settings. Those are opposite situations — one is
 * expected and one is worth investigating — so the distinction is drawn here,
 * from the expiry the connection recorded, and worded as the inference it is.
 * Nothing below claims the provider said any of it.
 */
export const explainRefreshFailure = (
  provider: ProviderName,
  tokens: StoredTokens,
  now: Date = new Date(),
): string => {
  const state = expiryState(tokens, now);
  const fix = `Reconnect with: ${reconnectCommand(provider)}`;

  if (state.kind === 'lapsed') {
    return (
      `This connection reached the ${state.expiresAt.slice(0, 10)} limit this app is ` +
      `subject to, so it most likely expired on schedule rather than anything ` +
      `going wrong. ${fix}`
    );
  }

  if (state.kind === 'valid') {
    return (
      `This is earlier than the ${state.expiresAt.slice(0, 10)} limit this connection ` +
      `was given, so something withdrew it rather than it lapsing — check whether ` +
      `the app was removed at ${CONNECTED_APPS[provider]}. ${fix}`
    );
  }

  return fix;
};
