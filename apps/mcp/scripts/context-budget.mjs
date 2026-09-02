#!/usr/bin/env node
/**
 * What this server costs a session before the musician has said anything.
 *
 * Two numbers, and they are not the same kind. Tool descriptions sit in context
 * for every request; the briefing is sent once, when list_agent_workflows is
 * called. Both grow by accident — a rule added to a policy is loaded by every
 * session for ever, whether or not it could apply — so this exists to make that
 * visible rather than discovered later.
 *
 * Run: node scripts/context-budget.mjs [--grants a,b]
 */
import { createServer } from '../dist/server.js';
import { WRITE_CAPABILITIES } from '../dist/grants.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * Ask the server for its tool list the way a client does.
 *
 * Reading `description` off the registered tools misses the input schemas,
 * which are almost exactly as large again — 17,277 characters against 17,786
 * when this was written. Measuring the wire payload is the only way to get a
 * number that means anything.
 */
const toolList = async (server) => {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'context-budget', version: '1' }, { capabilities: {} });
  await Promise.all([(server.server ?? server).connect(serverEnd), client.connect(clientEnd)]);
  return (await client.listTools()).tools;
};

const arg = process.argv.indexOf('--grants');
const chosen =
  arg === -1 ? null : (process.argv[arg + 1] ?? '').split(',').filter(Boolean);
const all = Object.keys(WRITE_CAPABILITIES);
const cases = chosen ? [chosen] : [[], ['onenote-edit'], all];

const tokens = (n) => Math.round(n / 4);

for (const grants of cases) {
  const server = await createServer(async () => ({}), grants);
  const tools = await toolList(server);
  const wire = JSON.stringify(tools).length;
  const descriptions = tools.reduce((n, t) => n + (t.description ?? '').length, 0);
  const schemas = tools.reduce((n, t) => n + JSON.stringify(t.inputSchema ?? {}).length, 0);
  const briefing = (
    await server._registeredTools.list_agent_workflows.handler({})
  ).content
    .map((c) => c.text)
    .join('\n').length;

  const label = grants.length ? grants.join(',') : 'no write grants';
  console.log(`\n${label}`);
  console.log(`  ${String(tools.length).padStart(3)} tools`);
  console.log(
    `  ${String(wire).padStart(6)} chars  ~${tokens(wire)} tokens  TOOL LIST, EVERY REQUEST` +
      ` (${descriptions} description, ${schemas} schema)`,
  );
  console.log(
    `  ${String(briefing).padStart(6)} chars  ~${tokens(briefing)} tokens  briefing, once per session`,
  );
  console.log(
    `  the tool list outweighs the whole briefing after ` +
      `${(briefing / wire).toFixed(1)} turns`,
  );
}

// The per-playbook split, which is where the briefing's weight actually is.
const server = await createServer(async () => ({}), all);
const briefing = (
  await server._registeredTools.list_agent_workflows.handler({})
).content
  .map((c) => c.text)
  .join('\n');
const sections = briefing
  .split(/^## (?=[a-z-]+:)/m)
  .slice(1)
  .map((s) => [s.slice(0, s.indexOf('\n')).trim(), s.length])
  .sort((a, b) => b[1] - a[1]);
console.log('\nloaded in full, largest first');
for (const [id, size] of sections) {
  console.log(`  ${String(size).padStart(6)} chars  ~${String(tokens(size)).padStart(5)} tokens  ${id}`);
}
