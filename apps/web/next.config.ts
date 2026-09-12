import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The MCP package is required at runtime rather than bundled.
   *
   * Two things break when webpack tries to bundle it. `agents.ts` locates the
   * playbook pack with `new URL('../agent-pack/', import.meta.url)`, which the
   * bundler reads as an asset reference and cannot resolve; and `unpdf` carries
   * pdf.js, which is a known packaging fight this sidesteps entirely rather
   * than wins. Left external, both resolve from node_modules the way they do
   * on a developer's machine.
   */
  serverExternalPackages: ['@manudota/artist-mcp', 'unpdf'],

  /**
   * Trace from the monorepo root, so the workspace symlink into apps/mcp is
   * followed and the package it points at is actually uploaded. Without this
   * the route resolves locally and 500s in production on a missing module.
   */
  outputFileTracingRoot: join(import.meta.dirname, '../..'),

  /**
   * Discovery lives under /.well-known, which Next cannot route directly — a
   * directory whose name starts with a dot is not a route segment. The handlers
   * live under /api/well-known and are rewritten onto the paths clients look
   * for. RFC 9728 also allows the resource path to be appended, and some
   * clients do that, so both shapes are answered.
   */
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/well-known/oauth-authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/well-known/oauth-authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/well-known/oauth-protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/well-known/oauth-protected-resource',
      },
    ];
  },

  /**
   * The pack is data, not imports, so nothing in the graph would pull it in.
   * `vendor/artist-pack` is the custom pack the route layers on top; left out
   * of the trace it resolves on a developer's machine and throws in
   * production, which is the failure this list already exists to prevent.
   */
  outputFileTracingIncludes: {
    '/api/mcp': ['../mcp/agent-pack/**/*', '../mcp/dist/**/*', '../../vendor/artist-pack/**/*'],
  },
};

export default nextConfig;
