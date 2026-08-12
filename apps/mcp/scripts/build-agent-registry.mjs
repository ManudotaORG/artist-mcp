import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../agent-pack');
const artistRoot = resolve(root, '.artist');

const collect = async (directory) => {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) entries.push(...(await collect(path)));
    else if (item.name.endsWith('.md')) entries.push(path);
  }
  return entries;
};

const files = (await collect(artistRoot)).sort();
const entries = [];
for (const path of files) {
  const file = relative(root, path).replaceAll('\\', '/');
  const content = await readFile(path, 'utf8');
  const kind = file.includes('/roles/')
    ? 'role'
    : file.includes('/project-types/')
      ? 'project-type'
      : 'policy';
  const slug = path.split('/').at(-1).replace(/\.md$/, '').toLowerCase().replaceAll('_', '-');
  const heading = content.match(/^#\s+(.+)$/m)?.[1] ?? slug;
  // These files are hard-wrapped, so taking the first line yielded half a
  // sentence — and that fragment is what a model sees when it browses the
  // registry without loading anything. Take the whole first paragraph and
  // unwrap it.
  const paragraph = content
    .split('\n\n')
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('#'));
  const description = paragraph ? paragraph.replace(/\s*\n\s*/g, ' ') : heading;
  entries.push({
    id: `${kind}:${slug}`,
    kind,
    name: heading,
    description,
    file,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
}

await writeFile(
  resolve(root, 'registry.json'),
  `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
);
