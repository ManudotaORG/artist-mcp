/**
 * What is left of the hosted client.
 *
 * This file used to be the only network surface in the package: every operation
 * went through one POST to an edge function that held the Microsoft and Google
 * credentials, and a connection key was the single secret on this machine.
 * Operations now run here, against tokens this machine owns, so the POST and
 * the key are both gone — see dispatch.ts and oauth.ts.
 *
 * What remains is the error type every layer reports through, and the version
 * helpers that decide which environment an install belongs to.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../package.json') as { version: string };

/**
 * A staging build is identified by its npm version alone, so an install cannot
 * end up verifying against one environment and talking to the other. It now
 * selects the site that serves client configuration rather than an API
 * endpoint, since there is no longer an API of ours to call.
 */
const isStagingVersion = (version: string): boolean => version.includes('-staging.');

export { isStagingVersion, packageVersion };

/**
 * `reconnectNeeded` is the distinction worth keeping: a token that expired or
 * was revoked is the user's to fix, and everything else is not. Telling someone
 * to reconnect when reconnecting cannot help sends them round a loop that never
 * closes, which the hosted design learned the hard way.
 */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly reconnectNeeded: boolean,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

/**
 * A 403 that means "this token was never granted that", as opposed to a fault.
 *
 * Its own type because the two answers are different: a scope the product
 * cannot work without is a reconnect prompt, and a scope that only makes an
 * answer better is a sentence in the answer. A refresh token carries the scopes
 * it was granted with and adding one later does not widen it, so both are
 * permanent until the user reconnects — they are not transient failures to
 * retry, and they are not integration bugs.
 *
 * `optional` is the caller's claim, not the provider's: only the caller knows
 * whether it can produce a weaker but honest result without this.
 */
export class ScopeError extends GraphError {
  constructor(
    message: string,
    readonly capability: string,
    readonly optional: boolean,
  ) {
    super(message, !optional);
    this.name = 'ScopeError';
  }
}

/**
 * Google refusing a client-set event id that is already taken.
 *
 * Its own type because "taken" has two very different causes: the event is on
 * the calendar, or it was deleted and is sitting in that calendar's bin holding
 * its id. Only the caller can tell those apart, and telling someone an event is
 * "already in the calendar" when it is in the bin sends them looking for
 * something they cannot see.
 */
export class DuplicateEventError extends GraphError {
  constructor(readonly eventId: string) {
    super('That event id is already taken.', false);
    this.name = 'DuplicateEventError';
  }
}
