/**
 * Which writes this install is allowed to perform.
 *
 * The product was read-only, and the boundary rested on OAuth scopes: a
 * read-only token could not write whatever the code did. Google publishes no
 * insert-only Calendar scope — `events.insert` and `events.delete` accept the
 * identical four — so from the first write onward the scope layer no longer
 * separates creating from deleting. What separates them is this file and the
 * operation table. See docs/decisions/0001-opt-in-calendar-writes.md.
 *
 * The grant is one install argument naming capabilities, not a boolean and not
 * a flag per tool. A boolean cannot tell `init` which scope to request, and
 * because a refresh token carries the scopes it was granted with, that question
 * has to be answered before the consent screen rather than after. Naming the
 * capability also means a second write tool cannot arrive already granted: the
 * user has to edit the string, which is the consent moment worth keeping.
 *
 * It lives in the Claude Desktop entry's own args, exactly like `--agents`, so
 * the security boundary is filesystem permissions on that file. That is chosen
 * rather than inherited — the OAuth tokens already sit under the same trust on
 * the same machine.
 */

/**
 * Every capability that may be granted, and what each one lets an install do.
 *
 * Closed on purpose. An unrecognised name is refused by name rather than
 * ignored, the way a misfiled playbook is: a typo that silently grants nothing
 * gets diagnosed as "the write tool is broken".
 */
export const WRITE_CAPABILITIES = {
  'calendar-create': 'add a single event to a Google Calendar, after showing it to you first',
} as const;

export type WriteCapability = keyof typeof WRITE_CAPABILITIES;

const KNOWN = Object.keys(WRITE_CAPABILITIES) as WriteCapability[];

/**
 * Read the grant string a user typed, or that `init` wrote into the entry.
 *
 * Strict, because every failure mode here is silent otherwise. An empty flag is
 * refused rather than read as "grant nothing": someone typing `--allow-writes`
 * meant to grant something, and starting anyway would hide the mistake until
 * the tool they wanted was missing.
 */
export const parseGrants = (raw: string | undefined): WriteCapability[] => {
  if (raw === undefined) return [];

  const named = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (named.length === 0) {
    throw new Error(
      `--allow-writes needs at least one capability. Available: ${KNOWN.join(', ')}.`,
    );
  }

  const unknown = named.filter((name) => !KNOWN.includes(name as WriteCapability));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown write capability: ${unknown.join(', ')}. Available: ${KNOWN.join(', ')}.`,
    );
  }

  // Deduplicated rather than refused: repeating a name is harmless and means
  // exactly what it says, unlike naming one that does not exist.
  return [...new Set(named as WriteCapability[])];
};

/**
 * What this process may do, decided once at startup.
 *
 * Module state for the same reason the playbook root is: the server is spawned
 * by Claude Desktop with whatever `init` wrote, and nothing downstream should
 * be re-deriving the answer or able to widen it later.
 */
let granted: readonly WriteCapability[] = [];

export const setGrants = (capabilities: readonly WriteCapability[]): void => {
  granted = [...capabilities];
};

export const grantedWrites = (): readonly WriteCapability[] => granted;

/**
 * Whether a write tool may be registered at all.
 *
 * Registration, not refusal at call time. A tool that exists is a tool a model
 * will try, and a refusal inside a tool result reads as an obstacle to route
 * around rather than as a boundary — so an ungranted write tool is absent, not
 * present and saying no.
 */
export const isGranted = (capability: WriteCapability): boolean => granted.includes(capability);

/**
 * How the grant is described wherever it is reported: `init`, `agents status`,
 * and the workflow briefing. A capability nobody can see is one nobody accounts
 * for, which is the handshake bug again — a correct thing that never reached
 * the client.
 */
export const describeGrants = (): string => {
  if (granted.length === 0) {
    return 'Writes: none. This install can only read.';
  }
  const lines = granted.map((name) => `  - ${name}: ${WRITE_CAPABILITIES[name]}`);
  return `Writes granted to this install:\n${lines.join('\n')}`;
};
