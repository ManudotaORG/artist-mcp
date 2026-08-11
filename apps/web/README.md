# artist-mcp web app

The Next.js app handles Supabase magic-link sign-in, Microsoft OAuth, encrypted
refresh-token storage, and connection-key management.

## Run locally

From the repository root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Complete every value in `.env.local`, then open
[http://localhost:3000](http://localhost:3000).

The Microsoft Entra app must have this Web redirect URI:

```text
http://localhost:3000/api/auth/microsoft/callback
```

## Routes

- `/` — sign-in, Microsoft status, connection keys, and client installation.
- `/auth/confirm` — Supabase magic-link confirmation.
- `/api/auth/microsoft` — starts Microsoft authorization with PKCE and state.
- `/api/auth/microsoft/callback` — validates state, exchanges the code, and
  stores the encrypted refresh token.

## Security boundaries

- Only public Supabase values use `NEXT_PUBLIC_`.
- Microsoft and service-role credentials stay in Server Components, Server
  Actions, and route handlers.
- OAuth state and PKCE verifier values use HTTP-only cookies.
- Microsoft tokens never reach the browser.
- The database stores only a hash of each connection key.

See the repository [development guide](../../docs/development.md) for complete
environment documentation and [operations guide](../../docs/operations.md) for
deployment and credential rotation.
