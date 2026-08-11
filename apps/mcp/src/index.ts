#!/usr/bin/env node

import { runInit, runUninstall } from './init.js';
import { runServer } from './server.js';
import { installAgentPack } from './agents.js';

const mode = process.argv[2];

try {
  switch (mode) {
    case undefined:
      await runServer();
      break;
    case 'init':
      await runInit();
      break;
    case 'uninstall':
      await runUninstall();
      break;
    case 'agents':
      if (process.argv[3] !== 'install') {
        throw new Error('Usage: artist-mcp agents install [directory]');
      }
      await installAgentPack(process.argv[4]);
      break;
    default:
      console.error(
        `Unknown command "${mode}".\n\n` +
          '  artist-mcp            run the MCP server over stdio\n' +
          '  artist-mcp init       connect this machine to your notes\n' +
          '  artist-mcp agents install [directory]\n' +
          '                       install the notes-analysis agent pack\n' +
          '  artist-mcp uninstall  remove the Claude Desktop entry\n',
      );
      process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
