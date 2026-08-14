import assert from 'node:assert/strict';
import test from 'node:test';

import { renderWorkflowBriefing } from '../dist/server.js';

const entry = (id, kind, overrides = {}) => ({
  id,
  kind,
  name: id,
  description: `what ${id} is for`,
  file: `.artist/${kind === 'role' ? 'roles' : `${kind}s`}/${id}.md`,
  sha256: 'a'.repeat(64),
  source: 'bundled',
  origin: '/pack',
  ...overrides,
});

const entries = [
  entry('policy:intake', 'policy'),
  entry('policy:local-state', 'policy'),
  entry('project-type:concert', 'project-type'),
  entry('project-type:rehearsal', 'project-type'),
  entry('role:orchestrator', 'role'),
];

const loadAll = async (id) => ({ content: `body of ${id}` });

test('project types and intake are returned in full; roles are summarised', async () => {
  const text = await renderWorkflowBriefing(entries, loadAll);
  assert.match(text, /body of project-type:concert/);
  assert.match(text, /body of policy:intake/);
  // A role is a one-liner until something loads it.
  assert.doesNotMatch(text, /body of role:orchestrator/);
  assert.match(text, /- role:orchestrator: role:orchestrator — what role:orchestrator is for/);
  assert.doesNotMatch(text, /NOT IN FORCE/);
});

/**
 * The regression this exists for. A checksum failure — a user editing the
 * installed package rather than a local directory — used to fall back to the
 * one-line description and succeed, so a project type dropped out of the
 * classification with nothing said. Absent rules must be stated, not summarised.
 */
test('a playbook that cannot be read is reported, not quietly summarised', async () => {
  const text = await renderWorkflowBriefing(entries, async (id) => {
    if (id === 'project-type:concert') {
      throw new Error('Checksum verification failed for project-type:concert.');
    }
    return { content: `body of ${id}` };
  });

  assert.match(text, /^WARNING: 1 playbook\(s\) could not be read/m);
  assert.match(text, /NOT in force: project-type:concert/);
  assert.match(text, /## project-type:concert — NOT IN FORCE/);
  assert.match(text, /Checksum verification failed/);
  // Names the correct route rather than leaving the user to guess.
  assert.match(text, /init --editable/);
  // The description is still shown, but never as if it were the playbook.
  assert.match(text, /Description only, not the playbook/);
  // The rest of the pack is unaffected.
  assert.match(text, /body of project-type:rehearsal/);
});

test('the warning leads the text, so it cannot be missed', async () => {
  const text = await renderWorkflowBriefing(entries, async () => {
    throw new Error('nope');
  });
  assert.ok(text.startsWith('WARNING:'), text.slice(0, 40));
});

test("local files are named with the path, and bundled ones are not", async () => {
  const text = await renderWorkflowBriefing(
    [
      entry('project-type:concert', 'project-type', {
        source: 'local',
        origin: '/home/me/playbooks',
      }),
      entry('project-type:rehearsal', 'project-type'),
    ],
    loadAll,
  );
  assert.match(text, /1 of these are this user's own edited files/);
  assert.match(text, /\/home\/me\/playbooks\/\.artist\/project-types\/project-type:concert\.md/);
  assert.doesNotMatch(text, /project-type:rehearsal —/);
});

test('no local files means no provenance note at all', async () => {
  const text = await renderWorkflowBriefing(entries, loadAll);
  assert.doesNotMatch(text, /this user's own edited files/);
});
