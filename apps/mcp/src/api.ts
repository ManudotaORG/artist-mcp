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
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const when = Date.parse(header);
  if (Number.isNaN(when)) return undefined;
  return Math.max(when - Date.now(), 0);
};

/**
 * Which throttle this is, because they are not the same thing and the
 * difference is not ours to smooth over.
 *
 * Graph 20166 is per-user: this account has been read too quickly, which is
 * something the caller caused and can ease off on. 10007 is the service saying
 * it is busy, which has nothing to do with this account at all. Telling someone
 * their account is being rate limited when OneNote is simply busy sends them
 * looking for their own fault, and there is not one.
 */
const throttleKind = (detail: string): 'service' | 'account' =>
  /"code"\s*:\s*"?10007/.test(detail) || /server is too busy/i.test(detail)
    ? 'service'
    : 'account';

/** Rounded to something a person would say out loud. */
const humanWait = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `about ${seconds} seconds`;
  return `about ${Math.ceil(seconds / 60)} minutes`;
};

export const getWithRetry = async (url: string, token: string, api: string): Promise<Response> => {
  let spentWaiting = 0;
  let requestedWait: number | undefined;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) return res;

    const throttled = res.status === 429;
    const limit = throttled ? THROTTLE_DELAYS.length : DELAYS.length;
    const retryable = res.status >= 500 || throttled;

    // What the provider asked for, uncapped. The cap belongs to how long we are
    // willing to sleep, not to what we are willing to repeat back — a provider
    // asking for five minutes should be quoted as five minutes, not as thirty
    // seconds because that is all we would have waited.
    const requested = throttled ? retryAfterMs(res) : undefined;
    if (requested !== undefined) requestedWait = requested;

    // Decided before the attempt count, because a provider asking for thirty
    // seconds exhausts the budget on its first answer and there is nothing to
    // be gained by asking again to be told the same thing.
    const wait = throttled
      ? Math.min(
          requested ?? jittered(THROTTLE_DELAYS[Math.min(attempt, THROTTLE_DELAYS.length - 1)]),
          MAX_RETRY_AFTER_MS,
        )
      : DELAYS[Math.min(attempt, DELAYS.length - 1)];
    const affordable = !throttled || spentWaiting + wait <= THROTTLE_BUDGET_MS;

    // Throttling is otherwise invisible: it is absorbed by the retry, or
    // surfaced once as a failure with no record of how often it nearly
    // happened. One line per event, on stderr — stdout is the protocol channel
    // for a stdio server, and this is a diagnostic, not a result.
    if (throttled) {
      console.warn(
        `[artist-mcp] ${api} 429 attempt=${attempt + 1} ` +
          `retry_after=${requested === undefined ? 'unset' : `${Math.round(requested / 1000)}s`} ` +
          `waited=${Math.round(spentWaiting / 1000)}s`,
      );
    }

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
        const kind = throttleKind(detail);
        const subject =
          kind === 'service'
            ? `${api} is busy and is refusing requests`
            : `${api} is rate limiting this account`;
        // The provider's own number when it gave one. "Wait a moment" is fine
        // for a few seconds and misleading for five minutes, and only the
        // provider knows which this is.
        const advice =
          requestedWait === undefined
            ? 'Wait a moment and try again.'
            : `Try again in ${humanWait(requestedWait)}.`;

        throw new GraphError(`${subject}. ${advice}${detail ? ` ${detail}` : ''}`, false);
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
