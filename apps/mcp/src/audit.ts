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

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { GraphError } from './client.js';

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
  /**
   * Two-phase recording (0018): the same id on a `pending` line written
   * before the write and a `done` line after it. A write that has an undo is
   * recorded as pending first and refused if that cannot be done, because a
   * write whose pre-image was not kept is a write with no way back. A pending
   * line with no done line is a write that may or may not have landed, and
   * whatever reads this log has to look at the page rather than trust it.
   * Absent on writes recorded the old way, once, afterwards.
   */
  write_id?: string;
  status?: 'pending' | 'done';
  /** What the write put there, as written, so an undo can find it again. */
  wrote?: string | null;
};

/** A line of the write log as read back. */
export type WrittenRecord = WriteRecord & { at: string };

/**
 * Thrown when a pending record could not be made, so the write is not made
 * either. A separate class so a caller can tell "nothing was written" from a
 * failure of the write itself.
 */
export class UnrecordedWriteError extends GraphError {
  constructor(message: string) {
    super(message, false);
  }
}

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
    // A pending line is the undo, recorded before the write it protects. If it
    // cannot be kept, the write must not happen — the opposite of a completed
    // write, whose failure to record is swallowed because the write is done.
    if (entry.status === 'pending') {
      throw new UnrecordedWriteError(
        `Nothing was written: the record that would let this change be undone could not ` +
          `be saved first (${err}).`,
      );
    }
    console.warn(
      `[artist-mcp] could not write the audit line for a completed write: ${err}. ` +
        `The event WAS created. Line: ${line}`,
    );
  }
};

/**
 * This install's write log, newest first, optionally only what was written on
 * or after `since`, or only the lines of one write. A line that does not parse
 * is skipped rather than failing the read: the log is appended to by hand-held
 * processes over months, and one torn line must not hide every other record.
 */
export const readWriteLog = async (
  { since, writeId, limit = 200 }: { since?: string; writeId?: string; limit?: number } = {},
): Promise<WrittenRecord[]> => {
  let text: string;
  try {
    text = await readFile(auditPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const lines: WrittenRecord[] = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      const line = JSON.parse(raw) as WrittenRecord;
      if (since !== undefined && line.at < since) continue;
      if (writeId !== undefined && line.write_id !== writeId) continue;
      lines.push(line);
    } catch {
      // Skipped: see above.
    }
  }
  return lines.reverse().slice(0, limit);
};


/**
 * Whether a write log line holds Google data: every Google write this tool can
 * make is a calendar write, and Gmail is read-only here. The hosted migration
 * 20261125120000_forget_google_writes.sql uses the same rule.
 */
export const isGoogleWrite = (operation: string): boolean => operation.includes('calendar');

/**
 * Remove the calendar lines from this install's write log, when Google is
 * disconnected. Google's Workspace AI Tools Addendum, 2(d): nothing obtained
 * through Google is kept after it is disconnected (0022). The only removal from
 * this log, and the person's own: the record was never meant to outrank them.
 *
 * Written to a temporary file and renamed over the log, so a crash leaves the
 * old log or the new one and never half of each. A line that does not parse is
 * kept, since what it held cannot be told. Returns how many lines went.
 */
export const forgetGoogleWrites = async (): Promise<number> => {
  const path = auditPath();
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let removed = 0;
  const kept = text.split('\n').filter((raw) => {
    if (raw.trim() === '') return false;
    try {
      const { operation } = JSON.parse(raw) as { operation?: unknown };
      if (typeof operation === 'string' && isGoogleWrite(operation)) {
        removed++;
        return false;
      }
    } catch {
      // Kept: see above.
    }
    return true;
  });
  if (removed === 0) return 0;
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, kept.map((line) => line + '\n').join(''), 'utf8');
  await rename(temporary, path);
  return removed;
};
