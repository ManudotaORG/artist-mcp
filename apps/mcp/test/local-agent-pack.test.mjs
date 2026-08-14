import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_EDITABLE_DIRECTORY,
  assertLocalAgentPack,
  listAgentWorkflows,
  loadAgentWorkflow,
  resolveRegistry,
  seedEditablePack,
} from '../dist/agents.js';

const concertPath = (root) => resolve(root, '.artist/project-types/CONCERT.md');

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

test('a directory with no pack container fails loudly, not silently bundled', async () => {
  await withLocalPack({ 'README.md': 'not a pack\n' }, async (root) => {
    await assert.rejects(listAgentWorkflows(), (err) => {
      assert.match(err.message, /No \.artist\/ or artist\/ directory/);
      assert.match(err.message, new RegExp(root.replaceAll('\\', '\\\\')));
      assert.match(err.message, /init --editable/);
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
 * One install copies everything. Per-file opt-in made the user track which
 * playbooks were theirs and which were still the package's, which is bookkeeping
 * the tool should do — and the reason it existed, that a full copy stops a later
 * version's improvements arriving, is answered by this being re-runnable.
 */
test('the editable install copies the whole pack', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'artist-seed-'));
  try {
    const { added, unchanged, yours, container } = await seedEditablePack(root);
    assert.equal(added.length, 13);
    assert.deepEqual(unchanged, []);
    assert.deepEqual(yours, []);
    assert.equal(container, 'artist');

    process.env.ARTIST_MCP_AGENTS_DIR = root;
    const entries = await listAgentWorkflows();
    assert.equal(entries.length, 13);
    assert.ok(entries.every((entry) => entry.source === 'local'));
  } finally {
    delete process.env.ARTIST_MCP_AGENTS_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test('re-running adds what is new and never touches an edit', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'artist-reseed-'));
  try {
    await seedEditablePack(root);

    const edited = resolve(root, 'artist/project-types/CONCERT.md');
    await writeFile(edited, '# Concert\n\nMy own rules.\n');
    // Stands in for a playbook that did not exist in the version first installed.
    await rm(resolve(root, 'artist/project-types/REHEARSAL.md'));

    const { added, unchanged, yours } = await seedEditablePack(root);
    assert.deepEqual(added, ['project-type:rehearsal']);
    assert.deepEqual(yours, ['project-type:concert']);
    assert.equal(unchanged.length, 11);
    // The edit survived verbatim.
    assert.equal(await readFile(edited, 'utf8'), '# Concert\n\nMy own rules.\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the default directory is under the home directory, not the cwd', () => {
  assert.match(DEFAULT_EDITABLE_DIRECTORY, /artist-playbooks$/);
  assert.ok(DEFAULT_EDITABLE_DIRECTORY.startsWith(homedir()));
});

test('a pack is counted before init will write it into the config', async () => {
  await withLocalPack(
    { '.artist/project-types/CONCERT.md': '# Concert\n\nMine.\n' },
    async (root) => {
      assert.equal(await assertLocalAgentPack(root), 1);
    },
  );
  await assert.rejects(assertLocalAgentPack(tmpdir()), /No \.artist\/ or artist\/ directory/);
});

/**
 * The server names this path when it lists or loads a local playbook, so a
 * request to improve one can be answered with the file to change. Nothing here
 * writes it — the user does.
 */
test('a loaded local playbook carries the file the user would edit', async () => {
  await withLocalPack(
    { '.artist/project-types/CONCERT.md': '# Concert\n\nMine.\n' },
    async (root) => {
      const workflow = await loadAgentWorkflow('project-type:concert');
      assert.equal(workflow.source, 'local');
      assert.equal(workflow.origin, root);
      assert.equal(resolve(workflow.origin, workflow.file), concertPath(root));
    },
  );
});

/**
 * A bundled path points inside an npx cache. Telling the user to edit that would
 * be worse than saying nothing: the edit would work once and vanish on upgrade.
 */
test('a bundled playbook is marked bundled so no path is offered for it', async () => {
  await withLocalPack(
    { '.artist/project-types/CONCERT.md': '# Concert\n\nMine.\n' },
    async () => {
      const workflow = await loadAgentWorkflow('role:envoy');
      assert.equal(workflow.source, 'bundled');
    },
  );
});

test('a playbook a user adds becomes a first-class entry', async () => {
  await withLocalPack(
    { '.artist/project-types/WEDDING.md': '# Wedding\n\nOne page describing one wedding.\n' },
    async () => {
      const entries = await listAgentWorkflows();
      assert.equal(entries.length, 14);
      const wedding = entries.find((entry) => entry.id === 'project-type:wedding');
      assert.equal(wedding.kind, 'project-type');
      assert.equal(wedding.description, 'One page describing one wedding.');
    },
  );
});

test('a playbook filed in an invented directory is refused by name', async () => {
  await withLocalPack({ '.artist/custom/MISFILED.md': '# Misfiled\n\nMine.\n' }, async () => {
    await assert.rejects(listAgentWorkflows(), (err) => {
      assert.match(err.message, /not in a recognised directory: \.artist\/custom\/MISFILED\.md/);
      assert.match(err.message, /roles\|project-types\|policies/);
      return true;
    });
  });
});

/**
 * `.artist/` is right inside a repository, beside AGENTS.md. It is wrong for a
 * directory the user opens in a file browser to edit what is in it: a leading dot
 * makes the folder they were told to edit look empty.
 */
test('a visible artist/ container is read just like the hidden one', async () => {
  await withLocalPack(
    { 'artist/project-types/CONCERT.md': '# Concert\n\nVisible container.\n' },
    async (root) => {
      const workflow = await loadAgentWorkflow('project-type:concert');
      assert.equal(workflow.source, 'local');
      assert.equal(workflow.file, 'artist/project-types/CONCERT.md');
      assert.match(workflow.content, /Visible container/);
      assert.equal(resolve(root, workflow.file), resolve(root, 'artist/project-types/CONCERT.md'));
    },
  );
});

test('the id is the same whichever container holds the file', async () => {
  for (const container of ['.artist', 'artist']) {
    await withLocalPack(
      { [`${container}/project-types/CONCERT.md`]: '# Concert\n\nMine.\n' },
      async () => {
        const entries = await listAgentWorkflows();
        assert.equal(entries.length, 13);
        assert.equal(
          entries.find((entry) => entry.id === 'project-type:concert').source,
          'local',
        );
      },
    );
  }
});

test('a fresh directory is seeded with the visible container', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'artist-visible-'));
  try {
    await seedEditablePack(root);
    await access(resolve(root, 'artist/project-types/CONCERT.md'));
    await assert.rejects(access(resolve(root, '.artist')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Writing the visible name beside an existing `.artist/` would split the pack in
 * two and then greet the user with the doubled-container error for having run the
 * documented command twice.
 */
test('a directory already on .artist/ keeps it rather than gaining a second', async () => {
  await withLocalPack(
    { '.artist/policies/LOCAL_STATE.md': '# Local State\n\nMine.\n' },
    async (root) => {
      await seedEditablePack(root);
      await access(resolve(root, '.artist/project-types/CONCERT.md'));
      await assert.rejects(access(resolve(root, 'artist')));
    },
  );
});

test('both containers at once is refused rather than merged', async () => {
  await withLocalPack(
    {
      '.artist/project-types/CONCERT.md': '# Concert\n\nHidden copy.\n',
      'artist/project-types/CONCERT.md': '# Concert\n\nVisible copy.\n',
    },
    async () => {
      await assert.rejects(listAgentWorkflows(), (err) => {
        assert.match(err.message, /has both \.artist and artist directories/);
        assert.match(err.message, /hide whichever copy lost/);
        return true;
      });
    },
  );
});

test('no local directory means the bundled pack, unchanged', async () => {
  delete process.env.ARTIST_MCP_AGENTS_DIR;
  const entries = await listAgentWorkflows();
  assert.equal(entries.length, 13);
  assert.ok(entries.every((entry) => entry.source === 'bundled'));
});
