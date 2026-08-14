/**
 * Deriving a workflow registry from a directory of Markdown.
 *
 * This is shared on purpose. The ids and kinds are inferred from where a file
 * sits (`roles/` → role, filename → slug), and that inference runs in two
 * places: the build script that writes the bundled `registry.json`, and the
 * runtime that reads a user's own directory. Two copies of the rule would drift,
 * and the drift would be silent — the same file would get one id when bundled
 * and a different one when read locally, so a user's edit would shadow nothing.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

type AgentKind = 'role' | 'project-type' | 'policy';

type AgentRegistryEntry = {
  id: string;
  kind: AgentKind;
  name: string;
  description: string;
  file: string;
  sha256: string;
};

type AgentRegistry = {
  schemaVersion: 1;
  entries: AgentRegistryEntry[];
};

/** The pack layout: Markdown lives under `.artist/` and nowhere else. */
const PACK_SUBDIRECTORY = '.artist';

/**
 * Resolve `file` against `root` and refuse anything that escapes it.
 *
 * Registry paths are data — bundled they come from a file in the package,
 * locally they come from a directory the user controls — so a `../` in one must
 * not be able to read arbitrary paths off the disk.
 */
const resolveWithin = (root: string, file: string): string => {
  const path = resolve(root, file);
  const pathFromRoot = relative(root, path);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error(`Agent registry path escapes the pack: ${file}`);
  }
  return path;
};

const parseRegistry = (value: unknown): AgentRegistry => {
  if (!value || typeof value !== 'object') {
    throw new Error('Agent registry is not an object.');
  }
  const candidate = value as Partial<AgentRegistry>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) {
    throw new Error('Unsupported agent registry format.');
  }
  for (const entry of candidate.entries) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      (entry.kind !== 'role' && entry.kind !== 'project-type' && entry.kind !== 'policy') ||
      typeof entry.name !== 'string' ||
      typeof entry.description !== 'string' ||
      typeof entry.file !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error('Agent registry contains an invalid entry.');
    }
  }
  return candidate as AgentRegistry;
};

/** Every `.md` file under `directory`, recursively, sorted for a stable registry. */
const collectMarkdown = async (directory: string): Promise<string[]> => {
  const found: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) found.push(...(await collectMarkdown(path)));
    else if (item.name.endsWith('.md')) found.push(path);
  }
  return found.sort();
};

const kindOf = (file: string): AgentKind =>
  file.includes('/roles/') ? 'role' : file.includes('/project-types/') ? 'project-type' : 'policy';

/**
 * Build one entry from a pack-relative path and its contents.
 *
 * `file` must already be pack-relative with forward slashes — the id depends on
 * it, so normalizing here rather than at each caller keeps the two callers from
 * disagreeing on Windows.
 */
const deriveEntry = (file: string, content: string): AgentRegistryEntry => {
  const kind = kindOf(file);
  const slug = (file.split('/').at(-1) ?? file)
    .replace(/\.md$/, '')
    .toLowerCase()
    .replaceAll('_', '-');
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
  return {
    id: `${kind}:${slug}`,
    kind,
    name: heading,
    description,
    file,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
};

type DeriveOptions = {
  /**
   * Reject any single file larger than this.
   *
   * Playbook text is injected into a model's context — project types and the
   * intake policy are returned in full, unasked — so an oversized file does not
   * fail, it quietly consumes the context the actual notes needed. Bundled files
   * are reviewed and need no ceiling; a directory the user edits does.
   */
  maxFileBytes?: number;
  /** Reject empty files rather than registering a playbook that says nothing. */
  rejectEmpty?: boolean;
};

/**
 * Derive a full registry from a pack root — the directory *containing*
 * `.artist/`, which is also what registry `file` paths are relative to.
 */
const deriveRegistry = async (
  packRoot: string,
  { maxFileBytes, rejectEmpty = false }: DeriveOptions = {},
): Promise<AgentRegistry> => {
  const root = resolve(packRoot);
  const paths = await collectMarkdown(resolve(root, PACK_SUBDIRECTORY));
  const entries: AgentRegistryEntry[] = [];
  for (const path of paths) {
    const file = relative(root, path).replaceAll('\\', '/');
    const content = await readFile(path, 'utf8');
    if (rejectEmpty && content.trim() === '') {
      throw new Error(`Workflow file is empty: ${file}`);
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (maxFileBytes !== undefined && bytes > maxFileBytes) {
      throw new Error(
        `Workflow file is too large: ${file} is ${bytes} bytes, limit is ${maxFileBytes}.`,
      );
    }
    entries.push(deriveEntry(file, content));
  }
  return { schemaVersion: 1, entries };
};

export {
  PACK_SUBDIRECTORY,
  collectMarkdown,
  deriveEntry,
  deriveRegistry,
  parseRegistry,
  resolveWithin,
  type AgentKind,
  type DeriveOptions,
  type AgentRegistry,
  type AgentRegistryEntry,
};
