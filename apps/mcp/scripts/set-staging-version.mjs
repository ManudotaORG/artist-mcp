/**
 * Give a staging build a unique version, in both places that carry one.
 *
 * `package.json` is what npm publishes. `src/server.ts` is what the MCP
 * handshake announces, and it is a Release Please `extra-file` updated on `main`
 * only — so setting the first alone meant a staging build reported whatever
 * `release` last committed. `1.0.2-staging.51` announced itself as `1.0.0`.
 *
 * Both are rewritten here rather than committed: this runs in CI before the
 * build, so the value reaches `dist/` and the tarball and nothing else.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** The same marker Release Please looks for, so there is one convention. */
const VERSION_MARKER = /(= ')([^']*)('; \/\/ x-release-please-version)/;

const buildId = process.argv[2];
const packagePath = resolve(process.argv[3] ?? 'package.json');

if (!buildId || !/^[0-9]+(?:\.[0-9]+)*$/.test(buildId)) {
  throw new Error('Usage: set-staging-version <numeric-build-id[.attempt]> [package.json]');
}

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(packageJson.version);
if (!match) {
  throw new Error(`Unsupported package version: ${packageJson.version}`);
}

const [, major, minor, patch] = match;
const version = `${major}.${minor}.${Number(patch) + 1}-staging.${buildId}`;

packageJson.version = version;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

// Loudly, not best-effort. A silent skip here is what produced a published
// staging build announcing the wrong version, which is worst precisely when the
// version is the thing being verified.
const sourcePath = resolve(dirname(packagePath), 'src/server.ts');
const source = await readFile(sourcePath, 'utf8');
if (!VERSION_MARKER.test(source)) {
  throw new Error(`No x-release-please-version marker in ${sourcePath}`);
}
await writeFile(sourcePath, source.replace(VERSION_MARKER, `$1${version}$3`));

console.log(version);
