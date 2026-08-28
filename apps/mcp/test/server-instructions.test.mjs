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
const initialize = async (args = []) => {
  const server = spawn(process.execPath, [entry, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
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

/**
 * A client asked "what can you do?" answers from the tool list without calling
 * anything, so neither a tool description nor the briefing can reach it. A
 * Claude Desktop session did exactly that and described this server as
 * read-only after a write had been granted — stating a boundary wrongly about
 * itself, which is worse than stating it weakly.
 *
 * This is not the rules copy the test above guards against. It is derived from
 * the grant at startup, so it cannot claim something the install is not.
 */
test('an ungranted install says in the handshake that it can only read', async () => {
  const { instructions } = await initialize();
  assert.match(instructions, /can only read/);
  assert.match(instructions, /never offer to/);
});

test('a granted install names its writes in the handshake', async () => {
  const { instructions } = await initialize(['--allow-writes', 'calendar-create,calendar-delete']);
  assert.match(instructions, /calendar-create/);
  assert.match(instructions, /calendar-delete/);
  // The sentence that stops the observed failure recurring.
  assert.match(instructions, /Never describe this server as read-only/);
  assert.doesNotMatch(instructions, /can only read/);
});

/**
 * The handshake used to say "Everything else is read-only, including all of
 * OneNote" for any grant, which was true of every capability that existed
 * before onenote-create and became the opposite of the truth with it. A server
 * stating a boundary wrongly about itself is worse than one stating it weakly.
 */
test('a OneNote grant stops the handshake calling OneNote read-only', async () => {
  const { instructions } = await initialize(['--allow-writes', 'onenote-create']);
  assert.match(instructions, /onenote-create/);
  assert.doesNotMatch(instructions, /read-only, including all of OneNote/);
  // What it says instead has to be the actual shape of the permission.
  assert.match(instructions, /cannot change or delete any page/);
});

test('a calendar-only grant still says all of OneNote is read-only', async () => {
  const { instructions } = await initialize(['--allow-writes', 'calendar-create']);
  assert.match(instructions, /read-only, including all of OneNote/);
});

/**
 * The derived line grows with each capability, so it needs its own ceiling
 * rather than borrowing the rules-drift one — and it still needs a ceiling, or
 * a fourth capability turns the handshake into a document nobody reads.
 */
test('the capability line stays a sentence, not a document', async () => {
  const { instructions } = await initialize([
    '--allow-writes',
    'calendar-create,calendar-delete,onenote-create',
  ]);
  assert.ok(
    instructions.length < 1500,
    `instructions are ${instructions.length} chars with two grants; the capability ` +
      'line is turning into prose. Shorten the descriptions in WRITE_CAPABILITIES.',
  );
});
