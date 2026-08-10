# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately via GitHub's [private vulnerability reporting](https://github.com/Manudota/artist-mcp/security/advisories/new) (Security → Report a vulnerability).

Please **do not** open a public issue or otherwise disclose the vulnerability publicly until it has been addressed. This project handles Microsoft OAuth refresh tokens and per-user connection keys, so a public disclosure before a fix puts real user data at risk.

You can expect an acknowledgement within a few days.

## Scope

- The web app (`apps/web`) and its Microsoft OAuth flow
- The Supabase edge function and its row-level security policies
- The published npm package (`apps/mcp`), including the `init` installer

If you believe a connection key or refresh token has been exposed, report it through the same channel — keys are revocable from the web app.
