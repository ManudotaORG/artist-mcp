/**
 * Calling the provider APIs directly from this machine.
 *
 * Ported from the edge function, which held the credentials and made these
 * calls on the user's behalf. The logic is deliberately unchanged: the retry
 * shape, the error surfacing and the scope diagnosis below were each learned
 * from a specific failure, and a port is the wrong moment to second-guess them.
 */

import { DuplicateEventError, GraphError, ScopeError } from './client.js';

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

/**
 * What a call needs from the grant, for the one failure that is not a fault.
 *
 * `capability` is phrased for the user, because it ends up in the message they
 * read. `optional` says whether the caller can still answer without it: reading
 * events is the product, so its absence is a reconnect prompt, while knowing
 * which calendars exist only makes an answer more honest about its own reach.
 */
export type ScopeNeed = { capability: string; optional: boolean };

export const getWithRetry = async (
  url: string,
  token: string,
  api: string,
  need?: ScopeNeed,
): Promise<Response> => {
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
      //
      // Which reconnect prompt, though, depends on what was missing. Telling
      // someone whose calendar reading works perfectly that their "connection
      // predates Google Calendar access" is false and alarming; what actually
      // failed was the newer, narrower thing the call happened to need.
      if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(detail)) {
        if (need) {
          throw new ScopeError(
            need.optional
              ? `This connection cannot ${need.capability}. Everything else still works; ` +
                'run `artist-mcp connect google` if you want it to.'
              : `This connection cannot ${need.capability}. ` +
                'Run `artist-mcp connect google` to grant it.',
            need.capability,
            need.optional,
          );
        }
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

export const calendarGet = (path: string, token: string, need?: ScopeNeed): Promise<Response> =>
  getWithRetry(`${CALENDAR}${path}`, token, 'Google Calendar', need);

/**
 * Knowing which calendars exist is the one Google read this product can do
 * without. A connection made before `calendar.calendarlist.readonly` was asked
 * for still reads events perfectly, so its absence degrades the answer — "only
 * `primary` was searched" — rather than failing it.
 */
/**
 * The one write this package can perform.
 *
 * Deliberately not a general `post`. Every read helper above is a thin wrapper
 * because reads are interchangeable; this is not, and a `calendarPost(path)`
 * that any caller could aim anywhere would put the boundary back in the callers
 * where nothing checks it. The path is a literal built here, the method is
 * fixed, and creating an event is the only thing it can express.
 *
 * `test/operation-boundary` asserts that no other write-shaped helper exists.
 * Adding one is a boundary change, not a feature — see
 * docs/decisions/0001-opt-in-calendar-writes.md.
 */
export const calendarInsertEvent = async (
  calendarId: string,
  body: unknown,
  token: string,
): Promise<Response> => {
  const url = `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // Not retried, at all. Every read helper retries a 5xx because a repeated
  // read is free; a repeated create can double-book, and a 5xx does not say
  // whether the event was made. The client-set id makes a retry safe in
  // principle — Google answers the second attempt with 409 — but deciding to
  // retry belongs to the caller that knows the id was set, not to a helper.
  if (res.ok) return res;

  const detail = (await res.text().catch(() => '')).slice(0, 300);

  if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(detail)) {
    throw new ScopeError(
      'This Google connection cannot create calendar events. Reconnect with ' +
        '`artist-mcp connect google` — a refresh token carries the scopes it ' +
        'was granted with, so an existing connection cannot write until renewed.',
      'create calendar events',
      false,
    );
  }

  // Google answers a duplicate client-set id with 409. That is the retry guard
  // working — but what it means depends on whether the event is on the calendar
  // or in its bin, and only the caller can find that out. Raised as its own
  // type so the caller can say which.
  if (res.status === 409) {
    throw new DuplicateEventError(
      typeof body === 'object' && body !== null && 'id' in body
        ? String((body as { id: unknown }).id)
        : '',
    );
  }

  throw new GraphError(`Google Calendar refused to create the event (${res.status}). ${detail}`, false);
};

/**
 * Remove one event, by id, from one calendar.
 *
 * As narrow as the insert helper and for the same reason: not a general
 * `calendarDelete(path)` that any caller could aim at anything. Whether this id
 * may be deleted at all is decided in `calendar.ts`, where the rule lives that
 * only an event this tool created can be removed.
 */
export const calendarDeleteEvent = async (
  calendarId: string,
  eventId: string,
  token: string,
): Promise<void> => {
  const url =
    `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}` +
    `/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });

  // 204 is success and 410 means it was already gone, which is the same outcome
  // from the musician's side: the event is not in the calendar. Reporting the
  // second as a failure invites a second attempt at something already done.
  if (res.ok || res.status === 410) return;

  const detail = (await res.text().catch(() => '')).slice(0, 300);

  if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(detail)) {
    throw new ScopeError(
      'This Google connection cannot delete calendar events. Reconnect with ' +
        '`artist-mcp connect google` to grant it.',
      'delete calendar events',
      false,
    );
  }

  if (res.status === 404) {
    throw new GraphError(
      'That event is not on that calendar. Nothing was deleted.',
      false,
    );
  }

  throw new GraphError(`Google Calendar refused to delete the event (${res.status}). ${detail}`, false);
};

export const CALENDAR_LIST_NEED: ScopeNeed = {
  capability: 'see which calendars you have',
  optional: true,
};

/**
 * Create one page in one OneNote section.
 *
 * As narrow as the calendar insert and for the same reason, though the reason
 * carries less weight here: `Notes.Create` cannot express an edit or a delete,
 * so unlike Google, Microsoft would refuse a misaimed write even if this helper
 * let one through. Kept narrow anyway, because a `graphPost(path)` reachable
 * from anywhere in the package would be a general write path the moment someone
 * widens the scope for an unrelated reason.
 *
 * See docs/decisions/0003-onenote-writes.md.
 */
export const onenoteCreatePage = async (
  sectionId: string,
  xhtml: string,
  token: string,
): Promise<Response> => {
  const url = `${GRAPH}/me/onenote/sections/${encodeURIComponent(sectionId)}/pages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      // Not application/json. OneNote takes the page as an XHTML document, and
      // sending JSON is answered with a 400 that names neither problem.
      'content-type': 'application/xhtml+xml',
    },
    body: xhtml,
  });

  // Not retried, exactly as the calendar insert is not: a repeated create makes
  // a second page, and a 5xx does not say whether the first one landed. OneNote
  // accepts no client-set id, so there is no collision to rely on either — which
  // makes retrying strictly worse here than it is for an event.
  if (res.ok) return res;

  const detail = (await res.text().catch(() => '')).slice(0, 300);

  // 40004 is the code the probe saw for a scope the token does not hold. An
  // install granted onenote-create before connecting has a refresh token from
  // the narrower consent screen, and every create would fail this way until it
  // is renewed.
  if ((res.status === 401 || res.status === 403) && /40004|scope/i.test(detail)) {
    throw new ScopeError(
      'This Microsoft connection cannot create OneNote pages. Reconnect with ' +
        '`artist-mcp connect microsoft` — a refresh token carries the scopes it ' +
        'was granted with, so an existing connection cannot write until renewed.',
      'create OneNote pages',
      false,
    );
  }

  throw new GraphError(`OneNote refused to create the page (${res.status}). ${detail}`, false);
};

/**
 * Read a page back with the ids a patch can aim at.
 *
 * `includeIDs=true` is not optional and not a nicety: without it Graph returns
 * only the `data-id` values the page was created with, and a replace requires
 * the generated `id`. Microsoft warns those "might change after a page update",
 * so this is called immediately before the command that uses what it returns —
 * never once per session, and never carried across a write.
 *
 * The ETag comes back too, because it is the only thing that can tell us the
 * page moved between the read and the write. Verified honoured: a stale
 * `If-Match` is answered 412 rather than ignored.
 */
export const onenotePageContent = async (
  pageId: string,
  token: string,
): Promise<{ html: string; etag: string | null }> => {
  // graphGet rather than a bare path: getWithRetry takes a whole URL, and the
  // throttling and scope handling live in that wrapper.
  const res = await graphGet(
    `/me/onenote/pages/${encodeURIComponent(pageId)}/content?includeIDs=true`,
    token,
  );

  return { html: await res.text(), etag: res.headers.get('etag') };
};

/**
 * Apply patch commands to one page.
 *
 * Narrow in the same way `onenoteCreatePage` is, and here the narrowness is
 * load-bearing rather than defensive: this is the only function in the package
 * that can destroy something a musician might want back. A general
 * `graphPatch(path)` would make that reachable from anywhere.
 *
 * Not retried. A 5xx does not say whether the patch landed, and a repeated
 * replace against an id read before the first attempt would aim at whatever
 * that id points at now. Where a caller wants to try again it must read the
 * page again first, which is the same rule the ids themselves impose.
 *
 * See docs/decisions/0004-onenote-page-maintenance.md.
 */
export const onenotePatchPage = async (
  pageId: string,
  commands: readonly {
    target: string;
    action: string;
    content: string;
    // Only an `insert` carries one, and only Graph's own vocabulary is
    // accepted: a misspelled position is not rejected by the API, it is
    // ignored, and the content lands somewhere nobody previewed.
    position?: 'before' | 'after';
  }[],
  token: string,
  etag: string | null,
): Promise<void> => {
  const res = await fetch(`${GRAPH}/me/onenote/pages/${encodeURIComponent(pageId)}/content`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(etag === null ? {} : { 'if-match': etag }),
    },
    body: JSON.stringify(commands),
  });

  if (res.status === 204) return;

  const detail = (await res.text().catch(() => '')).slice(0, 300);

  // The page changed under us. Reported as what it is rather than retried: the
  // musician typing in OneNote while this ran is the likeliest cause, and
  // writing over that is the exact harm the header exists to prevent.
  if (res.status === 412) {
    throw new GraphError(
      'That page changed while this change was being prepared, so nothing was ' +
        'written — the edit would have overwritten whatever was just done to it. ' +
        'Ask again to work from the current version of the page.',
      false,
    );
  }

  // 40003 is a page the musician wrote; 40006 is a page another application
  // created. Both are Microsoft refusing on ownership, which is the boundary
  // this capability rests on, so neither is reported as a fault.
  if ((res.status === 401 || res.status === 403) && /40003|40006/.test(detail)) {
    throw new GraphError(
      'That page was not created by artist-mcp, so it cannot be changed. This ' +
        'tool can only edit its own pages — a page you wrote is refused by ' +
        'Microsoft, not by this tool, and that is deliberate.',
      false,
    );
  }

  if ((res.status === 401 || res.status === 403) && /40004|scope/i.test(detail)) {
    throw new ScopeError(
      'This Microsoft connection cannot edit OneNote pages. Reconnect with ' +
        '`artist-mcp connect microsoft` — a refresh token carries the scopes it ' +
        'was granted with, so an existing connection cannot edit until renewed.',
      'edit OneNote pages',
      false,
    );
  }

  // 20134 means the target did not resolve, which for a data-id is the missing
  // '#' and for a generated id means it moved since the read. 20138 means the
  // element resolved and does not support that action. They read alike and are
  // not alike, so they are told apart here rather than in a log nobody reads.
  if (/20134/.test(detail)) {
    throw new GraphError(
      'That part of the page could not be found, which usually means the page ' +
        'changed since it was read. Nothing was written. Ask again to work from ' +
        'the current version.',
      false,
    );
  }

  if (/20138/.test(detail)) {
    throw new GraphError(
      'That part of the page cannot be changed in that way — OneNote does not ' +
        'allow it for that kind of element. Nothing was written.',
      false,
    );
  }

  throw new GraphError(`OneNote refused to change the page (${res.status}). ${detail}`, false);
};
