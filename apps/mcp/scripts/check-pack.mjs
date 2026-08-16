/**
 * Compare an editable playbook directory against the bundled pack.
 *
 * `init --editable` copies the pack somewhere the user owns, and from then on
 * the two drift on purpose — their edits are theirs. What is not on purpose is
 * a change made in their directory that was meant for the package, because
 * nothing carries it back. It runs correctly for them and ships to nobody:
 * `registry.json` and its checksums are generated from the bundle, while a
 * local pack is checksummed from the directory as it is read, so a file that
 * exists only there passes every check the server makes.
 *
 * Reports rather than fixes. Which side is right is not something a script can
 * know — a differing file may be the user's own rules or an edit that belongs
 * in the repository, and only the person who made it can say which.
 *
 *   node scripts/check-pack.mjs ~/artist-mcp
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, '../agent-pack/.artist');

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/check-pack.mjs <editable pack directory>');
  process.exit(2);
}

/** Either container name is valid, and a pack uses exactly one of them. */
const containerFor = async (dir) => {
  for (const name of ['.artist', 'artist']) {
    try {
      await readdir(join(dir, name));
      return join(dir, name);
    } catch {
      /* try the other */
    }
  }
  console.error(`No .artist/ or artist/ directory in ${dir}. Is that an editable pack?`);
  process.exit(2);
};

const markdownUnder = async (dir) => {
  const found = [];
  const walk = async (at) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.md')) found.push(relative(dir, path));
    }
  };
  await walk(dir);
  return found.sort();
};

const local = await containerFor(resolve(root));
const [bundled, theirs] = await Promise.all([markdownUnder(bundle), markdownUnder(local)]);

const read = (dir, file) => readFile(join(dir, file), 'utf8');
const differs = [];
const missing = [];
const localOnly = theirs.filter((f) => !bundled.includes(f));

for (const file of bundled) {
  if (!theirs.includes(file)) {
    missing.push(file);
    continue;
  }
  const [a, b] = await Promise.all([read(bundle, file), read(local, file)]);
  if (a !== b) differs.push(file);
}

const say = (label, files, note) => {
  if (files.length === 0) return;
  console.log(`\n${label}`);
  for (const file of files) console.log(`  ${file}`);
  console.log(`  ${note}`);
};

console.log(`bundle ${bundle}\nlocal  ${local}`);
say(
  `${differs.length} file(s) differ`,
  differs,
  'Their edits, or an edit that belongs in the repository. Only you can say which.',
);
say(
  `${localOnly.length} file(s) exist only in the local pack`,
  localOnly,
  'Playbooks of their own. These ship to nobody — copy any that should.',
);
say(
  `${missing.length} bundled file(s) are absent from the local pack`,
  missing,
  'Deleted deliberately, or never seeded. Re-run init --editable to restore.',
);

if (differs.length + localOnly.length + missing.length === 0) {
  console.log(`\n${bundled.length} files, all identical. Nothing is stranded.`);
}

// Reporting, not gatekeeping: divergence is the normal state of an editable
// pack, so a difference is news rather than a failure.
process.exit(0);
