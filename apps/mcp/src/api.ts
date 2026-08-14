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

export const getWithRetry = async (url: string, token: string, api: string): Promise<Response> => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) return res;

    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || attempt >= DELAYS.length) {
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

      throw new GraphError(`${api} returned ${res.status}.${detail ? ` ${detail}` : ''}`, false);
    }

    await new Promise((resolve) => setTimeout(resolve, DELAYS[attempt]));
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
