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

/**
 * Where a completed write is recorded.
 *
 * Injected for the same reason the token resolver is: on this machine it is a
 * file in the user's home directory, and hosted it is a row bound to one user.
 * A file on a serverless host is one nobody will ever read, and "detectable and
 * reversible" is the whole justification for these writes existing — so the
 * sink has to be the caller's to choose. See
 * docs/decisions/0002-hosted-writes.md.
 */
export type RecordWrite = (entry: WriteRecord) => Promise<void>;

export type WriteRecord = {
  operation: string;
  /** What was written, as the user would read it back. */
  summary: string;
  /** Where in the provider it landed, so it can be found again to undo. */
  target: string;
  /** The OneNote page this came from, when the caller named one. */
  source_page?: string | null;
  /**
   * For a created OneNote page: the app identifier Microsoft stamped on it.
   *
   * Recorded because it cannot be derived. It is an opaque legacy identifier
   * unrelated to the client id this product configures, so it can only be
   * learned by creating a page and reading it back — and anything later asking
   * "did this tool create that page?" has nothing to compare against unless the
   * value was kept at the one moment it was known. See
   * docs/decisions/0003-onenote-writes.md.
   */
  created_by_app_id?: string | null;
  /**
   * For a replaced OneNote element: exactly what was on the page beforehand.
   *
   * This is the undo, and there is no other one. OneNote keeps no version of a
   * page and a Graph write leaves nothing in the recycle bin, so what stood
   * where the change landed exists nowhere else the moment the PATCH returns
   * 204. The audit line is not a note about the write here — it *is* the
   * recovery, which is what the header of this file has always claimed the
   * point of these records to be.
   *
   * Held as the element's HTML rather than its text, because restoring it means
   * writing it back. It restores content and not bytes: OneNote rewrites the
   * markup it stores, so a restored paragraph comes back carrying its words and
   * not its original HTML. See docs/decisions/0004-onenote-page-maintenance.md.
   */
  pre_image?: string | null;
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
