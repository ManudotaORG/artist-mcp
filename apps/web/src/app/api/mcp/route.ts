/**
 * The hosted MCP endpoint — Streamable HTTP, for clients that cannot spawn a
 * local process.
 *
 * This is the de-risking stub described in issue #55, and it is deliberately
 * incomplete: it serves one hardcoded connection, not a user's. What it proves
 * is everything that is not token custody — that the transport negotiates, that
 * Vercel routes it, and that a remote connector completes its handshake against
 * this URL. Those either work or they do not, and finding out costs an hour
 * here versus a day inside the OAuth work.
 *
 * It refuses to exist without ARTIST_MCP_STUB_TOKEN, so a deployment that has
 * not been given one serves 404 rather than an endpoint that half-answers.
 */

import { join } from 'node:path';
import { createServer } from '@manudota/artist-mcp/server';
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
const handle = async (request: Request): Promise<Response> => {
  const token = process.env.ARTIST_MCP_STUB_TOKEN;
  if (!token) return new Response('Not found', { status: 404 });

  // Every operation gets the same token, which is exactly why this is a stub:
  // that token belongs to one provider, so only that provider's tools can
  // work. Notes are Microsoft, and notes are what this is proving.
  const server = await createServer(dispatchWith(async () => token));

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
