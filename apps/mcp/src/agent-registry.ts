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
import { readdir, readFile, stat } from 'node:fs/promises';
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

/**
 * The container Markdown lives in, hidden or visible.
 *
 * `.artist/` is right inside a repository, where it sits beside `AGENTS.md` as
 * tool configuration and the policies refer to `.artist/local/`. It is wrong for
 * a standalone directory the user keeps their own playbooks in and opens in a
 * file browser: the folder they were told to edit appears to be empty, because
 * a leading dot hides it. So a local pack may use either, and the editable
 * install creates the visible one when starting a fresh directory.
 *
 * Exactly one container level, and only these two names — the strictness that
 * stops a loose or misfiled playbook being silently reclassified still holds.
 */
const PACK_SUBDIRECTORY = '.artist';
const VISIBLE_PACK_SUBDIRECTORY = 'artist';
const PACK_SUBDIRECTORIES = [PACK_SUBDIRECTORY, VISIBLE_PACK_SUBDIRECTORY];

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

const directoryExists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Which container a pack uses. Both present is an error rather than a
 * preference: the two would merge silently, and a playbook the user thought they
 * had replaced would sit in the copy that lost.
 */
const packSubdirectory = async (root: string): Promise<string> => {
  const present = [];
  for (const name of PACK_SUBDIRECTORIES) {
    if (await directoryExists(resolve(root, name))) present.push(name);
  }
  if (present.length > 1) {
    throw new Error(
      `${root} has both ${PACK_SUBDIRECTORIES.join(' and ')} directories. ` +
        'Keep one — merging them would hide whichever copy lost.',
    );
  }
  const [found] = present;
  if (!found) {
    throw new Error(
      `No ${PACK_SUBDIRECTORIES.join('/ or ')}/ directory in ${root}. ` +
        'Run `artist-mcp init --editable <directory>` to install a pack there.',
    );
  }
  return found;
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

/** The directory a file sits in *is* its kind. There is no other signal. */
const KIND_DIRECTORIES: Record<string, AgentKind> = {
  roles: 'role',
  'project-types': 'project-type',
  policies: 'policy',
};

/**
 * Require the exact layout `.artist/<kind>/<name>.md`.
 *
 * This used to fall back to `policy` for anything that was not under `roles/` or
 * `project-types/`, which was harmless while the only inputs were three reviewed
 * directories in this repo. Once the directory belongs to the user it is a trap:
 * a playbook dropped into `.artist/` or into an invented subdirectory became a
 * policy, and policies other than intake are summarised rather than returned in
 * full — so the file loaded, `agents status` listed it, and the rules in it were
 * then largely ignored. That reads as the model disregarding the user's playbook
 * rather than as a misfiled file, which is the wrong thing to go looking for.
 *
 * Nesting is refused for the same reason: two files with one name in different
 * subdirectories would derive one id, and the loser would vanish silently.
 */
const kindOf = (file: string): AgentKind => {
  const segments = file.split('/');
  const kind = segments.length === 3 ? KIND_DIRECTORIES[segments[1] ?? ''] : undefined;
  if (!PACK_SUBDIRECTORIES.includes(segments[0] ?? '') || !kind) {
    throw new Error(
      `Workflow file is not in a recognised directory: ${file}. Expected ` +
        `<${PACK_SUBDIRECTORIES.join('|')}>/<${Object.keys(KIND_DIRECTORIES).join('|')}>/<name>.md`,
    );
  }
  return kind;
};

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
  const paths = await collectMarkdown(resolve(root, await packSubdirectory(root)));
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

// Only what another module actually consumes. The container names, the file walk,
// and the option and kind types are this module's business: exporting them
// invited a second caller to infer the layout rule instead of calling `kindOf`,
// which is the drift this file exists to prevent.
export {
  VISIBLE_PACK_SUBDIRECTORY,
  deriveEntry,
  deriveRegistry,
  packSubdirectory,
  parseRegistry,
  resolveWithin,
  type AgentRegistry,
  type AgentRegistryEntry,
};
