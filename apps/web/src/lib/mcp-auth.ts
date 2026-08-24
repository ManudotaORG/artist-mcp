import 'server-only';

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Who a hosted request is acting for.
 *
 * Two credentials are accepted, for two kinds of client.
 *
 * A maintainer-issued key suits anything that can set a header — the local
 * package, curl, a script — and expresses the arrangement well: hosted access
 * is a handful of named people who were told what server-side custody means.
 *
 * An OAuth token exists because ChatGPT cannot send a header at all. Its
 * connector settings are OAuth, none, or mixed, and "none" would put a URL that
 * reads someone's mail on the open internet. Both resolve to a user id and
 * nothing downstream can tell which was used, which is the point: there is one
 * notion of who a request is for.
 *
 * Either way the secret is compared by hash. The database holds sha256 and
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

  // Hashing here means a wrong secret never travels further than this function,
  // and the lookup is by exact hash — there is no comparison to get wrong.
  const digest = createHash('sha256').update(key).digest('hex');

  // OAuth first, because it is what the connector clients use and so what most
  // requests will carry. The order is a guess about traffic, not about trust —
  // both are checked, and a value that is neither is simply not authenticated.
  const oauth = await db.rpc('resolve_oauth_token', { p_token_hash: digest });
  if (!oauth.error && oauth.data) return oauth.data as string;

  const issued = await db.rpc('resolve_mcp_key', { p_key_hash: digest });

  // A failure to reach the database is not an authenticated request. Treating
  // it as one to be helpful would make an outage into an authentication bypass.
  if (issued.error) return null;

  return (issued.data as string | null) ?? null;
};
