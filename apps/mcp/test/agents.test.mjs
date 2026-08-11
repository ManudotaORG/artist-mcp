import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  installAgentPack,
  listAgentWorkflows,
  loadAgentWorkflow,
} from '../dist/agents.js';

test('lists and loads checksummed workflows from the bundled fallback', async () => {
  process.env.ARTIST_MCP_REGISTRY_URL = 'http://127.0.0.1:1/registry.json';
  const entries = await listAgentWorkflows();
  assert.ok(entries.some((entry) => entry.id === 'role:orchestrator'));
  assert.ok(entries.some((entry) => entry.id === 'project-type:concert'));
  assert.ok(entries.some((entry) => entry.id === 'policy:local-state'));
  const workflow = await loadAgentWorkflow('role:orchestrator');
  assert.match(workflow.content, /working-unit page/);
  const policy = await loadAgentWorkflow('policy:local-state');
  assert.match(policy.content, /\.artist\/local\//);
  assert.match(policy.content, /not an agent coordination protocol/);
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
