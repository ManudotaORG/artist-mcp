import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { deriveEntry, deriveRegistry, resolveWithin } from '../dist/agent-registry.js';

const packRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../agent-pack');

/**
 * The bundled registry is a build artifact that is also committed, and the
 * runtime reads a user's directory through the same derivation. This asserts
 * both at once: that registry.json is not stale, and that the shared rule still
 * produces exactly what shipped.
 */
test('the committed registry matches what the derivation produces', async () => {
  const derived = await deriveRegistry(packRoot);
  const committed = JSON.parse(await readFile(resolve(packRoot, 'registry.json'), 'utf8'));
  assert.deepEqual(derived, committed);
});

test('kind and id come from where the file sits, not its contents', () => {
  const role = deriveEntry(
    '.artist/roles/PROJECT_MANAGER.md',
    '# Project Manager\n\nRuns things.\n',
  );
  assert.equal(role.kind, 'role');
  assert.equal(role.id, 'role:project-manager');
  assert.equal(role.name, 'Project Manager');

  assert.equal(deriveEntry('.artist/project-types/CONCERT.md', '# Concert\n').kind, 'project-type');
  assert.equal(deriveEntry('.artist/policies/INTAKE.md', '# Intake\n').kind, 'policy');
});

test('the description is the first whole paragraph, unwrapped', () => {
  const entry = deriveEntry(
    '.artist/roles/ENVOY.md',
    '# Envoy\n\nDrafts outreach\nfor a working unit.\n\nMore detail here.\n',
  );
  assert.equal(entry.description, 'Drafts outreach for a working unit.');
});

test('a file with no heading still yields a usable name', () => {
  const entry = deriveEntry('.artist/policies/NOTES.md', 'no heading at all\n');
  assert.equal(entry.name, 'notes');
  assert.equal(entry.id, 'policy:notes');
});

test('a registry path may not escape its root', () => {
  assert.throws(() => resolveWithin(packRoot, '../../../etc/passwd'), /escapes the pack/);
  assert.throws(() => resolveWithin(packRoot, '/etc/passwd'), /escapes the pack/);
  assert.equal(
    resolveWithin(packRoot, '.artist/roles/ENVOY.md'),
    resolve(packRoot, '.artist/roles/ENVOY.md'),
  );
});

test('derivation is stable and sorted for any pack-shaped directory', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'artist-derive-'));
  try {
    await mkdir(resolve(fixture, '.artist/roles'), { recursive: true });
    await mkdir(resolve(fixture, '.artist/project-types'), { recursive: true });
    await writeFile(resolve(fixture, '.artist/roles/ZEBRA.md'), '# Zebra\n\nLast.\n');
    await writeFile(resolve(fixture, '.artist/roles/ALPHA.md'), '# Alpha\n\nFirst.\n');
    await writeFile(resolve(fixture, '.artist/project-types/GIG.md'), '# Gig\n\nA gig.\n');
    // Not Markdown, and so not policy — a stray file must not become an entry.
    await writeFile(resolve(fixture, '.artist/notes.txt'), 'ignore me\n');

    const { schemaVersion, entries } = await deriveRegistry(fixture);
    assert.equal(schemaVersion, 1);
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ['project-type:gig', 'role:alpha', 'role:zebra'],
    );
    assert.deepEqual(
      entries.map((entry) => entry.file),
      ['.artist/project-types/GIG.md', '.artist/roles/ALPHA.md', '.artist/roles/ZEBRA.md'],
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
