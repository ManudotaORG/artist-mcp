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
 * The tool list as the client receives it, for the descriptions that carry a
 * rule. `initialize` alone cannot see these, and they are where the playbook
 * gate has to survive.
 */
const toolList = async (args = []) => {
  const server = spawn(process.execPath, [entry, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const send = (message) => server.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    });
    let buffered = '';
    for await (const chunk of server.stdout) {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        }
        if (message.id === 2) {
          return new Map(message.result.tools.map((tool) => [tool.name, tool.description ?? '']));
        }
      }
    }
    throw new Error('The server closed without answering tools/list.');
  } finally {
    server.kill();
  }
};

/**
 * A client with no repository — Claude Desktop, which is what `init` configures
 * — sees `AGENTS.md` never, so the handshake is where the pack is announced.
 *
 * This asserts that the server SENDS it, and that is all it can assert. It said
 * "the only place the pack can be announced" until #99, which read as more than
 * it proved: Claude Desktop does not deliver this field to the model at all — a
 * live session asked to quote it back reported the tool list and no preamble.
 * Claude Code does deliver it verbatim, which is why the field stays. The
 * channel that reaches a Desktop session is guarded further down this file.
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

/**
 * The channel that actually reaches a Claude Desktop session.
 *
 * #99: two Desktop sessions answered about the user's notes with no playbook
 * loaded, because the handshake instruction never arrived. A tool description
 * does arrive — `preview_calendar_event`'s refusal clause sits roughly 650
 * characters into its description and a Desktop session acted on it — so the
 * gate lives on the note-reading tools as well as in the handshake.
 *
 * It is asserted at the START of the description because a client may render
 * the tool list clipped to a single line, and because the opening is what is
 * read most often.
 *
 * All three entry points carry it, because any of them can be the first touch:
 * a session may triage a notebook with map_notes before listing anything, and
 * an id remembered from earlier reaches read_note without list_notes.
 */
for (const name of ['list_notes', 'map_notes', 'read_note']) {
  test(`${name} tells the session to load the playbooks first`, async () => {
    const description = (await toolList()).get(name);
    assert.ok(description, `${name} is not in the tool list`);
    // Anchored to the start, and to the imperative. Naming the tool is not
    // enough — a description that merely mentions `list_agent_workflows`
    // somewhere is what this file already had, and it is what #99 is about.
    assert.match(
      description,
      /^Call `list_agent_workflows` first/,
      `${name} must OPEN by telling the session to load the playbooks, or the ` +
        'rule does not survive a client that clips the tool list to one line',
    );
    // "In force", not "available to consult": the same distinction as above.
    assert.match(description, /no policy is in force/);
  });
}
