/**
 * The hosted MCP endpoint — Streamable HTTP, for clients that cannot spawn a
 * local process.
 *
 * Every request is one named user's, resolved from the key it presents, and the
 * dispatcher is built per request around that user. Nothing here is ambient:
 * there is no default account and no way to express "whoever the server is
 * configured for", because that is how one user's request ends up spending
 * another user's token.
 *
 * What this means for the people using it is the sentence issue #55 asks be
 * said plainly — their tokens are held here so this works while their machine
 * is off, and a maintainer can technically reach what those tokens reach. That
 * is why access is issued rather than requested.
 */

import { join } from 'node:path';
import { getSiteUrl } from '@/lib/siteUrl';
import { createServer } from '@manudota/artist-mcp/server';
import { hostedTokens } from '@/lib/hosted-tokens';
import { userForRequest } from '@/lib/mcp-auth';
import { dispatchWith } from '@manudota/artist-mcp/dispatch';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/**
 * The playbook pack ships as data, not as imports, so nothing in the module
 * graph pulls it in and the bundled route sits nowhere near it. next.config
 * traces it in; this says where it landed. Set before any tool runs, and only
 * if the environment has not already said otherwise.
 */
process.env.ARTIST_MCP_PACK_ROOT ??= join(process.cwd(), '..', 'mcp', 'agent-pack');

// The tools reach Microsoft and Google over the network and read real notes;
// nothing here is static, and pdf.js in the attachment path needs a real
// runtime rather than the edge one.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Stateless, one transport per request.
 *
 * A session-bearing transport would have to survive between requests, and on
 * Vercel the instance that opened a session is not the instance that receives
 * the next call. Sessions there mean shared storage, which is real work and
 * buys nothing this stub is trying to learn. Stateless is what the platform
 * actually supports, so it is what is proven.
 */
const unauthorized = () =>
  new Response(JSON.stringify({ error: 'A connection key is required.' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      // The pointer is the whole message. A client that cannot set a header
      // reads this, fetches the metadata, and discovers where to send someone
      // to sign in. Without it the 401 is a dead end — which is exactly what
      // ChatGPT hit before this existed.
      'www-authenticate': `Bearer realm="artist-mcp", resource_metadata="${getSiteUrl()}/.well-known/oauth-protected-resource"`,
    },
  });

const handle = async (request: Request): Promise<Response> => {
  const userId = await userForRequest(request);
  // Before the transport, so an unauthenticated caller learns nothing about
  // the server: not its name, not its version, not which tools it has.
  if (userId === null) return unauthorized();

  const server = await createServer(dispatchWith(hostedTokens(userId)));

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Undefined disables session management. Not an oversight — see above.
    sessionIdGenerator: undefined,
    // Vercel buffers streamed responses from serverless functions, so SSE buys
    // nothing here and plain JSON is easier to debug with curl.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    // The instance may be reused for an unrelated request, so the server does
    // not outlive the call that created it.
    await transport.close();
  }
};

export { handle as GET, handle as POST, handle as DELETE };
