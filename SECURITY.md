# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately via GitHub's [private vulnerability reporting](https://github.com/Manudota/artist-mcp/security/advisories/new) (Security → Report a vulnerability).

Please **do not** open a public issue or otherwise disclose the vulnerability publicly until it has been addressed. This project handles Microsoft and Google OAuth refresh tokens on users' own machines, so a public disclosure before a fix puts real user data at risk.

You can expect an acknowledgement within a few days.

## Scope

- The published npm package (`apps/mcp`): the loopback OAuth flow, the token
  store, and the `init` installer
- The web app (`apps/web`), its email sign-in, and the unauthenticated
  `/api/client-config` endpoint

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

Operator access to stored credentials was a real property of the previous hosted
design and is resolved: see
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22). No service here
stores a user's refresh token any more.

If you believe a refresh token has been exposed, report it through the same
channel. A user can revoke this app's access at any time from their Microsoft or
Google account page, which invalidates it everywhere.
