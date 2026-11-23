import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * The service-role client: the one credential here that reads every hosted
 * user's rows, bypassing RLS by design.
 *
 * Built in this file and nowhere else, so where it is used is one search, and
 * `scripts/hosted-custody.test.mjs` fails if another file reads
 * `SUPABASE_SERVICE_ROLE_KEY`. It used to be constructed in six places that
 * disagreed about a missing key — one threw, one returned null, one passed an
 * empty string and let the request fail later. Missing or empty now throws,
 * here, and a caller that must fail closed rather than loudly (an unauthenticated
 * request, say) catches it.
 *
 * `server-only` is the other half: importing this from a client component fails
 * the build, which makes every module that uses it server-only too.
 *
 * Built per call rather than cached. It holds no session, and a module-scope
 * client would be constructed during the build's page-data collection, where
 * the key is absent (see "Lazily Instantiate SDK Clients" in AGENTS.md).
 */
export const supabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error('Supabase service-role credentials are not configured on this deployment.');
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};
