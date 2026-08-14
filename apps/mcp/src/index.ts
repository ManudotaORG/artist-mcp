#!/usr/bin/env node

import { runInit, runUninstall } from './init.js';
import { runServer } from './server.js';
import { installAgentPack } from './agents.js';
import { runConnect, runDisconnect, runStatus } from './connect.js';

const mode = process.argv[2];

try {
  switch (mode) {
    case undefined:
      await runServer();
      break;
    case 'init':
      if (process.argv[3] && process.argv[3] !== '--local') {
        throw new Error('Usage: artist-mcp init [--local]');
      }
      await runInit({ local: process.argv[3] === '--local' });
      break;
    case 'connect':
      await runConnect(process.argv[3]);
      break;
    case 'disconnect':
      await runDisconnect(process.argv[3]);
      break;
    case 'status':
      await runStatus();
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
          '  artist-mcp init [--local]\n' +
          '                       connect this machine to your notes\n' +
          '  artist-mcp connect [microsoft|google]\n' +
          '                       sign in to a provider in your browser\n' +
          '  artist-mcp disconnect [microsoft|google]\n' +
          '                       remove a connection from this machine\n' +
          '  artist-mcp status     show what this machine is connected to\n' +
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
