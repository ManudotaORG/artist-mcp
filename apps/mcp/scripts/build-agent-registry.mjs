/**
 * Write the bundled `agent-pack/registry.json`.
 *
 * The derivation lives in `src/agent-registry.ts` because the runtime needs the
 * identical rule, so this runs *after* `tsc` and imports the compiled module.
 * `tsc` does not depend on registry.json — it is read with `readFile` at
 * runtime, never imported — so the ordering is safe.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveRegistry } from '../dist/agent-registry.js';

const packRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../agent-pack');

await writeFile(
  resolve(packRoot, 'registry.json'),
  `${JSON.stringify(await deriveRegistry(packRoot), null, 2)}\n`,
);
