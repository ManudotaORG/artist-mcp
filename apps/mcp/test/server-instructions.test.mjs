import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entry = resolve(fileURLToPath(new URL('../dist/index.js', import.meta.url)));

/**
 * Drive a real `initialize` over stdio and return its result.
 *
 * This goes over the wire on purpose. The bug it guards against was invisible
 * to every unit test in this suite: the briefing was correct, the policies
 * loaded in full, `renderWorkflowBriefing` was covered — and none of it reached
 * Claude Desktop, because nothing told the client to ask. What was broken was
 * the handshake, so the test has to be the handshake.
 */
const initialize = async () => {
  const server = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    server.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      })}\n`,
    );
    let buffered = '';
    for await (const chunk of server.stdout) {
      buffered += chunk;
      for (const line of buffered.split('\n')) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) return message.result;
      }
    }
    throw new Error('The server closed without answering initialize.');
  } finally {
    server.kill();
  }
};

/**
 * A client with no repository — Claude Desktop, which is what `init` configures
 * — sees `AGENTS.md` never, so the handshake is the only place the pack can be
 * announced. Without it `list_agent_workflows` is a tool nothing calls, and a
 * session answers from tool descriptions with no policy in force at all.
 */
test('the handshake tells the client to load the playbooks', async () => {
  const { instructions } = await initialize();
  assert.ok(instructions, 'initialize returned no instructions');
  assert.match(instructions, /list_agent_workflows/);
  // "In force", not "available to consult": the distinction is the whole bug.
  assert.match(instructions, /in force/);
});

/**
 * The instructions state where the rules are, never what they are. `AGENTS.md`
 * restated the pack for repository clients and drifted from it, so a second
 * restatement here would drift the same way — and this copy cannot be checked
 * against the registry the way a playbook can.
 */
test('the handshake carries no rules of its own', async () => {
  const { instructions } = await initialize();
  assert.ok(
    instructions.length < 1200,
    `instructions are ${instructions.length} chars; they are drifting into a rules copy`,
  );
});
