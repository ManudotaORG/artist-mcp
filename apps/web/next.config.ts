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

  /** The pack is data, not imports, so nothing in the graph would pull it in. */
  outputFileTracingIncludes: {
    '/api/mcp': ['../mcp/agent-pack/**/*', '../mcp/dist/**/*'],
  },
};

export default nextConfig;
