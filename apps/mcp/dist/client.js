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
const { version: packageVersion } = require('../package.json');
/**
 * A staging build is identified by its npm version alone, so an install cannot
 * end up verifying against one environment and talking to the other. It now
 * selects the site that serves client configuration rather than an API
 * endpoint, since there is no longer an API of ours to call.
 */
const isStagingVersion = (version) => version.includes('-staging.');
export { isStagingVersion, packageVersion };
/**
 * `reconnectNeeded` is the distinction worth keeping: a token that expired or
 * was revoked is the user's to fix, and everything else is not. Telling someone
 * to reconnect when reconnecting cannot help sends them round a loop that never
 * closes, which the hosted design learned the hard way.
 */
export class GraphError extends Error {
    reconnectNeeded;
    constructor(message, reconnectNeeded) {
        super(message);
        this.reconnectNeeded = reconnectNeeded;
        this.name = 'GraphError';
    }
}
