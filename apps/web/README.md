# artist-mcp web app

The Next.js app handles Supabase magic-link sign-in, the install instructions,
and one small public endpoint. It does **not** perform provider OAuth and holds
no credential that could read a user's account — that moved to the MCP package,
which signs in on the user's own machine and keeps the refresh tokens there. See
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22).

## Run locally

From the repository root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Fill in `.env.local`, then open
[http://localhost:3000](http://localhost:3000).

No Microsoft Entra redirect URI is needed here any more. The MCP package uses a
loopback redirect on the user's machine, which is why it needs no web callback.

## Routes

- `/` — magic-link sign-in and the client installation instructions.
- `/auth/confirm` — Supabase magic-link confirmation.
- `/api/client-config` — serves Google's Desktop client id and secret, openly.

That endpoint looks wrong and is not. Google refuses the token exchange for a
Desktop client without a secret, and the client types needing none cannot use a
loopback redirect. Every install needs the value, so gating it would only make it
harder to reach without making it private; PKCE is what makes publishing it
harmless. Without `GOOGLE_DESKTOP_CLIENT_SECRET` set, it returns 503 and
`artist-mcp connect google` cannot complete.

## Security boundaries

- Only public Supabase values use `NEXT_PUBLIC_`.
- Nothing deployed here can read a user's notes or mail. There is no provider
  refresh token, no service-role credential in use, and no connection key.
- Supabase auth cookies are the only credentials the app handles.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase API key |
| `NEXT_PUBLIC_SITE_URL` | Absolute base for magic-link redirects |
| `GOOGLE_DESKTOP_CLIENT_SECRET` | Served by `/api/client-config` |
| `DEPLOY_ENV` | Set to `staging` to show staging deployment metadata |

`src/lib/crypto.ts` survives from the hosted design and is imported nowhere; it
is kept for the same reason the dormant tables are. It is not part of any live
path.

See the repository [development guide](../../docs/development.md) for complete
environment documentation and [operations guide](../../docs/operations.md) for
deployment and credential rotation.
