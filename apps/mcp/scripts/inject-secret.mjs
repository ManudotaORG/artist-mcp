#!/usr/bin/env node
/**
 * Bake Google's client secret into the built output at publish time.
 *
 * Google refuses the token exchange for a Desktop client without a secret, and
 * the client types that need none are the ones where the loopback redirect is
 * deprecated — so the package has to carry one to connect Google at all. It is
 * readable by anyone who installs the package. That is inherent to the design
 * and is documented rather than disguised.
 *
 * It stays out of the repository for a practical reason rather than a security
 * one: a live credential in a public repo is found by secret scanners, and a
 * revocation would break Google for every install simultaneously. Injecting at
 * publish also makes rotation a workflow-variable change instead of a commit.
 *
 * Runs from prepublishOnly, after the build. Fails rather than publishing a
 * package whose Google connection cannot work, because that failure would
 * otherwise surface for the first time on a user's machine.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTINEL = '__GOOGLE_CLIENT_SECRET__';
const target = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'oauth.js');

const secret = process.env.ARTIST_MCP_GOOGLE_CLIENT_SECRET ?? '';

if (secret === '') {
  // Deliberately loud. A staging build may legitimately want to skip this, but
  // it has to say so, because the alternative is shipping a package that looks
  // fine and cannot connect Google.
  if (process.env.ARTIST_MCP_ALLOW_MISSING_SECRET === '1') {
    console.warn(
      'inject-secret: no ARTIST_MCP_GOOGLE_CLIENT_SECRET, and the override is set. ' +
        'Publishing a build that cannot connect Google.',
    );
    process.exit(0);
  }

  console.error(
    'inject-secret: ARTIST_MCP_GOOGLE_CLIENT_SECRET is not set.\n' +
      'The published package would be unable to connect Google. Set it from the\n' +
      'CI secret, or set ARTIST_MCP_ALLOW_MISSING_SECRET=1 to publish anyway.',
  );
  process.exit(1);
}

const source = await readFile(target, 'utf8');

// Exactly one, or the assumption behind this script has changed. Replacing zero
// occurrences would publish an un-injected build; replacing several would mean
// the sentinel is being used somewhere this script does not understand.
const occurrences = source.split(SENTINEL).length - 1;
if (occurrences !== 1) {
  console.error(
    `inject-secret: expected exactly one ${SENTINEL} in dist/oauth.js, found ${occurrences}.`,
  );
  process.exit(1);
}

await writeFile(target, source.replace(SENTINEL, secret), 'utf8');

// Never the value, only that it happened.
console.log('inject-secret: Google client secret baked into dist/oauth.js');
