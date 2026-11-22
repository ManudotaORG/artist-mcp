/**
 * Where a hosted write is recorded.
 *
 * Bound to one user, like `hostedTokens`, so a dispatcher built from it cannot
 * record against another account even by mistake — there is no argument that
 * would express it.
 */

import { createClient } from '@supabase/supabase-js';
import { UnrecordedWriteError } from '@manudota/artist-mcp/audit';
import type { RecordWrite, WrittenRecord } from '@manudota/artist-mcp/audit';

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(`${name} is not set on this deployment.`);
  return value;
};

const admin = () =>
  createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const hostedAudit =
  (userId: string): RecordWrite =>
  async (entry) => {
    // Swallowed deliberately, exactly as the local sink does. The event exists
    // in the calendar by the time this runs, and throwing would report a
    // successful write as a failure — the one outcome guaranteed to make
    // someone create it a second time. Logged instead, where it is at least
    // recoverable from the platform's own logs.
    try {
      const { error } = await admin().rpc('record_write', {
        p_user_id: userId,
        p_operation: entry.operation,
        p_summary: entry.summary,
        p_target: entry.target,
        p_source_page: entry.source_page ?? null,
        // The only copy of what a replaced element said. Dropping it here
        // would leave the hosted service accepting a destructive OneNote edit
        // and discarding its undo — not a weaker recovery than the local one,
        // but none. See docs/decisions/0004-onenote-page-maintenance.md.
        p_pre_image: entry.pre_image ?? null,
        // Two-phase recording (0018): absent on writes recorded the old way.
        p_write_id: entry.write_id ?? null,
        p_status: entry.status ?? null,
        p_wrote: entry.wrote ?? null,
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      // A pending row is the undo, recorded before the write it protects. If it
      // cannot be kept, the write must not happen — the same rule as the local
      // sink, and the opposite of a completed write, whose failure to record is
      // swallowed below because the write is already done.
      if (entry.status === 'pending') {
        throw new UnrecordedWriteError(
          `Nothing was written: the record that would let this change be undone could not ` +
            `be saved first (${err instanceof Error ? err.message : String(err)}).`,
        );
      }
      console.error(
        `[artist-mcp] the write for ${userId} succeeded but was not recorded: ${err}. ` +
          `Entry: ${JSON.stringify(entry)}`,
      );
    }
  };

/**
 * One user's write log, newest first: what an undo reads (0018). Bound to one
 * user the same way `hostedAudit` is, so a reader built for one account cannot
 * read another's — there is no argument that would express it.
 */
export const hostedWriteLog =
  (userId: string) =>
  async ({
    since,
    writeId,
    limit,
  }: { since?: string; writeId?: string; limit?: number } = {}): Promise<WrittenRecord[]> => {
    const { data, error } = await admin().rpc('writes_for', {
      p_user_id: userId,
      p_since: since ?? null,
      p_write_id: writeId ?? null,
      p_limit: limit ?? 200,
    });
    if (error) throw new Error(`The write log could not be read: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      at: String(row.at),
      operation: String(row.operation),
      summary: String(row.summary),
      target: String(row.target),
      source_page: (row.source_page as string | null) ?? null,
      pre_image: (row.pre_image as string | null) ?? null,
      ...(row.write_id ? { write_id: String(row.write_id) } : {}),
      ...(row.status === 'pending' || row.status === 'done' ? { status: row.status } : {}),
      wrote: (row.wrote as string | null) ?? null,
    }));
  };
