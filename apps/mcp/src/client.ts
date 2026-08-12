/**
 * The only network surface this package has.
 *
 * Everything goes through one POST to the edge function, which holds the
 * Microsoft credentials. No Graph call is ever made from this machine, and the
 * connection key is the only secret that lives here.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../package.json') as { version: string };

const PRODUCTION_ENDPOINT = 'https://zxiemadwrkcoovvpscfb.supabase.co/functions/v1/graph';
const STAGING_ENDPOINT = 'https://cakkwvxwlkdfzqjbvrpa.supabase.co/functions/v1/graph';

const defaultEndpoint = (version: string): string => {
  return version.includes('-staging.') ? STAGING_ENDPOINT : PRODUCTION_ENDPOINT;
};

/** Overridable for development; shipped copies select the service matching their npm version. */
export const endpoint = (): string => {
  return process.env.ARTIST_MCP_ENDPOINT ?? defaultEndpoint(packageVersion);
};

export { defaultEndpoint };

export type Operation = 'list_notes' | 'read_note' | 'verify';

export class GraphError extends Error {
  constructor(
    message: string,
    readonly reconnectNeeded: boolean,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export const call = async <T>(
  op: Operation,
  key: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ op, ...params }),
    });
  } catch (cause) {
    throw new GraphError(`Could not reach the notes service: ${cause}`, false);
  }

  if (res.status === 401 || res.status === 403) {
    throw new GraphError(
      'Reconnect needed — this connection key is no longer valid. ' +
        'Sign in to the web app and generate a new one.',
      true,
    );
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const detail = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new GraphError(detail, body.reconnect_needed === true);
  }

  return body as T;
};
