import 'server-only';

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Who a hosted request is acting for.
 *
 * A bearer key rather than OAuth, deliberately. Hosted access is a handful of
 * named people who were told what server-side custody means and agreed to it,
 * and a key issued by a maintainer expresses that better than a consent screen
 * anyone can complete. OAuth is what a client like ChatGPT would prefer to
 * negotiate on its own, and remains the thing to build if this ever stops being
 * a handful of people.
 *
 * The key is compared by hash, never by value: the database holds sha256 and
 * nothing that could be presented to this endpoint.
 */

const BEARER = /^Bearer (.+)$/i;

export const userForRequest = async (request: Request): Promise<string | null> => {
  const header = request.headers.get('authorization');
  if (header === null) return null;

  const match = BEARER.exec(header.trim());
  if (match === null) return null;

  const key = match[1].trim();
  if (key === '') return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || secret === undefined) return null;

  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Hashing here means a wrong key never travels further than this function,
  // and the lookup is by exact hash — there is no comparison to get wrong.
  const { data, error } = await db.rpc('resolve_mcp_key', {
    p_key_hash: createHash('sha256').update(key).digest('hex'),
  });

  // A failure to reach the database is not an authenticated request. Treating
  // it as one to be helpful would make an outage into an authentication bypass.
  if (error) return null;

  return (data as string | null) ?? null;
};
