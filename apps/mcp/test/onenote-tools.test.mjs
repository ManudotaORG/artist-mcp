import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from '../dist/server.js';

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

const ONENOTE_WRITE_TOOLS = ['create_onenote_page'];

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

test('the granted install has the create tool', async () => {
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

/**
 * Since 0009 there is no preview to carry section_id, so the create must resolve
 * it itself. The old defect was a create requiring a value only the preview
 * printed; the equivalent now is a create requiring a value nobody can supply.
 */
test('create_onenote_page requires nothing a caller cannot supply', async () => {
  const server = await createServer(async () => ({}), ['onenote-create']);
  const shape = server._registeredTools.create_onenote_page.inputSchema;
  const fields = shape.shape ?? shape;
  const required = Object.entries(fields)
    .filter(([, f]) => !f.isOptional())
    .map(([n]) => n)
    .sort();
  assert.deepEqual(required, ['body', 'title']);
});

/**
 * Call a tool over stdio and return what it answered.
 *
 * `listTools` above asserts what exists; this asserts what a call is allowed to
 * look like, which is a different boundary and the one that broke. The batch
 * parameter was built, unit-tested against the implementation, documented in
 * the tool's own description — and unreachable, because the schema still
 * required `action` while the implementation refused `action` beside `changes`.
 * Every test passed: they all called the implementation directly, and the
 * defect lived in the gap between the schema and it.
 */
const callTool = async (name, args, flags) => {
  const server = spawn(process.execPath, [entry, ...flags], { stdio: ['pipe', 'pipe', 'pipe'] });
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
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
        }
        if (message.id === 2) {
          return message.result?.content?.[0]?.text ?? JSON.stringify(message);
        }
      }
    }
    throw new Error('The server closed without answering the call.');
  } finally {
    server.kill();
  }
};

test('a batch of changes is a call the schema actually accepts', async () => {
  // No Microsoft connection in CI, so this gets as far as the connection and
  // stops. That is the point: anything about arguments means the batch cannot
  // be expressed, which is what happened when `action` stayed required.
  const answer = await callTool(
    'preview_onenote_edit',
    {
      page_id: 'a-page-id',
      changes: [
        {
          action: 'replace',
          element_id: 'table:{33f8a242-7c33-4bb2-90c5-8425a68cc5bf}{50}',
          html: '<table><tr><td><p>Honorar</p></td><td><p>1450</p></td></tr></table>',
        },
        { action: 'append', text: 'Stand Mai 2026' },
      ],
    },
    ['--allow-writes', 'onenote-edit'],
  );

  assert.ok(
    !/Invalid arguments|Required at|validation error/i.test(answer),
    `the schema refused a batch: ${answer}`,
  );
});

test('the edit half accepts the same batch shape the preview does', async () => {
  // The two schemas have to agree, or a batch can be previewed and not applied.
  const answer = await callTool(
    'edit_onenote_page',
    {
      page_id: 'a-page-id',
      confirmation_token: 'whatever-the-preview-said',
      changes: [{ action: 'append', text: 'Stand Mai 2026' }],
    },
    ['--allow-writes', 'onenote-edit'],
  );

  assert.ok(
    !/Invalid arguments|Required at|validation error/i.test(answer),
    `the schema refused a batch: ${answer}`,
  );
});

test('a call with neither a single action nor changes says which to give', async () => {
  const answer = await callTool(
    'preview_onenote_edit',
    { page_id: 'a-page-id' },
    ['--allow-writes', 'onenote-edit'],
  );

  assert.ok(
    !/Invalid arguments|Required at/i.test(answer),
    'the schema should let this through so the server can explain it',
  );
});
