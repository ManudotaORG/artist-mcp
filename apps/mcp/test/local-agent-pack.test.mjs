import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { listAgentWorkflows, loadAgentWorkflow, resolveRegistry } from '../dist/agents.js';

/** A pack-shaped directory, seeded with whatever the test needs. */
const withLocalPack = async (files, run) => {
  const root = await mkdtemp(resolve(tmpdir(), 'artist-local-pack-'));
  try {
    for (const [file, content] of Object.entries(files)) {
      const path = resolve(root, file);
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, content);
    }
    process.env.ARTIST_MCP_AGENTS_DIR = root;
    await run(root);
  } finally {
    delete process.env.ARTIST_MCP_AGENTS_DIR;
    await rm(root, { recursive: true, force: true });
  }
};

test('a local file shadows the bundled one under the same id', async () => {
  await withLocalPack(
    { '.artist/project-types/CONCERT.md': '# Concert\n\nMy own rules for a concert.\n' },
    async () => {
      const workflow = await loadAgentWorkflow('project-type:concert');
      assert.match(workflow.content, /My own rules for a concert/);
      assert.equal(workflow.description, 'My own rules for a concert.');
    },
  );
});

test('shadowing one file leaves the rest of the pack in place', async () => {
  await withLocalPack(
    { '.artist/project-types/CONCERT.md': '# Concert\n\nMine.\n' },
    async (root) => {
      const entries = await listAgentWorkflows();
      // The bundled pack ships thirteen; shadowing must not drop any of them.
      assert.equal(entries.length, 13);

      const concert = entries.find((entry) => entry.id === 'project-type:concert');
      assert.equal(concert.source, 'local');
      assert.equal(concert.origin, root);

      const orchestrator = entries.find((entry) => entry.id === 'role:orchestrator');
      assert.equal(orchestrator.source, 'bundled');
      // Still readable, and still the shipped text.
      const loaded = await loadAgentWorkflow('role:orchestrator');
      assert.match(loaded.content, /working-unit page/);
    },
  );
});

test('a local-only playbook is added to the pack', async () => {
  await withLocalPack(
    { '.artist/project-types/WEDDING.md': '# Wedding\n\nOne page describing one wedding gig.\n' },
    async () => {
      const entries = await listAgentWorkflows();
      assert.equal(entries.length, 14);
      const wedding = entries.find((entry) => entry.id === 'project-type:wedding');
      assert.equal(wedding.kind, 'project-type');
      assert.equal(wedding.source, 'local');
      assert.match((await loadAgentWorkflow('project-type:wedding')).content, /one wedding gig/);
    },
  );
});

test('a directory with no .artist/ fails loudly instead of using the bundled pack', async () => {
  await withLocalPack({ 'README.md': 'not a pack\n' }, async (root) => {
    await assert.rejects(listAgentWorkflows(), (err) => {
      assert.match(err.message, /No \.artist\/ directory/);
      assert.match(err.message, new RegExp(root.replaceAll('\\', '\\\\')));
      assert.match(err.message, /agents install/);
      return true;
    });
  });
});

test('an empty workflow file is refused rather than registered as saying nothing', async () => {
  await withLocalPack({ '.artist/roles/ENVOY.md': '   \n\n' }, async () => {
    await assert.rejects(listAgentWorkflows(), /is empty: \.artist\/roles\/ENVOY\.md/);
  });
});

test('an oversized workflow file is refused before it can eat the context', async () => {
  const huge = `# Envoy\n\n${'x'.repeat(70 * 1024)}\n`;
  await withLocalPack({ '.artist/roles/ENVOY.md': huge }, async () => {
    await assert.rejects(listAgentWorkflows(), /too large: \.artist\/roles\/ENVOY\.md/);
  });
});

test('the resolution reports the local root and what it is layered over', async () => {
  await withLocalPack(
    { '.artist/policies/INTAKE.md': '# Intake\n\nMy intake policy.\n' },
    async (root) => {
      const { base, localRoot, remoteUnreachable } = await resolveRegistry();
      assert.equal(localRoot, root);
      assert.equal(base.source, 'bundled');
      assert.equal(remoteUnreachable, false);
    },
  );
});

test('a local path may not escape the local root', async () => {
  await withLocalPack({ '.artist/roles/ENVOY.md': '# Envoy\n\nMine.\n' }, async () => {
    await assert.rejects(loadAgentWorkflow('role:../../../etc/passwd'), /Unknown agent workflow/);
  });
});

test('no local directory means the bundled pack, unchanged', async () => {
  delete process.env.ARTIST_MCP_AGENTS_DIR;
  const entries = await listAgentWorkflows();
  assert.equal(entries.length, 13);
  assert.ok(entries.every((entry) => entry.source === 'bundled'));
});
