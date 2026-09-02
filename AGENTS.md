# Agent instructions

Read the closest `AGENTS.md` to the code you are changing. This file is the
repository root and deliberately holds almost nothing: the two apps have little
in common beyond the language.

- `apps/web` — Next.js, Tailwind, shadcn/ui. Its conventions and the warning that
  this is not the Next.js you remember are in
  [apps/web/AGENTS.md](apps/web/AGENTS.md). Read it before editing anything there.
- `apps/mcp` — a Node stdio MCP server and install CLI. No React, no Tailwind, no
  bundler. It must not import from other workspace packages, because it ships to
  npm standalone.

Project scope, the constraints that matter, and the things that bite are in
[CLAUDE.md](CLAUDE.md). The build and verification record is
[docs/scope.md](docs/scope.md).
