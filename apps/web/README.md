# artist-mcp web app

The Next.js app handles Supabase magic-link sign-in, the install instructions,
one small public endpoint, and — since
[#55](https://github.com/ManudotaORG/artist-mcp/issues/55) — the hosted MCP: a
remote MCP server, an OAuth authorization server for clients that can only
speak OAuth, and the pages where a hosted user connects their own accounts.

It therefore holds credentials that can read a **hosted** user's account: the
service role and the token encryption key. It holds nothing belonging to a user
of the published package, whose tokens stay on their own machine
([#22](https://github.com/ManudotaORG/artist-mcp/issues/22)). Those are two
custody models and this app is on both sides of the line, which is worth
remembering before writing a sentence about either.

## Run locally

From the repository root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Fill in `.env.local`, then open
[http://localhost:3000](http://localhost:3000).

Connecting a hosted account needs web OAuth clients — separate registrations
from the package's desktop ones — and their redirect URIs are already
registered for production, staging and `http://localhost:3000`. Without
`ARTIST_MCP_WEB_*` set, connecting is refused with a message saying so rather
than half-attempted.

## Routes

- `/` — install instructions when signed out; for a hosted account, what is
  connected, connect and disconnect, and the connector URL.
- `/sign-in` — magic-link sign-in. Reachable and unlinked: signup is closed, so
  a form on the landing page would refuse every visitor.
- `/auth/confirm` — Supabase magic-link confirmation. Takes a `next` parameter,
  restricted to same-site paths, so an authorization request survives sign-in.
- `/api/client-config` — serves Google's Desktop client id and secret, openly.
- `/api/mcp` — the hosted MCP server. Streamable HTTP, stateless, one transport
  per request. Accepts a maintainer-issued key or an OAuth token.
- `/api/auth/[provider]` and `/api/auth/[provider]/callback` — connect a
  provider to a hosted account.
- `/oauth/authorize`, `/api/oauth/token`, `/api/oauth/register` — the OAuth 2.1
  authorization server, with dynamic client registration because ChatGPT
  registers a redirect URI unique to each connector instance.
- `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server` — discovery, served through
  rewrites because Next will not route a directory whose name starts with a
  dot.

That endpoint looks wrong and is not. Google refuses the token exchange for a
Desktop client without a secret, and the client types needing none cannot use a
loopback redirect. Every install needs the value, so gating it would only make it
harder to reach without making it private; PKCE is what makes publishing it
harmless. Without `GOOGLE_DESKTOP_CLIENT_SECRET` set, it returns 503 and
`artist-mcp connect google` cannot complete.

## Security boundaries

- Only public Supabase values use `NEXT_PUBLIC_`. Note that
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` is read server-side only here — nothing calls
  `createBrowserClient` — so despite the prefix it is not inlined into the
  browser bundle.
- This app **can** read a hosted user's notes and mail: it holds the service
  role and the encryption key, and that is what hosted custody means. It cannot
  read anything belonging to a user of the published package.
- The service role is used only where RLS cannot apply — acting for a user who
  holds no browser session. Anything scoped to the signed-in user goes through
  their own session instead, so it cannot be aimed at another account.
- Custody functions are revoked from `public`, `anon` **and** `authenticated`.
  Two different grants look alike here; revoking one leaves the function
  callable.
- Secrets are stored as sha256 — connection keys, OAuth codes, OAuth tokens —
  so a database dump yields nothing that can be presented.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable Supabase key. Read server-side only, despite the prefix |
| `NEXT_PUBLIC_SITE_URL` | Absolute base for magic-link redirects, OAuth discovery and provider callbacks |
| `GOOGLE_DESKTOP_CLIENT_SECRET` | Served by `/api/client-config` |
| `DEPLOY_ENV` | Set to `staging` to show staging deployment metadata |
| `SUPABASE_SERVICE_ROLE_KEY` | Hosted MCP. Reads a connection for a user holding no browser session |
| `TOKEN_ENCRYPTION_KEY` | Hosted MCP. pgcrypto key, different per environment, unrecoverable if lost |
| `ARTIST_MCP_WEB_MS_CLIENT_ID` / `_SECRET` | Web OAuth client for connecting Microsoft. The id is the **same registration** the published package uses — see `docs/operations.md` |
| `ARTIST_MCP_WEB_GOOGLE_CLIENT_ID` / `_SECRET` | Web OAuth client for connecting Google |

Unset, the hosted parts refuse rather than half-work: `/api/mcp` cannot resolve
a user, and connecting says it is not configured on this deployment.

`src/lib/crypto.ts` survives from the earlier hosted design and is imported
nowhere — encryption now happens in the database through `set_connection`, so
it is cleanup rather than a considered bet. It is not part of any live
path.

See the repository [development guide](../../docs/development.md) for complete
environment documentation and [operations guide](../../docs/operations.md) for
deployment and credential rotation.
