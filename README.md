# artist-mcp

A multi-tenant web app that connects a user's Microsoft account, plus a Claude MCP server — published to npm — that reads that user's OneDrive notes.

See [CLAUDE.md](CLAUDE.md) for the full build brief and current status.

## Core Technologies

- Turborepo + pnpm workspaces
- `apps/web` — Next.js (App Router), Tailwind, shadcn/ui
- `apps/mcp` — Node MCP server + install CLI, published to npm
- `supabase/` — Postgres, RLS, edge functions
- Microsoft Graph (OneDrive)

## Prerequisites

- Node 22 (see [.nvmrc](.nvmrc))
- pnpm (`corepack enable`)
- A Supabase project and a Microsoft Entra ID app registration — setup steps in [CLAUDE.md](CLAUDE.md)

## Getting Started

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `apps/web/.env.local` and fill in the values before running.

## Installation (MCP server)

```bash
npx @yourscope/artist-mcp init
```

Paste the connection key from the web app, then restart Claude Desktop.

## License

MIT — see [LICENCE.md](LICENCE.md).

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md). Please do not open public issues for vulnerabilities.

## Support

Open an issue in this repository.
