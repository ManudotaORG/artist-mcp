/**
 * The commands that manage this machine's provider connections.
 *
 * Deliberately separate from `init`, which still registers the Claude Desktop
 * entry and the hosted connection key. The two coexist while the operations are
 * still served by the edge function; once they move here, `init` loses the key
 * and these become the only way an install is connected.
 *
 * Microsoft is the working unit and Google is supporting evidence, so Microsoft
 * is what `connect` does when asked for nothing in particular, and Google is
 * opt-in — the same asymmetry the product has everywhere else.
 */

import { access } from 'node:fs/promises';
import { resolveRegistry, setLocalAgentRoot } from './agents.js';
import { ENTRY_NAME, configPath, readConfig } from './config.js';
import { connect } from './oauth.js';
import { PROVIDERS } from './oauth.js';
import { type ProviderName, clearProvider, loadTokens, readProvider } from './tokens.js';

const PROVIDER_NAMES = Object.keys(PROVIDERS) as ProviderName[];

const parseProvider = (input: string | undefined): ProviderName => {
  if (input === undefined) return 'microsoft';
  if ((PROVIDER_NAMES as string[]).includes(input)) return input as ProviderName;
  throw new Error(`Unknown provider "${input}". Expected one of: ${PROVIDER_NAMES.join(', ')}.`);
};

/** What each provider is for, so the consent screen is not a surprise. */
const PURPOSE: Record<ProviderName, string> = {
  microsoft: 'OneNote pages — the working unit',
  google: 'Gmail and Calendar — supporting evidence only',
};

export const runConnect = async (input?: string): Promise<void> => {
  const provider = parseProvider(input);

  await connect(provider);

  console.log(`\n${PROVIDERS[provider].label} connected — ${PURPOSE[provider]}.`);
  console.log('Read-only. Nothing is ever written back to your account.');

  if (provider === 'microsoft' && (await readProvider('google')) === undefined) {
    console.log('\nTo add Gmail and Calendar as evidence: artist-mcp connect google');
  }
};

/**
 * Removing the stored token stops this machine using the connection, but it
 * does not revoke the grant at the provider — only the user's account page can
 * do that, and saying so beats implying an access has been withdrawn that has
 * not.
 */
export const runDisconnect = async (input?: string): Promise<void> => {
  const provider = parseProvider(input);
  const config = PROVIDERS[provider];

  if ((await readProvider(provider)) === undefined) {
    console.log(`No ${config.label} connection on this machine. Nothing to do.`);
    return;
  }

  await clearProvider(provider);

  console.log(`Removed the ${config.label} connection from this machine.`);
  console.log(
    `The grant itself still exists in your ${config.label} account. To withdraw it ` +
      'entirely, remove this app there too.',
  );
};

/**
 * `--allow-writes <list>`, read back out of the entry `init` wrote.
 *
 * Out of the entry, deliberately, and not out of this process's arguments: the
 * grant belongs to the install, and `status` typed in a terminal carries none
 * of it. Reporting what argv happens to say would tell every user their install
 * is read-only, including the ones it is not.
 */
const recordedWrites = (args: unknown): string => {
  if (!Array.isArray(args)) return 'none — this install can only read';
  const at = args.indexOf('--allow-writes');
  const value = at === -1 ? undefined : args[at + 1];
  if (typeof value !== 'string' || value.trim() === '') {
    return 'none — this install can only read';
  }
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
};

/** `--agents <dir>`, read back out of the entry `init` wrote. */
const recordedAgentsDir = (args: unknown): string | undefined => {
  if (!Array.isArray(args)) return undefined;
  const at = args.indexOf('--agents');
  const value = at === -1 ? undefined : args[at + 1];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

const isPresent = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check what `init` wrote, not only what `connect` did.
 *
 * The connection lines alone leave the most confusing failure uncovered,
 * because it is not a connection problem: `init` records absolute paths, so
 * moving the checkout or renaming the playbook directory leaves an entry
 * launching something that no longer exists. Nothing complains — the server
 * starts, `status` reports both providers connected, and the install looks
 * entirely healthy right up until every workflow tool fails naming a directory
 * the user may have forgotten about.
 *
 * Renaming ~/artist-playbooks to ~/artist-mcp produced exactly that. This turns
 * it into one line in the terminal.
 *
 * Nothing here is re-derived: the pack is resolved through `resolveRegistry`,
 * the same call the server loads from, so this report cannot disagree with what
 * actually runs.
 */
const describeInstall = async (): Promise<void> => {
  const path = configPath();

  let entry: { command?: unknown; args?: unknown } | undefined;
  try {
    const config = await readConfig(path);
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    entry = servers[ENTRY_NAME] as typeof entry;
  } catch (err) {
    // An unreadable config is not an absent one, and saying "not installed"
    // would send the user to re-run init against a file init will refuse too.
    console.log(`Install    config unreadable — ${err instanceof Error ? err.message : err}`);
    return;
  }

  if (entry === undefined) {
    console.log(`Install    no "${ENTRY_NAME}" entry in ${path}`);
    console.log('           Run: artist-mcp init');
    return;
  }

  // Which of the two an entry is cannot be told from inside a chat, and they
  // fail in the same way when crossed, so it leads the line.
  const args = Array.isArray(entry.args) ? entry.args : [];
  const local = entry.command !== 'npx';
  const build = local ? 'local build' : `published package (${args[1] ?? 'unversioned'})`;

  if (local) {
    const target = typeof args[0] === 'string' ? args[0] : undefined;
    if (target === undefined || !(await isPresent(target))) {
      console.log(`Install    ${build} — MISSING: ${target ?? 'no path recorded'}`);
      console.log('           The checkout has moved since init ran. Re-run: artist-mcp init --local');
      return;
    }
    console.log(`Install    ${build} — ${target}`);
  } else {
    console.log(`Install    ${build}`);
  }

  // Before the playbook lines, which return early. A grant that only printed on
  // some installs would be worse than not printing it at all.
  console.log(`Writes     ${recordedWrites(entry.args)}`);

  const agentsDir = recordedAgentsDir(entry.args);
  if (agentsDir === undefined) {
    console.log('Playbooks  the shipped, checksummed ones');
    return;
  }

  // A local pack that cannot be read must never be reported as fine, for the
  // same reason it must never fall back silently: the user said which rules
  // govern their work, and running different ones misreports what is in force.
  try {
    setLocalAgentRoot(agentsDir);
    const { entries, localRoot } = await resolveRegistry();
    const mine = entries.filter((item) => item.source === 'local').length;
    console.log(`Playbooks  ${mine} of ${entries.length} from ${localRoot ?? agentsDir}`);
    if (mine === 0) {
      console.log('           That directory holds no playbooks — the shipped ones are in force.');
    }
  } catch (err) {
    // The resolver's own message already names the path and the command, so
    // repeating the advice here would only make a short report longer.
    console.log(`Playbooks  UNREADABLE: ${agentsDir}`);
    console.log(`           ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setLocalAgentRoot(undefined);
  }
};

export const runStatus = async (): Promise<void> => {
  await describeInstall();

  const { providers } = await loadTokens();
  const connected = PROVIDER_NAMES.filter((name) => providers[name] !== undefined);

  if (connected.length === 0) {
    console.log('Nothing connected on this machine. Start with: artist-mcp connect');
    return;
  }

  for (const name of PROVIDER_NAMES) {
    const entry = providers[name];
    const label = PROVIDERS[name].label.padEnd(10);
    console.log(
      entry === undefined
        ? `${label} not connected`
        : `${label} connected ${entry.connectedAt.slice(0, 10)} — ${entry.scope}`,
    );
  }
};
