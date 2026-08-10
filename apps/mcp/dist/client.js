/**
 * The only network surface this package has.
 *
 * Everything goes through one POST to the edge function, which holds the
 * Microsoft credentials. No Graph call is ever made from this machine, and the
 * connection key is the only secret that lives here.
 */
const DEFAULT_ENDPOINT = "https://zxiemadwrkcoovvpscfb.supabase.co/functions/v1/graph";
/** Overridable for testing; the baked-in default is what shipped copies use. */
export function endpoint() {
    return process.env.ARTIST_MCP_ENDPOINT ?? DEFAULT_ENDPOINT;
}
export class GraphError extends Error {
    reconnectNeeded;
    constructor(message, reconnectNeeded) {
        super(message);
        this.reconnectNeeded = reconnectNeeded;
        this.name = "GraphError";
    }
}
export async function call(op, key, params = {}) {
    let res;
    try {
        res = await fetch(endpoint(), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({ op, ...params }),
        });
    }
    catch (cause) {
        throw new GraphError(`Could not reach the notes service: ${cause}`, false);
    }
    if (res.status === 401 || res.status === 403) {
        throw new GraphError("Reconnect needed — this connection key is no longer valid. " +
            "Sign in to the web app and generate a new one.", true);
    }
    const body = (await res.json().catch(() => ({})));
    if (!res.ok) {
        const detail = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
        throw new GraphError(detail, body.reconnect_needed === true);
    }
    return body;
}
