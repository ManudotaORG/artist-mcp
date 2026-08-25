/**
 * A line on this machine for every write that leaves it.
 *
 * The point is not compliance, it is recovery. A calendar event is reversible
 * in two seconds, but only by someone who knows it was created, which one, and
 * from which page — and none of that survives in a chat transcript a week
 * later. This is the record that makes "detectable and reversible" true rather
 * than merely stated. See docs/decisions/0001-opt-in-calendar-writes.md.
 *
 * Append-only, next to the tokens, because it is per-install state exactly as
 * they are. It is written by the same user who could delete it; that is fine,
 * since it defends against forgetting rather than against the user.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const auditPath = (): string =>
  process.env.ARTIST_MCP_AUDIT ?? join(homedir(), '.artist-mcp', 'writes.log');

export type WriteRecord = {
  operation: string;
  /** What was written, as the user would read it back. */
  summary: string;
  /** Where in the provider it landed, so it can be found again to undo. */
  target: string;
  /** The OneNote page this came from, when the caller named one. */
  source_page?: string | null;
};

/**
 * Record a write that has already happened.
 *
 * Failure here is swallowed deliberately. The event exists in the calendar by
 * this point, and throwing would report a successful write as a failure — which
 * is the one outcome guaranteed to make someone create it a second time. The
 * problem is said on stderr instead, where a stdio server's diagnostics go.
 */
export const recordWrite = async (entry: WriteRecord): Promise<void> => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  try {
    const path = auditPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line + '\n', 'utf8');
  } catch (err) {
    console.warn(
      `[artist-mcp] could not write the audit line for a completed write: ${err}. ` +
        `The event WAS created. Line: ${line}`,
    );
  }
};
