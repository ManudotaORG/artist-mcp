/**
 * Where a hosted write is recorded.
 *
 * Bound to one user, like `hostedTokens`, so a dispatcher built from it cannot
 * record against another account even by mistake — there is no argument that
 * would express it.
 */

import { createClient } from '@supabase/supabase-js';
import type { RecordWrite } from '@manudota/artist-mcp/audit';

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
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error(
        `[artist-mcp] the write for ${userId} succeeded but was not recorded: ${err}. ` +
          `Entry: ${JSON.stringify(entry)}`,
      );
    }
  };
