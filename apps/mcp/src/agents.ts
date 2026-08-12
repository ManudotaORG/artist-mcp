import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packRoot = fileURLToPath(new URL('../agent-pack/', import.meta.url));

type AgentRegistryEntry = {
  id: string;
  kind: 'role' | 'project-type' | 'policy';
  name: string;
  description: string;
  file: string;
  sha256: string;
};

type AgentRegistry = {
  schemaVersion: 1;
  entries: AgentRegistryEntry[];
};

type LoadedAgentWorkflow = AgentRegistryEntry & {
  content: string;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const assertSafePackPath = (file: string): string => {
  const path = resolve(packRoot, file);
  const pathFromRoot = relative(packRoot, path);
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

const listAgentWorkflows = async (): Promise<AgentRegistryEntry[]> => {
  if (!process.env.ARTIST_MCP_REGISTRY_URL) {
    return (await readBundledRegistry()).entries;
  }
  try {
    return (await fetchRemoteRegistry()).registry.entries;
  } catch {
    return (await readBundledRegistry()).entries;
  }
};

const verifyContent = (entry: AgentRegistryEntry, content: string): void => {
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== entry.sha256) {
    throw new Error(`Checksum verification failed for ${entry.id}.`);
  }
};

const loadBundledWorkflow = async (id: string): Promise<LoadedAgentWorkflow> => {
  const registry = await readBundledRegistry();
  const entry = registry.entries.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`Unknown agent workflow: ${id}`);
  }
  const content = await readFile(assertSafePackPath(entry.file), 'utf8');
  verifyContent(entry, content);
  return { ...entry, content };
};

const loadAgentWorkflow = async (id: string): Promise<LoadedAgentWorkflow> => {
  if (!process.env.ARTIST_MCP_REGISTRY_URL) {
    return loadBundledWorkflow(id);
  }
  try {
    const { registry, url } = await fetchRemoteRegistry();
    const entry = registry.entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error(`Unknown agent workflow: ${id}`);
    }
    const response = await fetch(new URL(entry.file, url), {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      throw new Error(`Agent workflow returned HTTP ${response.status}.`);
    }
    const content = await response.text();
    verifyContent(entry, content);
    return { ...entry, content };
  } catch (error) {
    try {
      return await loadBundledWorkflow(id);
    } catch {
      throw error;
    }
  }
};

const installAgentPack = async (directory = process.cwd()): Promise<void> => {
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

export {
  installAgentPack,
  listAgentWorkflows,
  loadAgentWorkflow,
  type AgentRegistryEntry,
  type LoadedAgentWorkflow,
};
