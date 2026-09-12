/**
 * Copy the custom playbook pack into `vendor/artist-pack`.
 *
 * The pack's home is ManudotaORG/artist-mcp-custom-pack, which is private. A
 * git submodule would make the deploy depend on Vercel holding credentials for
 * a second private repository, and a submodule it cannot clone fails the build
 * outright rather than degrading — so the files are committed here instead, at
 * a recorded commit, and this script is how they get refreshed.
 *
 * Usage: node scripts/sync-artist-pack.mjs [path-to-clone]
 * Defaults to $ARTIST_PACK_CLONE.
 */

import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(repoRoot, 'vendor', 'artist-pack');

const clone = process.argv[2] ?? process.env.ARTIST_PACK_CLONE;
if (!clone) {
  console.error(
    'Say where the pack clone is: node scripts/sync-artist-pack.mjs <path>, or set ARTIST_PACK_CLONE.',
  );
  process.exit(1);
}
const source = resolve(clone);

const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();

const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain');
if (dirty) {
  console.error(`${source} has uncommitted changes. Commit them first, so the stamp means something.`);
  process.exit(1);
}

/**
 * Only `.md`, which is also the only thing the registry derivation reads. The
 * pack directory accumulates editor leavings — `.bak-*` copies, `.DS_Store` —
 * and vendoring those would put files in the deploy that nothing ever loads.
 */
const copyMarkdown = async (from, to) => {
  await mkdir(to, { recursive: true });
  for (const item of await readdir(from, { withFileTypes: true })) {
    if (item.isDirectory()) await copyMarkdown(join(from, item.name), join(to, item.name));
    else if (item.name.endsWith('.md')) await cp(join(from, item.name), join(to, item.name));
  }
};

await rm(join(destination, 'artist'), { recursive: true, force: true });
await copyMarkdown(join(source, 'artist'), join(destination, 'artist'));

await writeFile(
  join(destination, 'SOURCE.json'),
  `${JSON.stringify(
    {
      repository: 'https://github.com/ManudotaORG/artist-mcp-custom-pack',
      commit,
      syncedAt: new Date().toISOString().slice(0, 10),
    },
    null,
    2,
  )}\n`,
);

console.log(`Synced vendor/artist-pack from ${source} at ${commit.slice(0, 7)}.`);
