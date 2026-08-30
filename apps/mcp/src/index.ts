#!/usr/bin/env node

import { runInit, runUninstall } from './init.js';
import { runServer } from './server.js';
import { installAgentPack, runAgentsStatus, setLocalAgentRoot } from './agents.js';
import { runConnect, runDisconnect, runReconnect, runStatus } from './connect.js';
import { isWriteCapability, parseGrants } from './grants.js';

const argv = process.argv.slice(2);

/**
 * Pull an option and its value out of the arguments wherever they appear.
 *
 * Removing them before the positional arguments are read keeps each command's
 * own shape intact. Returns `undefined` when absent, and `''` when the flag was
 * given with no value — which `init --editable` reads as "the default
 * directory", so `--editable` alone is a complete instruction.
 */
const takeOption = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const [value] = argv.splice(index, 2).slice(1);
  if (value === undefined || value.startsWith('-')) {
    if (value !== undefined) argv.splice(index, 0, value);
    return '';
  }
  return value;
};

/** The commands, so a flag missing its value cannot swallow one. */
const COMMANDS = ['init', 'connect', 'disconnect', 'reconnect', 'status', 'uninstall', 'agents'];

// Parsed inside the error handler below: a bad flag is a user error like any
// other, and it printed a stack trace when it threw at module scope.
let mode: string | undefined;

try {
  // `--agents` is what init writes into the Claude Desktop entry and what the
  // server reads back; `--editable` is the install-time flag a person types.
  const agentsDir = takeOption('--agents');
  const editableDir = takeOption('--editable');
  // Parsed here, inside the error handler, so an unknown capability is a
  // one-line user error rather than a stack trace. Refused by name: a typo that
  // silently granted nothing would be diagnosed as a missing tool.
  //
  // `takeOption` takes the next token as the value, so `--allow-writes status`
  // eats the command and reports the command as an unknown capability, which
  // sends someone reading it to entirely the wrong place. A command name is
  // never a capability, so it is handed back and the flag is left empty — which
  // is itself refused, with the message that fits what happened.
  let writes = takeOption('--allow-writes');
  if (writes !== undefined && COMMANDS.includes(writes)) {
    argv.unshift(writes);
    writes = '';
  }
  // The same Windows mangling in its other shape. Depending on the shell, a
  // comma-separated value arrives either as one string with spaces — handled in
  // parseGrants — or split across separate arguments, where `takeOption` takes
  // only the first and the rest would be read as a command. Capability names
  // are a closed set, so absorbing any that follow is unambiguous.
  if (writes !== undefined && writes !== '') {
    while (argv.length > 0 && isWriteCapability(argv[0])) {
      writes += `,${argv.shift()}`;
    }
  }
  const grants = parseGrants(writes);
  mode = argv[0];

  switch (mode) {
    case undefined:
      // Claude Desktop spawns this with whatever args `init` wrote, which is the
      // only way the server learns where a user's playbooks live: there is no
      // cwd here worth trusting.
      setLocalAgentRoot(agentsDir || undefined);
      // Handed in, not stashed. An ungranted write tool is never built, rather
      // than built and refusing.
      await runServer(grants);
      break;
    case 'init':
      if (argv[1] && argv[1] !== '--local') {
        throw new Error(
          'Usage: artist-mcp init [--local] [--editable [directory]] [--allow-writes <list>]',
        );
      }
      await runInit({ local: argv[1] === '--local', editableDir, grants });
      break;
    case 'connect':
      await runConnect(argv[1]);
      break;
    case 'disconnect':
      await runDisconnect(argv[1]);
      break;
    case 'reconnect':
      await runReconnect();
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
        case 'status':
          // A directory positionally, so checking a pack before installing it
          // does not need a flag as well.
          setLocalAgentRoot(argv[2] ?? agentsDir ?? editableDir ?? undefined);
          await runAgentsStatus();
          break;
        default:
          throw new Error('Usage: artist-mcp agents <install [directory]|status [directory]>');
      }
      break;
    default:
      console.error(
        `Unknown command "${mode}".\n\n` +
          '  artist-mcp            run the MCP server over stdio\n' +
          '  artist-mcp init [--local]\n' +
          '                       connect this machine, with the shipped\n' +
          '                       checksummed playbooks\n' +
          '  artist-mcp init --editable [directory]\n' +
          '                       the same, but with every playbook copied\n' +
          '                       somewhere you can edit them, and add your own\n' +
          '                       (default ~/artist-mcp)\n' +
          '  artist-mcp init --allow-writes calendar-create\n' +
          '                       let this install add single calendar events,\n' +
          '                       after showing you each one. Everything else,\n' +
          '                       including all of OneNote, stays read-only.\n' +
          '                       Reconnect Google afterwards to grant the scope\n' +
          '  artist-mcp connect [microsoft|google]\n' +
          '                       sign in to a provider in your browser\n' +
          '  artist-mcp disconnect [microsoft|google]\n' +
          '                       remove a connection from this machine\n' +
          '  artist-mcp reconnect  sign in again to whatever has lapsed, and\n' +
          '                       nothing else\n' +
          '  artist-mcp status     check this install and what it is connected to\n' +
          '  artist-mcp agents status [directory]\n' +
          '                       show which playbooks are in force\n' +
          '  artist-mcp agents install [directory]\n' +
          '                       write the pack into a project, for a coding agent\n' +
          '  artist-mcp uninstall  remove the Claude Desktop entry\n',
      );
      process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
