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

export const runStatus = async (): Promise<void> => {
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
