# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately via GitHub's [private vulnerability reporting](https://github.com/Manudota/artist-mcp/security/advisories/new) (Security → Report a vulnerability).

Please **do not** open a public issue or otherwise disclose the vulnerability publicly until it has been addressed. This project handles Microsoft OAuth refresh tokens and per-user connection keys, so a public disclosure before a fix puts real user data at risk.

You can expect an acknowledgement within a few days.

## Scope

- The web app (`apps/web`) and its Microsoft and Google OAuth flows
- The Supabase edge function and its row-level security policies
- The published npm package (`apps/mcp`), including the `init` installer

## Known, and not a vulnerability

The production service role can resolve any connection key and use the stored
credential behind it, so an operator holding that credential can technically
reach connected account data. This is inherent to refreshing tokens while the
user is absent, and encryption at rest is not a control against it. It is
described on the front page of the README and tracked as hardening work in
[#22](https://github.com/ManudotaORG/artist-mcp/issues/22) — please do not file
it as a vulnerability. A report that operator access exists tells us nothing we
have not already published; a report that it can be reached *without* that
credential is exactly what we want to hear about.

If you believe a connection key or refresh token has been exposed, report it through the same channel — keys are revocable from the web app.
