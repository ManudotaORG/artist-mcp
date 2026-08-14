import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertLocalAgentPack,
  copyWorkflowForEditing,
  listAgentWorkflows,
  loadAgentWorkflow,
  resolveRegistry,
} from '../dist/agents.js';

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
      assert.match(err.message, /agents edit/);
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

/**
 * The point of copying one file rather than the pack: `agents install` makes
 * every id local, so a playbook improved in a later package version stops
 * reaching the user. Seeding sparsely is what keeps the overlay worth having.
 */
test('editing one playbook leaves the other twelve tracking the package', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'artist-seed-'));
  try {
    const quiet = console.log;
    console.log = () => {};
    try {
      await copyWorkflowForEditing('project-type:concert', root);
    } finally {
      console.log = quiet;
    }

    process.env.ARTIST_MCP_AGENTS_DIR = root;
    const entries = await listAgentWorkflows();
    assert.equal(entries.length, 13);
    assert.equal(entries.filter((entry) => entry.source === 'local').length, 1);
    assert.equal(
      entries.find((entry) => entry.id === 'project-type:concert').source,
      'local',
    );
  } finally {
    delete process.env.ARTIST_MCP_AGENTS_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test('an unknown id to copy lists what is available', async () => {
  await assert.rejects(copyWorkflowForEditing('project-type:nope', tmpdir()), (err) => {
    assert.match(err.message, /Unknown workflow: project-type:nope/);
    assert.match(err.message, /project-type:concert/);
    return true;
  });
});

test('copying refuses to overwrite an edit already made', async () => {
  await withLocalPack(
    { '.artist/project-types/CONCERT.md': '# Concert\n\nMy careful edit.\n' },
    async (root) => {
      await assert.rejects(
        copyWorkflowForEditing('project-type:concert', root),
        /Refusing to overwrite your edits/,
      );
    },
  );
});

test('a pack is counted before init will write it into the config', async () => {
  await withLocalPack(
    { '.artist/project-types/CONCERT.md': '# Concert\n\nMine.\n' },
    async (root) => {
      assert.equal(await assertLocalAgentPack(root), 1);
    },
  );
  await assert.rejects(assertLocalAgentPack(tmpdir()), /No \.artist\/ directory/);
});

test('no local directory means the bundled pack, unchanged', async () => {
  delete process.env.ARTIST_MCP_AGENTS_DIR;
  const entries = await listAgentWorkflows();
  assert.equal(entries.length, 13);
  assert.ok(entries.every((entry) => entry.source === 'bundled'));
});
