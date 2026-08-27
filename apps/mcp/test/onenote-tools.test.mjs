import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entry = resolve(fileURLToPath(new URL('../dist/index.js', import.meta.url)));

/**
 * Ask a real server what tools it has, over stdio.
 *
 * Registration is the boundary, not refusal at call time: a tool that exists is
 * a tool a model will try, and a refusal inside a tool result reads as an
 * obstacle to route around rather than as a boundary. So the assertion has to
 * be about what `tools/list` returns, which means driving the real handshake.
 */
const listTools = async (args = []) => {
  const server = spawn(process.execPath, [entry, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const send = (msg) => server.stdin.write(`${JSON.stringify(msg)}\n`);
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
    let asked = false;
    for await (const chunk of server.stdout) {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1 && !asked) {
          asked = true;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        }
        if (message.id === 2) return message.result.tools.map((t) => t.name);
      }
    }
    throw new Error('The server closed without listing its tools.');
  } finally {
    server.kill();
  }
};

const ONENOTE_WRITE_TOOLS = ['preview_onenote_page', 'create_onenote_page'];

test('an ungranted install has no OneNote write tool at all', async () => {
  const tools = await listTools();
  for (const name of ONENOTE_WRITE_TOOLS) {
    assert.ok(!tools.includes(name), `${name} exists without a grant`);
  }
  // The reads are unaffected: this is a capability being absent, not OneNote.
  assert.ok(tools.includes('read_note'));
});

/**
 * A calendar grant must not carry a OneNote one. The grant string is the
 * consent moment, and a second write tool arriving already granted is exactly
 * what naming capabilities individually is meant to prevent.
 */
test('a calendar grant does not bring the OneNote tools with it', async () => {
  const tools = await listTools(['--allow-writes', 'calendar-create,calendar-delete']);
  for (const name of ONENOTE_WRITE_TOOLS) {
    assert.ok(!tools.includes(name), `${name} came with a calendar grant`);
  }
  assert.ok(tools.includes('create_calendar_event'));
});

test('the granted install has both halves, since neither works alone', async () => {
  const tools = await listTools(['--allow-writes', 'onenote-create']);
  for (const name of ONENOTE_WRITE_TOOLS) assert.ok(tools.includes(name), `${name} is missing`);
  // And nothing else came with it: the calendar is a separate consent.
  assert.ok(!tools.includes('create_calendar_event'));
  assert.ok(!tools.includes('delete_calendar_event'));
});

/**
 * There is no edit or delete tool to register, and there should never be one
 * without a decision record. Asserted by name so that adding one is a test
 * failure rather than a quiet expansion of what this install can do.
 */
test('no OneNote tool edits or deletes, under any grant', async () => {
  const tools = await listTools([
    '--allow-writes',
    'onenote-create,calendar-create,calendar-delete',
  ]);
  const forbidden = tools.filter(
    (name) => /onenote/i.test(name) && /(edit|update|patch|delete|append|replace)/i.test(name),
  );
  assert.deepEqual(
    forbidden,
    [],
    `A OneNote tool that modifies a page exists: ${forbidden.join(', ')}. ` +
      'Notes.Create cannot express that — see docs/decisions/0003-onenote-writes.md.',
  );
});
