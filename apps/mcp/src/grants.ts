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
  'calendar-delete':
    'remove an event that artist-mcp itself created, after showing it to you first. ' +
    'It cannot touch an event you made or one someone shared with you.',
  // The only capability here whose boundary is not this file's to keep.
  // `Notes.Create` permits creating pages and nothing else, so a token holding
  // it cannot edit or delete any page — verified, not assumed: a 403 on both
  // PATCH and DELETE against a page the token had just created itself. Every
  // other row above exists because Google would not draw that line for us.
  // See docs/decisions/0003-onenote-writes.md.
  'onenote-create':
    'add a new page to a OneNote section, after showing it to you first. ' +
    'It cannot change or delete any page, including the ones it made.',
  // Also not this file's boundary to keep, and for a stronger reason than
  // `onenote-create`: `Notes.ReadWrite.CreatedByApp` distinguishes *this* app
  // from every other, so a page the musician wrote is refused by Microsoft
  // before our code is reached — verified as 401 40003, not assumed.
  //
  // One capability covering both actions rather than two. No scope separates
  // appending from replacing, so a second grant would be a promise this
  // repository keeps while reading like the provider-enforced kind, which is
  // the confusion 0003 exists to prevent. What makes a replace survivable is
  // the pre-image, not the name it was granted under.
  // See docs/decisions/0004-onenote-page-maintenance.md.
  'onenote-edit':
    'change a page that artist-mcp itself created, after showing it to you first. ' +
    'It cannot touch a page you wrote, and it cannot delete anything.',
} as const;

export type WriteCapability = keyof typeof WRITE_CAPABILITIES;

/** Whether a bare token names a capability, for untangling mangled arguments. */
export const isWriteCapability = (value: unknown): value is WriteCapability =>
  typeof value === 'string' && Object.keys(WRITE_CAPABILITIES).includes(value);

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

  // Commas or whitespace, because a comma does not survive Windows. Claude
  // Desktop spawns `npx`, which is a .cmd batch script there, and cmd.exe
  // treats a comma as an argument separator — `calendar-create,calendar-delete`
  // arrived as the single string `calendar-create calendar-delete` and was
  // refused as one unknown capability. A separator that the platform's own
  // shell rewrites is the wrong separator to insist on.
  const named = raw
    .split(/[\s,]+/)
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
 * Whether a write tool may be registered, given what this caller was granted.
 *
 * A parameter, not module state. One stdio process serves one user and could
 * safely hold it in a variable; the hosted route serves many users from one
 * process, where a grant set per request would let one user's capability reach
 * another's session. That failure would pass every test here, because every
 * test runs one user at a time — so the shape has to prevent it rather than the
 * discipline. See docs/decisions/0001-opt-in-calendar-writes.md.
 *
 * Registration, not refusal at call time: a tool that exists is a tool a model
 * will try, and a refusal inside a tool result reads as an obstacle to route
 * around rather than as a boundary.
 */
export const isGranted = (
  grants: readonly WriteCapability[],
  capability: WriteCapability,
): boolean => grants.includes(capability);

/**
 * How the grant is described wherever it is reported: `init`, `agents status`,
 * and the workflow briefing. A capability nobody can see is one nobody accounts
 * for, which is the handshake bug again — a correct thing that never reached
 * the client.
 */
export const describeGrants = (grants: readonly WriteCapability[]): string => {
  if (grants.length === 0) {
    return 'Writes: none. This install can only read.';
  }
  const lines = grants.map((name) => `  - ${name}: ${WRITE_CAPABILITIES[name]}`);
  return `Writes granted to this install:\n${lines.join('\n')}`;
};
