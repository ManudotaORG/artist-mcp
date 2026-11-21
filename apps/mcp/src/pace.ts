/**
 * Keeping OneNote requests under Microsoft's per-minute limit, per user.
 *
 * OneNote allows 120 requests a minute and 400 an hour per app per user, and
 * counts every request inside a `$batch` on its own. The September fix capped
 * how many requests one tool call has in flight (`FANOUT_LIMIT`), which bounds
 * concurrency and not rate: four at a time against pages answering in about
 * 1.7 s is roughly 140 a minute. Measured on 2026-11-21, a sweep of 221 pages ran
 * at about 127 a minute and drew 429s — and every refused request counts against
 * the same limit, so a refusal is paid for twice.
 *
 * So requests are counted as they are sent, over a sliding minute, and a request
 * that would exceed the budget waits for a slot instead of being refused by
 * Microsoft.
 *
 * Per user, never per process. One stdio process serves one user, but the hosted
 * route serves many from one process, and a shared counter would let one user's
 * survey slow another's read — the same trap `CLAUDE.md` describes for write
 * grants, which is why those are a parameter rather than state.
 *
 * So the key is the user, passed in by whoever knows it: the dispatcher binds
 * each access token it resolves to a pacing key (`bindPaceKey`), and the pacer
 * looks the key up by token. Hosted passes the user's id; a local install,
 * one user per process, gets one key per dispatcher.
 *
 * Keying on the token alone was the first version, and the live check is what
 * found it wrong: `accessTokenFor` fetches a fresh access token for every
 * operation, so each operation looked like a new user and a 60-second window
 * reached 133 requests with the pacer in place. The unit tests had passed
 * because they reused one token string. A token with no bound key still falls
 * back to its own hash, which can only ever under-count, never mix two users.
 *
 * Approximate on hosted, exact locally. Serverless instances do not share
 * memory, so two instances serving one user each count only their own requests.
 * Local is one process and counts everything. The hourly 400 is not paced here
 * at all: waiting out an hour is not something a tool call can do, and the
 * existing 429 message already names both limits.
 */

import { createHash } from 'node:crypto';
import { GraphError } from './client.js';

/** Headroom under Microsoft's 120: other callers on the same app count too. */
export const ONENOTE_PER_MINUTE = 100;
const WINDOW_MS = 60_000;

/**
 * Past this, saying so beats waiting.
 *
 * The same ceiling as the throttle budget in `api.ts`, for the same reason: the
 * hosted route dies at sixty seconds, and `map_notes` starts a page as late as
 * its forty-five second deadline, so a wait longer than this can turn a partial
 * answer into no answer at all.
 */
export const MAX_PACE_WAIT_MS = 8_000;

export type Pacer = (token: string, count?: number) => Promise<void>;
export type BindPaceKey = (token: string, key: string) => void;

type PacerOptions = {
  limit?: number;
  windowMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** What a caller hears when the minute is spent and waiting would take too long. */
export const pacedMessage = (waitMs: number): string =>
  'artist-mcp is pacing OneNote requests for this account: the last minute has ' +
  `already used what OneNote allows, and the next request would have to wait about ` +
  `${Math.ceil(waitMs / 1000)} seconds. Nothing was refused by Microsoft. Try again in ` +
  'about a minute.';

/** Separate instances for tests; the default one below is what the API layer uses. */
export const createPacer = ({
  limit = ONENOTE_PER_MINUTE,
  windowMs = WINDOW_MS,
  maxWaitMs = MAX_PACE_WAIT_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: PacerOptions = {}): Pacer & { size: () => number; bind: BindPaceKey } => {
  const windows = new Map<string, number[]>();
  /** Token hash to pacing key, with when it was bound, so old ones can go. */
  const aliases = new Map<string, { key: string; at: number }>();

  const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');
  const keyFor = (token: string): string => {
    const hash = hashOf(token);
    return aliases.get(hash)?.key ?? `token:${hash}`;
  };
  const bind: BindPaceKey = (token, key) => {
    aliases.set(hashOf(token), { key: `user:${key}`, at: now() });
  };

  const pace = async (token: string, count = 1): Promise<void> => {
    // A batch larger than the whole budget could never be admitted; it is
    // admitted alone rather than waited on forever. Batches are 20 at most.
    const wanted = Math.min(Math.max(1, count), limit);
    const key = keyFor(token);

    for (;;) {
      const at = now();
      const stamps = (windows.get(key) ?? []).filter((t) => t > at - windowMs);

      if (stamps.length + wanted <= limit) {
        for (let i = 0; i < wanted; i++) stamps.push(at);
        windows.set(key, stamps);
        return;
      }

      // The oldest stamps leave the window first; wait until enough have.
      const freeAt = stamps[stamps.length + wanted - limit - 1] + windowMs;
      const wait = Math.max(1, freeAt - at);
      windows.set(key, stamps);
      if (wait > maxWaitMs) throw new GraphError(pacedMessage(wait), false);
      await sleep(wait);
    }
  };

  // Bounded memory on a long-lived hosted process: a token that has gone quiet
  // for a whole window holds nothing worth keeping.
  const prune = () => {
    const at = now();
    for (const [key, stamps] of windows) {
      if (!stamps.some((t) => t > at - windowMs)) windows.delete(key);
    }
    // An access token lives about an hour; a binding older than two is dead.
    for (const [hash, { at: boundAt }] of aliases) {
      if (boundAt < at - 2 * 60 * 60_000) aliases.delete(hash);
    }
  };

  return Object.assign(
    async (token: string, count?: number) => {
      if (windows.size > 1000 || aliases.size > 1000) prune();
      return pace(token, count);
    },
    { size: () => windows.size, bind },
  );
};

/**
 * The pacer every OneNote request goes through.
 *
 * `ARTIST_MCP_ONENOTE_PER_MINUTE` overrides the budget, for an account that
 * shares the app with something else or for a test that needs a small number.
 */
const defaultPacer = createPacer({
  limit: Number(process.env.ARTIST_MCP_ONENOTE_PER_MINUTE) || ONENOTE_PER_MINUTE,
});
export const paceOneNote: Pacer = defaultPacer;

/** Tie an access token to the user it belongs to, for the default pacer. */
export const bindPaceKey: BindPaceKey = defaultPacer.bind;
