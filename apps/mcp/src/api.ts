/**
 * Calling the provider APIs directly from this machine.
 *
 * Ported from the edge function, which held the credentials and made these
 * calls on the user's behalf. The logic is deliberately unchanged: the retry
 * shape, the error surfacing and the scope diagnosis below were each learned
 * from a specific failure, and a port is the wrong moment to second-guess them.
 */

import { GraphError } from './client.js';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const GMAIL = 'https://gmail.googleapis.com/gmail/v1';
export const CALENDAR = 'https://www.googleapis.com/calendar/v3';

/** Two retries, backing off. Beyond that the caller learns more than a longer wait would tell it. */
const DELAYS = [400, 1200];

/**
 * Throttling is not a server error and does not deserve the same patience.
 *
 * A 5xx either clears immediately or is not ours to wait out. A 429 is the
 * provider saying "later" about a request that is otherwise fine, and the old
 * ladder spent both its retries inside 1.6 seconds — comfortably inside a
 * OneNote throttling window, so every attempt was refused and the caller saw a
 * raw 429 for something that would have succeeded on its own shortly after.
 */
const THROTTLE_DELAYS = [1_000, 4_000, 10_000];

/** Past this, waiting is worse for the caller than saying so. */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Total time this may spend waiting out throttling before it gives up.
 *
 * Learned by getting it wrong: honouring Retry-After without a ceiling turned a
 * fast failure into fifty-odd seconds of waiting, against a hosted route with a
 * sixty-second limit. That is not patience, it is a function timeout, and the
 * caller gets nothing to act on instead of a sentence telling them to try
 * again shortly.
 *
 * Whoever is waiting is a person watching a chat client. Failing at eight
 * seconds with "busy, try again" respects that better than succeeding at
 * fifty, and a throttled account usually needs longer than either.
 */
const THROTTLE_BUDGET_MS = 8_000;

/**
 * Spread, so a fanout that was throttled together does not retry together.
 *
 * This is the part that made throttling self-sustaining: N parallel requests
 * are refused at the same moment, wait the same fixed interval, and arrive back
 * at the provider as the same burst. Full jitter turns one retrying herd into
 * arrivals scattered across the window.
 */
const jittered = (ms: number): number => Math.round(ms / 2 + Math.random() * (ms / 2));

/**
 * What the provider actually asked for, when it says.
 *
 * Both Microsoft and Google send Retry-After on a 429, in seconds or as an
 * HTTP date. Guessing when the answer is in the response is how the previous
 * ladder came to be too short: it was a reasonable guess, and the provider was
 * telling us the real number the whole time.
 */
const retryAfterMs = (res: Response): number | undefined => {
  const header = res.headers.get('retry-after');
  if (header === null) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const when = Date.parse(header);
  if (Number.isNaN(when)) return undefined;
  return Math.min(Math.max(when - Date.now(), 0), MAX_RETRY_AFTER_MS);
};

export const getWithRetry = async (url: string, token: string, api: string): Promise<Response> => {
  let spentWaiting = 0;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) return res;

    const throttled = res.status === 429;
    const limit = throttled ? THROTTLE_DELAYS.length : DELAYS.length;
    const retryable = res.status >= 500 || throttled;

    // Decided before the attempt count, because a provider asking for thirty
    // seconds exhausts the budget on its first answer and there is nothing to
    // be gained by asking again to be told the same thing.
    const wait = throttled
      ? Math.min(retryAfterMs(res) ?? jittered(THROTTLE_DELAYS[Math.min(attempt, THROTTLE_DELAYS.length - 1)]), MAX_RETRY_AFTER_MS)
      : DELAYS[Math.min(attempt, DELAYS.length - 1)];
    const affordable = !throttled || spentWaiting + wait <= THROTTLE_BUDGET_MS;

    if (!retryable || attempt >= limit || !affordable) {
      // Both APIs explain their 4xx in the body. Without it every failure looks
      // the same and the only debugging tool left is guesswork — the 20266
      // outage read as an auth problem until the body was surfaced.
      const detail = (await res.text().catch(() => '')).slice(0, 300);

      // A refresh token carries the scopes it was granted with, and adding a
      // scope later does not widen it. A connection made before Calendar
      // existed here therefore authenticates fine and is refused per call, so
      // this has to read as "reconnect", not as a broken integration.
      if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(detail)) {
        throw new GraphError(
          `This connection predates ${api} access. Run \`artist-mcp connect google\` to grant it.`,
          true,
        );
      }

      // Throttling is the one failure that resolves by doing nothing, so it
      // says so. Everything else here is a fault to report, not a wait to sit
      // through, and conflating them sends people looking for a bug that is a
      // busy provider.
      if (throttled) {
        throw new GraphError(
          `${api} is rate limiting this account. Wait a moment and try again.` +
            (detail ? ` ${detail}` : ''),
          false,
        );
      }

      throw new GraphError(`${api} returned ${res.status}.${detail ? ` ${detail}` : ''}`, false);
    }

    spentWaiting += wait;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
};

/**
 * Paths are built by the callers from fixed literals, and any value that came
 * from outside is shape-checked and encoded before it reaches one. Nothing from
 * a caller is concatenated into a URL raw.
 */
export const graphGet = (path: string, token: string): Promise<Response> =>
  getWithRetry(`${GRAPH}${path}`, token, 'Microsoft Graph');

export const gmailGet = (path: string, token: string): Promise<Response> =>
  getWithRetry(`${GMAIL}${path}`, token, 'Gmail');

export const calendarGet = (path: string, token: string): Promise<Response> =>
  getWithRetry(`${CALENDAR}${path}`, token, 'Google Calendar');
