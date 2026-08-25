/**
 * Which writes a hosted user has opted into.
 *
 * Read per request and handed to `createServer`, never held in module state:
 * one process serves many users here, and a grant stashed between requests
 * would let one user's capability reach another's session. See
 * docs/decisions/0002-hosted-writes.md.
 */

import { createClient } from '@supabase/supabase-js';
import { WRITE_CAPABILITIES, type WriteCapability } from '@manudota/artist-mcp/grants';

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

const known = (value: unknown): value is WriteCapability =>
  typeof value === 'string' && Object.keys(WRITE_CAPABILITIES).includes(value);

/**
 * The capabilities this user opted into, or none.
 *
 * A failure to read is **not** treated as a grant. Any error here — an
 * unreachable database, a missing function, a renamed capability — must land on
 * the read-only side, because the alternative is a fault deciding that someone
 * may write to a calendar. Rows naming a capability this build no longer has
 * are dropped for the same reason.
 */
export const writeGrantsFor = async (userId: string): Promise<WriteCapability[]> => {
  try {
    const { data, error } = await admin().rpc('write_grants_for', { p_user_id: userId });
    if (error) {
      console.error(`[artist-mcp] could not read write grants for ${userId}: ${error.message}`);
      return [];
    }
    return Array.isArray(data) ? data.filter(known) : [];
  } catch (err) {
    console.error(`[artist-mcp] could not read write grants for ${userId}: ${err}`);
    return [];
  }
};
