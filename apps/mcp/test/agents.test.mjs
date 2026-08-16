import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { installAgentPack, listAgentWorkflows, loadAgentWorkflow } from '../dist/agents.js';

test('uses bundled workflows without contacting GitHub by default', async () => {
  delete process.env.ARTIST_MCP_REGISTRY_URL;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('unexpected network request');
  };
  try {
    const entries = await listAgentWorkflows();
    assert.ok(entries.some((entry) => entry.id === 'role:orchestrator'));
    const workflow = await loadAgentWorkflow('role:orchestrator');
    assert.match(workflow.content, /working-unit page/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lists and loads checksummed workflows from the bundled fallback', async () => {
  process.env.ARTIST_MCP_REGISTRY_URL = 'http://127.0.0.1:1/registry.json';
  try {
    const entries = await listAgentWorkflows();
    assert.ok(entries.some((entry) => entry.id === 'role:orchestrator'));
    assert.ok(entries.some((entry) => entry.id === 'project-type:concert'));
    assert.ok(entries.some((entry) => entry.id === 'policy:local-state'));
    const workflow = await loadAgentWorkflow('role:orchestrator');
    assert.match(workflow.content, /working-unit page/);
    const policy = await loadAgentWorkflow('policy:local-state');
    assert.match(policy.content, /\.artist\/local\//);
    assert.match(policy.content, /not an agent coordination protocol/);
  } finally {
    delete process.env.ARTIST_MCP_REGISTRY_URL;
  }
});

test('installs the read-only artist workflow pack idempotently', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'artist-agent-pack-'));
  try {
    await installAgentPack(fixture);
    await installAgentPack(fixture);
    await access(resolve(fixture, '.artist/roles/ORCHESTRATOR.md'));
    await access(resolve(fixture, '.artist/project-types/CONCERT.md'));
    await access(resolve(fixture, '.artist/policies/LOCAL_STATE.md'));
    assert.match(await readFile(resolve(fixture, 'AGENTS.md'), 'utf8'), /OneNote page/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('preserves an existing AGENTS.md while installing workflow files', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'artist-agent-pack-'));
  try {
    await writeFile(resolve(fixture, 'AGENTS.md'), 'owner instructions\n');
    await installAgentPack(fixture);
    assert.equal(await readFile(resolve(fixture, 'AGENTS.md'), 'utf8'), 'owner instructions\n');
    await access(resolve(fixture, '.artist/roles/REGISTRAR.md'));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

/**
 * Keeping their file is right, but "left unchanged" alone reads the same for an
 * edit they made and a copy that merely predates the current text — and those
 * need different actions. The second case is a user still holding rules that
 * have since been rewritten, which is how the shipped AGENTS.md came to contain
 * phrasing `policy:divergence` forbids while nothing could detect it.
 */
test('a kept AGENTS.md says what the shipped one now is, and how to take it', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'artist-agent-pack-'));
  const written = [];
  const log = console.log;
  console.log = (...parts) => written.push(parts.join(' '));
  try {
    await writeFile(resolve(fixture, 'AGENTS.md'), 'owner instructions\n');
    await installAgentPack(fixture);
  } finally {
    console.log = log;
    await rm(fixture, { recursive: true, force: true });
  }
  const output = written.join('\n');
  // Names the ambiguity rather than implying their file was judged.
  assert.match(output, /cannot tell from an edit of yours/);
  // Says what they would be taking, so an untouched old copy is recognisable.
  assert.match(output, /no longer restates any rules/);
  assert.match(output, /delete AGENTS\.md and run this again/);
});
