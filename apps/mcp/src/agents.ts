import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VISIBLE_PACK_SUBDIRECTORY,
  deriveRegistry,
  packSubdirectory,
  parseRegistry,
  resolveWithin,
  type AgentRegistry,
  type AgentRegistryEntry,
} from './agent-registry.js';

const packRoot = fileURLToPath(new URL('../agent-pack/', import.meta.url));

/** One playbook's text, before provenance is attached. */
type ReadWorkflow = AgentRegistryEntry & { content: string };

type LoadedAgentWorkflow = ReadWorkflow & {
  source: AgentSource;
  /** The pack root this came from: a directory for local, a URL for remote. */
  origin: string;
};

/** Where an entry was read from. Bundled is the shipped, checksummed pack. */
type AgentSource = 'bundled' | 'remote' | 'local';

/** 64 KiB per file. The longest bundled playbook is well under 10 KiB. */
const MAX_LOCAL_FILE_BYTES = 64 * 1024;

/**
 * The directory a user's own playbooks are read from, if any.
 *
 * Held here rather than threaded through every call because it is settled once,
 * at startup, from the command line — and a Claude Desktop server is spawned
 * with no cwd worth trusting, so there is nothing to discover later. The env var
 * is the development and testing override, matching ARTIST_MCP_REGISTRY_URL.
 */
let explicitLocalRoot: string | undefined;

const setLocalAgentRoot = (directory?: string): void => {
  explicitLocalRoot = directory ? resolve(directory) : undefined;
};

const localAgentRoot = (): string | undefined => {
  const directory = explicitLocalRoot ?? process.env.ARTIST_MCP_AGENTS_DIR;
  return directory ? resolve(directory) : undefined;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const assertSafePackPath = (file: string): string => resolveWithin(packRoot, file);

const readBundledRegistry = async (): Promise<AgentRegistry> => {
  const raw = await readFile(resolve(packRoot, 'registry.json'), 'utf8');
  return parseRegistry(JSON.parse(raw));
};

const fetchRemoteRegistry = async (): Promise<{ registry: AgentRegistry; url: URL }> => {
  const registryUrl = process.env.ARTIST_MCP_REGISTRY_URL;
  if (!registryUrl) {
    throw new Error('ARTIST_MCP_REGISTRY_URL is not configured.');
  }
  const url = new URL(registryUrl);
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) {
    throw new Error(`Agent registry returned HTTP ${response.status}.`);
  }
  return { registry: parseRegistry(await response.json()), url };
};

/**
 * Read a user's own pack.
 *
 * Deliberately not forgiving. A broken directory here must not fall back to the
 * bundled pack the way an unreachable remote registry does: the user said which
 * playbooks govern their work, and silently running different ones would
 * misreport what is in force — the one thing this layer cannot get wrong.
 */
const readLocalRegistry = async (root: string): Promise<AgentRegistry> => {
  // A missing, doubled, or misfiled container is reported by the derivation
  // itself, which knows which names it accepts. Repeating the check here meant
  // two messages for one mistake, and only one of them mentioned both layouts.
  const registry = await deriveRegistry(root, {
    maxFileBytes: MAX_LOCAL_FILE_BYTES,
    rejectEmpty: true,
  });
  if (registry.entries.length === 0) {
    throw new Error(`No workflow Markdown found under ${root}.`);
  }
  return registry;
};

type ResolvedEntry = AgentRegistryEntry & { source: AgentSource; origin: string };

type Resolution = {
  entries: ResolvedEntry[];
  /** The pack the local directory is layered over. */
  base: { source: AgentSource; origin: string };
  /** Set when a local directory contributed entries. */
  localRoot?: string;
  /** True when a remote registry was configured but could not be reached. */
  remoteUnreachable: boolean;
};

/**
 * Decide which files this run uses, and remember where each one came from.
 *
 * The choice and the reporting belong together: `agents status` exists so a user
 * can see which files are actually in force, and it would be worthless if it
 * re-derived the answer separately from the code that loads them.
 *
 * Local entries shadow the base pack by id rather than replacing it wholesale,
 * so editing one project type does not mean forking all thirteen files — and a
 * playbook added by a later package version still arrives.
 */
const resolveRegistry = async (): Promise<Resolution> => {
  let base: { registry: AgentRegistry; source: AgentSource; origin: string };
  let remoteUnreachable = false;
  if (process.env.ARTIST_MCP_REGISTRY_URL) {
    try {
      const { registry, url } = await fetchRemoteRegistry();
      base = { registry, source: 'remote', origin: url.href };
    } catch {
      remoteUnreachable = true;
      base = { registry: await readBundledRegistry(), source: 'bundled', origin: packRoot };
    }
  } else {
    base = { registry: await readBundledRegistry(), source: 'bundled', origin: packRoot };
  }

  const byId = new Map<string, ResolvedEntry>(
    base.registry.entries.map((entry) => [
      entry.id,
      { ...entry, source: base.source, origin: base.origin },
    ]),
  );

  const localRoot = localAgentRoot();
  if (localRoot) {
    for (const entry of (await readLocalRegistry(localRoot)).entries) {
      byId.set(entry.id, { ...entry, source: 'local', origin: localRoot });
    }
  }

  return {
    entries: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    base: { source: base.source, origin: base.origin },
    localRoot,
    remoteUnreachable,
  };
};

const listAgentWorkflows = async (): Promise<ResolvedEntry[]> => (await resolveRegistry()).entries;

const verifyContent = (entry: AgentRegistryEntry, content: string): void => {
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== entry.sha256) {
    throw new Error(`Checksum verification failed for ${entry.id}.`);
  }
};

const loadBundledWorkflow = async (id: string): Promise<ReadWorkflow> => {
  const registry = await readBundledRegistry();
  const entry = registry.entries.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`Unknown agent workflow: ${id}`);
  }
  const content = await readFile(assertSafePackPath(entry.file), 'utf8');
  verifyContent(entry, content);
  return { ...entry, content };
};

const loadRemoteWorkflow = async (entry: AgentRegistryEntry): Promise<ReadWorkflow> => {
  const { url } = await fetchRemoteRegistry();
  const response = await fetch(new URL(entry.file, url), { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) {
    throw new Error(`Agent workflow returned HTTP ${response.status}.`);
  }
  const content = await response.text();
  verifyContent(entry, content);
  return { ...entry, content };
};

/**
 * Read one file out of the user's directory.
 *
 * The checksum was derived from this same directory moments ago, so it proves
 * something narrower than the bundled one does — not "this is what we shipped"
 * but "this file did not change between being listed and being loaded". Worth
 * keeping: the user is editing these files while the server is running.
 */
const loadLocalWorkflow = async (
  entry: AgentRegistryEntry,
  root: string,
): Promise<ReadWorkflow> => {
  const content = await readFile(resolveWithin(root, entry.file), 'utf8');
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== entry.sha256) {
    throw new Error(
      `${entry.file} changed while it was being read. Ask again to pick up the new version.`,
    );
  }
  return { ...entry, content };
};

const loadAgentWorkflow = async (id: string): Promise<LoadedAgentWorkflow> => {
  const { entries, localRoot } = await resolveRegistry();
  const entry = entries.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`Unknown agent workflow: ${id}`);
  }

  const read = async (): Promise<AgentRegistryEntry & { content: string }> => {
    if (entry.source === 'local') {
      // No fall back to the bundled copy. A local id exists because the user
      // wrote the file; answering with different text under the same id would be
      // worse than saying the read failed.
      return loadLocalWorkflow(entry, localRoot ?? entry.origin);
    }
    if (entry.source === 'remote') {
      try {
        return await loadRemoteWorkflow(entry);
      } catch (error) {
        try {
          return await loadBundledWorkflow(id);
        } catch {
          throw error;
        }
      }
    }
    return loadBundledWorkflow(id);
  };

  // Carry the provenance out with the text. The caller has to be able to say
  // whose rules these are, and for a local file, which file to edit.
  return { ...(await read()), source: entry.source, origin: entry.origin };
};

const installAgentPack = async (directory = process.cwd()): Promise<void> => {
  assertNotHomeDirectory(directory, 'agents install');
  const registry = await readBundledRegistry();
  const packFiles = ['AGENTS.md', ...registry.entries.map((entry) => entry.file)];
  const destinationRoot = resolve(directory);
  const conflicts: string[] = [];
  let agentsInstructionsSkipped = false;

  for (const file of packFiles) {
    const source = assertSafePackPath(file);
    const destination = resolve(destinationRoot, file);
    const pathFromRoot = relative(destinationRoot, destination);
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new Error(`Agent pack target escapes the destination: ${file}`);
    }
    if (await exists(destination)) {
      const [current, bundled] = await Promise.all([
        readFile(destination, 'utf8'),
        readFile(source, 'utf8'),
      ]);
      if (current !== bundled) {
        if (file === 'AGENTS.md') agentsInstructionsSkipped = true;
        else conflicts.push(file);
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Agent pack stopped before writing. Existing files differ: ${conflicts.join(', ')}`,
    );
  }

  for (const file of packFiles) {
    const destination = resolve(destinationRoot, file);
    if (file === 'AGENTS.md' && agentsInstructionsSkipped) {
      console.log('Left existing AGENTS.md unchanged');
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    if (!(await exists(destination))) {
      await copyFile(assertSafePackPath(file), destination);
      console.log(`Installed ${file}`);
    } else {
      console.log(`Already current ${file}`);
    }
  }

  if (agentsInstructionsSkipped) {
    console.log('Reference the files under .artist/ from your existing AGENTS.md.');
  }
  console.log('Read-only artist workflow pack is ready.');
};

/**
 * Report which workflow files are in force and where each one came from.
 *
 * Worth a command of its own because the failure it diagnoses is silent: the
 * server answers normally whichever files it read, so an edit that is not being
 * picked up looks exactly like an edit that had no effect.
 */
const runAgentsStatus = async (): Promise<void> => {
  const { entries, base, localRoot, remoteUnreachable } = await resolveRegistry();
  console.log(`Base pack: ${base.source}`);
  console.log(`  ${base.origin}`);
  if (remoteUnreachable) {
    console.log('  (ARTIST_MCP_REGISTRY_URL is set but unreachable; using the bundled pack.)');
  }
  if (localRoot) {
    const shadowed = entries.filter((entry) => entry.source === 'local').length;
    console.log(`\nLocal pack: ${localRoot}`);
    console.log(`  ${shadowed} of ${entries.length} workflows come from here.`);
  } else {
    console.log('\nLocal pack: none. Playbooks are the ones shipped with the package.');
  }
  console.log(`\n${entries.length} workflows:`);
  for (const entry of entries) {
    console.log(`  ${entry.id.padEnd(28)} ${entry.source.padEnd(8)} ${entry.file}`);
  }
};

/**
 * Check a directory is a usable pack, and say how much is in it.
 *
 * Called by `init` so a typo in the path fails while the user is still looking
 * at the terminal. Otherwise the mistake surfaces later as every workflow tool
 * failing inside Claude Desktop, which is a much worse sentence to act on.
 */
const assertLocalAgentPack = async (directory: string): Promise<number> =>
  (await readLocalRegistry(resolve(directory))).entries.length;

/**
 * The container an existing pack uses, or the visible one for a new directory.
 *
 * Keeping a directory on `.artist/` once it has one matters more than the
 * preference does: silently writing the visible name beside it would split the
 * pack in two, and the doubled-container error would then greet a user who had
 * only run the documented command twice.
 */
const existingContainer = async (root: string): Promise<string> => {
  try {
    return await packSubdirectory(root);
  } catch (err) {
    // Both present is a real conflict and must not be papered over; nothing
    // present is the ordinary first run.
    if (err instanceof Error && err.message.includes('both')) throw err;
    return VISIBLE_PACK_SUBDIRECTORY;
  }
};

/**
 * The default home for an editable pack, when the user names no directory.
 *
 * A folder of its own rather than files loose in the home directory. It sits
 * beside the hidden `~/.artist-mcp/` that holds the tokens — one visible folder
 * the user opens and edits, one hidden one they never touch.
 */
const DEFAULT_EDITABLE_DIRECTORY = join(homedir(), 'artist-mcp');

/**
 * Refuse to scatter a pack across the home directory itself.
 *
 * `agents install` defaults to the working directory, which is right in a
 * project and ruinous in a home folder: running it from `~` wrote `AGENTS.md`
 * and `.artist/` straight into it, where they sat unread. Naming the mistake
 * costs one check; cleaning it up afterwards costs the user their afternoon.
 */
const assertNotHomeDirectory = (directory: string, command: string): void => {
  if (resolve(directory) !== resolve(homedir())) return;
  throw new Error(
    `Refusing to write a workflow pack directly into your home directory.\n` +
      `${command} puts the files in the directory you give it, so give it one: ` +
      `a project folder, or ${DEFAULT_EDITABLE_DIRECTORY} for playbooks you edit.`,
  );
};

type SeedResult = {
  root: string;
  container: string;
  /** Written now: a first install, or a playbook new in this version. */
  added: string[];
  /** Present and identical to the shipped text. */
  unchanged: string[];
  /** Present and different. The user's work; never touched. */
  yours: string[];
};

/**
 * Copy the whole pack into a directory the user owns, and say what happened.
 *
 * All of it, not a file at a time. Per-file opt-in made the user keep track of
 * which playbooks were theirs and which were still the package's, which is book-
 * keeping the tool should be doing — and the reason it existed, that a full copy
 * stops a later version's improvements arriving, is answered by this being
 * re-runnable rather than by pushing the problem outward: run it again after an
 * upgrade and playbooks new in that version are added, while anything edited is
 * left exactly as it is.
 *
 * Never overwrites. A file that differs from the shipped text is the user's, and
 * this cannot tell a deliberate edit from an experiment, so it reports and moves
 * on rather than deciding.
 */
const seedEditablePack = async (
  directory: string = DEFAULT_EDITABLE_DIRECTORY,
): Promise<SeedResult> => {
  assertNotHomeDirectory(directory, 'init --editable');
  const registry = await readBundledRegistry();
  const root = resolve(directory);
  // A fresh directory gets the visible container. The hidden one is right in a
  // repository, beside AGENTS.md; here the user opens this folder in a file
  // browser to edit what is in it, and a leading dot makes it look empty.
  const container = await existingContainer(root);
  const result: SeedResult = { root, container, added: [], unchanged: [], yours: [] };

  for (const entry of registry.entries) {
    const withinPack = entry.file.split('/').slice(1).join('/');
    const destination = resolveWithin(root, `${container}/${withinPack}`);
    const bundled = await readFile(assertSafePackPath(entry.file), 'utf8');

    if (await exists(destination)) {
      const current = await readFile(destination, 'utf8');
      (current === bundled ? result.unchanged : result.yours).push(entry.id);
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bundled, 'utf8');
    result.added.push(entry.id);
  }

  return result;
};

/** Report a seed in the terms the user cares about: what moved, what was kept. */
const describeSeed = ({ root, container, added, unchanged, yours }: SeedResult): void => {
  const total = added.length + unchanged.length + yours.length;
  console.log(`${total} playbooks in ${join(root, container)}`);
  if (added.length > 0) console.log(`  ${added.length} copied in`);
  if (unchanged.length > 0) console.log(`  ${unchanged.length} already matched the shipped text`);
  if (yours.length > 0) {
    console.log(`  ${yours.length} you have edited, left untouched: ${yours.join(', ')}`);
  }
  console.log('Edit any of them, or add your own alongside them.');
};

export {
  DEFAULT_EDITABLE_DIRECTORY,
  assertLocalAgentPack,
  assertNotHomeDirectory,
  describeSeed,
  seedEditablePack,
  installAgentPack,
  listAgentWorkflows,
  loadAgentWorkflow,
  resolveRegistry,
  runAgentsStatus,
  setLocalAgentRoot,
  type AgentRegistryEntry,
  type AgentSource,
  type LoadedAgentWorkflow,
  type ResolvedEntry,
};
