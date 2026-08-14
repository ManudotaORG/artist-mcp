#!/usr/bin/env node

import { runInit, runUninstall } from './init.js';
import { runServer } from './server.js';
import {
  copyWorkflowForEditing,
  installAgentPack,
  runAgentsStatus,
  setLocalAgentRoot,
} from './agents.js';
import { runConnect, runDisconnect, runStatus } from './connect.js';

const argv = process.argv.slice(2);

/**
 * Pull `--agents <directory>` out of the arguments wherever it appears.
 *
 * Removing it before the positional arguments are read keeps every command's
 * own shape intact — `agents install [directory]` still takes its directory in
 * the same place whether or not the flag was given.
 */
const takeAgentsDir = (): string | undefined => {
  const index = argv.indexOf('--agents');
  if (index === -1) return undefined;
  const [value] = argv.splice(index, 2).slice(1);
  if (!value || value.startsWith('-')) {
    throw new Error('--agents needs a directory, for example: --agents ~/artist-playbooks');
  }
  return value;
};

// Parsed inside the try: a bad flag is a user error like any other, and it
// printed a stack trace when it threw at module scope.
let mode: string | undefined;

try {
  const agentsDir = takeAgentsDir();
  mode = argv[0];

  switch (mode) {
    case undefined:
      // Claude Desktop spawns this with whatever args `init` wrote, which is the
      // only way the server learns where a user's playbooks live: there is no
      // cwd here worth trusting.
      setLocalAgentRoot(agentsDir);
      await runServer();
      break;
    case 'init':
      if (argv[1] && argv[1] !== '--local') {
        throw new Error('Usage: artist-mcp init [--local] [--agents <directory>]');
      }
      await runInit({ local: argv[1] === '--local', agentsDir });
      break;
    case 'connect':
      await runConnect(argv[1]);
      break;
    case 'disconnect':
      await runDisconnect(argv[1]);
      break;
    case 'status':
      await runStatus();
      break;
    case 'uninstall':
      await runUninstall();
      break;
    case 'agents':
      switch (argv[1]) {
        case 'install':
          await installAgentPack(argv[2]);
          break;
        case 'edit':
          if (!argv[2] || !argv[3]) {
            throw new Error('Usage: artist-mcp agents edit <workflow-id> <directory>');
          }
          await copyWorkflowForEditing(argv[2], argv[3]);
          break;
        case 'status':
          setLocalAgentRoot(agentsDir);
          await runAgentsStatus();
          break;
        default:
          throw new Error(
            'Usage: artist-mcp agents <install [directory]|edit <id> <directory>|status>',
          );
      }
      break;
    default:
      console.error(
        `Unknown command "${mode}".\n\n` +
          '  artist-mcp            run the MCP server over stdio\n' +
          '  artist-mcp init [--local] [--agents <directory>]\n' +
          '                       connect this machine to your notes\n' +
          '  artist-mcp connect [microsoft|google]\n' +
          '                       sign in to a provider in your browser\n' +
          '  artist-mcp disconnect [microsoft|google]\n' +
          '                       remove a connection from this machine\n' +
          '  artist-mcp status     show what this machine is connected to\n' +
          '  artist-mcp agents install [directory]\n' +
          '                       install the notes-analysis agent pack\n' +
          '  artist-mcp agents edit <workflow-id> <directory>\n' +
          '                       copy one playbook out to edit it\n' +
          '  artist-mcp agents status [--agents <directory>]\n' +
          '                       show which workflow files are in force\n' +
          '  artist-mcp uninstall  remove the Claude Desktop entry\n',
      );
      process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
