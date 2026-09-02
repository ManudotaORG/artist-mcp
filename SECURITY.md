# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately via GitHub's [private vulnerability reporting](https://github.com/ManudotaORG/artist-mcp/security/advisories/new) (Security → Report a vulnerability).

Please **do not** open a public issue or otherwise disclose the vulnerability publicly until it has been addressed. This project handles Microsoft and Google OAuth refresh tokens — on users' own machines for the published package, and encrypted at rest in the database for hosted accounts — so a public disclosure before a fix puts real user data at risk.

You can expect an acknowledgement within a few days.

## Scope

- The published npm package (`apps/mcp`): the loopback OAuth flow, the token
  store, the `init` installer, and the write capabilities granted through it
- The web app (`apps/web`), its email sign-in, and the unauthenticated
  `/api/client-config` endpoint
- The hosted MCP server: `/api/mcp`, the OAuth authorization server it is
  reached through (`/oauth/authorize`, `/api/oauth/token`,
  `/api/oauth/register`), the per-user write grants, and the encrypted
  credentials in `connections` and `mcp_keys`

## Known, and not a vulnerability

**The Google client secret served by `/api/client-config` is public.** The
endpoint is deliberately unauthenticated. Google refuses the token exchange for
a Desktop client without a secret, while the client types that need none cannot
use a loopback redirect, so the value has to reach every install. It is not a
secret in any useful sense and is not treated as one.

It also grants nothing. PKCE is enforced by both providers — verified against
their live endpoints, not just their documentation, by
`scripts/spike-pkce.mjs` — so an intercepted authorization code cannot be
redeemed without a verifier that never leaves the machine that began the flow.
A report that this value is readable tells us nothing we have not published. A
report that it can be *used* to obtain someone's tokens is exactly what we want
to hear about.

**Tokens are stored in a `0600` file, not the OS keychain.** A keychain needs a
native dependency the package cannot take, since it must install without a
compiler. Anything running as the user can therefore read
`~/.artist-mcp/tokens.json`. This is documented rather than hidden.

**There are two custody models, and the answer differs between them.** The
published package signs in on the user's own machine and keeps the refresh token
there; no deployed credential of ours can read it, which is what
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22) settled by removing
the mechanism that made operator access possible.

The hosted server is the other model, and operator access is a real property of
it. Acting for someone whose machine is off means holding their credentials:
refresh tokens are stored encrypted in `connections`, with a key the database
never holds, decryptable by the service role. That narrows who can read them
without reducing it to nobody, and hosted users are told exactly that before
they connect. It is a disclosed limit, not a vulnerability — but any way to
reach those credentials *without* the service role and the key is one, and is
exactly what we want to hear about. See "Hosted credential storage" in
[docs/operations.md](docs/operations.md).

If you believe a refresh token has been exposed, report it through the same
channel. A user can revoke this app's access at any time from their Microsoft or
Google account page, which invalidates it everywhere.
