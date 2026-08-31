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
import { parseGrants, type WriteCapability } from './grants.js';
import { WRITE_SCOPES, connect } from './oauth.js';
import { PROVIDERS } from './oauth.js';
import { expiryAtConnect, expiryNotice, expiryState } from './expiry.js';
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

  // Every grant, not Google's. This read `provider === 'google' ? ... : []`,
  // which was right while Google was the only provider a grant could widen and
  // would have left `artist-mcp connect microsoft` asking for the read-only
  // scope regardless — every create then failing with a 403 that named a
  // permission the user believed they had granted. `scopesFor` filters by
  // provider, so passing all of them asks each provider for only its own.
  const grants = await installedGrants();
  const relevant = grants.filter((name) => WRITE_SCOPES[name]?.provider === provider);

  const expiresAt = await connect(provider, grants);

  console.log(`\n${PROVIDERS[provider].label} connected — ${PURPOSE[provider]}.`);
  if (relevant.length === 0) {
    console.log('Read-only. Nothing is ever written back to your account.');
  } else {
    // Named, because the consent screen the user just approved was wider than
    // the one every other install sees, and they should be able to tell why.
    // What Microsoft consent covered depends on which OneNote grants are held,
    // and the difference is exactly the thing a user would want to know. This
    // said unconditionally that no page could be changed "including the ones it
    // creates — the permission it holds cannot express that", which was true of
    // `Notes.Create` alone and becomes a false reassurance the moment
    // `onenote-edit` is granted. A sentence that is wrong only for the widest
    // install is the worst possible place to be wrong.
    const canEdit = relevant.includes('onenote-edit');
    const microsoft = canEdit
      ? 'creating OneNote pages and changing the ones it created. It cannot ' +
        'touch a page you wrote or one another app created — Microsoft refuses ' +
        'those — and it cannot delete anything. A change it makes to its own ' +
        'page overwrites what was there, and OneNote keeps no version, so what ' +
        'it replaced is kept only in this install\'s write log.'
      : 'creating OneNote pages. No page can be changed or deleted by this ' +
        'tool, including the ones it creates — the permission it holds cannot ' +
        'express that.';

    console.log(
      `This install was granted ${relevant.join(', ')}, so consent included ` +
        (provider === 'microsoft'
          ? microsoft
          : 'creating calendar events. Nothing else is ever written back: not ' +
            'mail, and no event is changed except by the reschedule you granted.'),
    );
  }

  // Said at the one moment the user is certainly reading, which is the whole
  // point: #94 describes a connection that dies weekly, an error that correctly
  // advises a reconnect, and a cause nobody could see from either.
  const lapses = expiryAtConnect(provider, expiresAt);
  if (lapses !== undefined) console.log(`\n${lapses}`);

  if (provider === 'microsoft' && (await readProvider('google')) === undefined) {
    console.log('\nTo add Gmail and Calendar as evidence: artist-mcp connect google');
  }
};

/**
 * Reconnect whatever has lapsed, without the user having to work out which.
 *
 * The reconnect was always one command; knowing that it was needed, and for
 * which provider, was the part that cost people a session. This closes that
 * gap — and refuses to do anything when nothing has lapsed, so it can be run on
 * a hunch without silently sending someone through a consent screen they did
 * not need.
 */
export const runReconnect = async (): Promise<void> => {
  const { providers } = await loadTokens();
  const lapsed = PROVIDER_NAMES.filter((name) => {
    const entry = providers[name];
    return entry !== undefined && expiryState(entry).kind === 'lapsed';
  });

  if (lapsed.length === 0) {
    console.log('Nothing has lapsed. Run `artist-mcp status` to see what is connected.');
    // Not an error: "nothing to do" is the answer, and exiting non-zero would
    // make a scheduled check look like a failure every time it worked.
    return;
  }

  for (const provider of lapsed) {
    console.log(`\n${PROVIDERS[provider].label} lapsed — reconnecting.`);
    await runConnect(provider);
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
const recordedGrants = (args: unknown): WriteCapability[] => {
  if (!Array.isArray(args)) return [];
  const at = args.indexOf('--allow-writes');
  const value = at === -1 ? undefined : args[at + 1];
  if (typeof value !== 'string') return [];
  try {
    return parseGrants(value);
  } catch {
    // A malformed entry is reported by `status`, and `init` refuses to write
    // one. Connecting is not the moment to fail on it: asking for the read
    // scopes still leaves a working connection, where throwing leaves none.
    return [];
  }
};

/**
 * What this install was granted, read from the Claude Desktop entry.
 *
 * The same reasoning as `status`: the grant belongs to the install, and
 * `artist-mcp connect google` typed in a terminal carries none of it. Reading
 * argv here would ask every user for the read-only scopes and quietly leave a
 * granted install unable to write.
 */
const installedGrants = async (): Promise<WriteCapability[]> => {
  try {
    const config = await readConfig(configPath());
    const servers = (config.mcpServers ?? {}) as Record<string, { args?: unknown }>;
    return recordedGrants(servers[ENTRY_NAME]?.args);
  } catch {
    return [];
  }
};

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

  let anyLapsed = false;

  for (const name of PROVIDER_NAMES) {
    const entry = providers[name];
    const label = PROVIDERS[name].label.padEnd(10);

    if (entry === undefined) {
      console.log(`${label} not connected`);
      continue;
    }

    console.log(`${label} connected ${entry.connectedAt.slice(0, 10)} — ${entry.scope}`);

    // On its own line and only when there is something to say. A connection
    // with a week left says nothing, so the day it does say something the line
    // is new rather than furniture.
    const notice = expiryNotice(name, entry);
    if (notice !== undefined) {
      console.log(`${' '.repeat(11)}${notice}`);
      if (expiryState(entry).kind === 'lapsed') anyLapsed = true;
    }
  }

  if (anyLapsed) {
    console.log('\nOr reconnect everything that lapsed at once: artist-mcp reconnect');
  }
};
