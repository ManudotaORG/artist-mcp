import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listAgentWorkflows } from '../dist/agents.js';

/**
 * Hosted serves one notebook's workflow, so the vendored pack is the whole
 * answer rather than a layer over a generic one.
 *
 * Layering leaves a hazard that is invisible until it fires: a bundled playbook
 * stays in force because the custom pack happens not to name its id, and a
 * generic rule then governs a notebook nobody wrote it for. Pack resolution is
 * process-wide, so that reaches every hosted caller at once.
 *
 * The mode only ever narrows. Anything it does not recognise layers, which is
 * what every install that has never heard of it already does.
 */

const withEnv = async (vars, run) => {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

/** A pack holding one role and nothing else, so shadowing is unambiguous. */
const onePlaybookPack = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-'));
  await mkdir(join(root, 'artist', 'roles'), { recursive: true });
  await writeFile(
    join(root, 'artist', 'roles', 'ORCHESTRATOR.md'),
    '# Orchestrator\n\nOnly this one.\n',
    'utf8',
  );
  return root;
};

test('replace serves only the local pack; layer keeps the bundled ids', async () => {
  const root = await onePlaybookPack();
  try {
    const layered = await withEnv(
      { ARTIST_MCP_AGENTS_DIR: root, ARTIST_MCP_PACK_MODE: undefined },
      listAgentWorkflows,
    );
    const replaced = await withEnv(
      { ARTIST_MCP_AGENTS_DIR: root, ARTIST_MCP_PACK_MODE: 'replace' },
      listAgentWorkflows,
    );

    assert.equal(replaced.length, 1, `replace served ${replaced.length} playbooks`);
    assert.equal(replaced[0].source, 'local');
    assert.equal(
      layered.length > 1,
      true,
      'layering did not keep the bundled playbooks, so the two modes are not distinguishable',
    );
    assert.equal(
      layered.some((e) => e.source === 'bundled'),
      true,
      'a bundled playbook should survive layering — that is the hazard replace removes',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unrecognised mode layers, so an install that never heard of it is unchanged', async () => {
  const root = await onePlaybookPack();
  try {
    const entries = await withEnv(
      { ARTIST_MCP_AGENTS_DIR: root, ARTIST_MCP_PACK_MODE: 'REPLACE' },
      listAgentWorkflows,
    );
    assert.equal(
      entries.some((e) => e.source === 'bundled'),
      true,
      'a mode that is not exactly "replace" narrowed the pack',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an empty pack throws under replace rather than serving the bundle', async () => {
  // Not this mode's own guard — `readLocalRegistry` refuses an empty directory
  // a level down, and that refusal is what makes replacing safe. Asserted here
  // because replace is what makes it load-bearing: under layering an empty
  // pack would merely change nothing, and process-wide this reaches every
  // hosted caller at once.
  const root = await mkdtemp(join(tmpdir(), 'pack-empty-'));
  await mkdir(join(root, 'artist', 'roles'), { recursive: true });
  try {
    await assert.rejects(
      withEnv(
        { ARTIST_MCP_AGENTS_DIR: root, ARTIST_MCP_PACK_MODE: 'replace' },
        listAgentWorkflows,
      ),
      /No workflow Markdown found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
