import { SCOPE, issuer, json } from '@/lib/oauth';

/**
 * RFC 9728: what a client should do when this resource refuses it.
 *
 * This is the document the 401 from /api/mcp points at. Without it a client
 * receives "unauthorized", has nowhere to go, and the connector simply fails —
 * which is what our first bearer-only 401 did.
 */
export const dynamic = 'force-dynamic';

export const GET = async (): Promise<Response> => {
  const base = issuer();
  return json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
  });
};
