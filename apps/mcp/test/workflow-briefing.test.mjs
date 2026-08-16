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
  entry('policy:answering', 'policy'),
  entry('policy:divergence', 'policy'),
  entry('policy:evidence', 'policy'),
  entry('policy:intake', 'policy'),
  entry('policy:local-state', 'policy'),
  entry('policy:patch', 'policy'),
  entry('project-type:concert', 'project-type'),
  entry('project-type:rehearsal', 'project-type'),
  entry('role:orchestrator', 'role'),
];

const loadAll = async (id) => ({ content: `body of ${id}` });

test('project types and intake are returned in full; roles are summarised', async () => {
  const text = await renderWorkflowBriefing(entries, loadAll);
  assert.match(text, /body of project-type:concert/);
  assert.match(text, /body of policy:intake/);
  // Not every policy: local-state is a one-liner like a role.
  assert.doesNotMatch(text, /body of policy:local-state/);
  // A role is a one-liner until something loads it.
  assert.doesNotMatch(text, /body of role:orchestrator/);
  assert.match(text, /- role:orchestrator: role:orchestrator — what role:orchestrator is for/);
  assert.doesNotMatch(text, /NOT IN FORCE/);
});

/**
 * Answering governs the shape of every reply, including the first one, so a
 * one-line summary of it would leave it merely available rather than in force —
 * the same failure as a role that loads and is then ignored.
 */
test('the answering policy is in force from the first reply, not summarised', async () => {
  const text = await renderWorkflowBriefing(entries, loadAll);
  assert.match(text, /body of policy:answering/);
  assert.doesNotMatch(text, /- policy:answering:/);
});

/**
 * Evidence and divergence have to bind before anything would think to load a
 * policy. Evidence stops a cheap look that found nothing being reported as a
 * gap — applied late, the false gap is already out. Divergence has to fire
 * unprompted, because nobody asks whether two pages are one event.
 */
test('evidence and divergence are in force, and local state is not', async () => {
  const text = await renderWorkflowBriefing(entries, loadAll);
  assert.match(text, /body of policy:evidence/);
  assert.match(text, /body of policy:divergence/);
  // Answers a question that is asked out loud, so a one-liner is enough.
  assert.doesNotMatch(text, /body of policy:local-state/);
  assert.match(text, /- policy:local-state:/);
});

/**
 * Patch binds when a recommendation is agreed — the end of an ordinary answer,
 * and not a moment anything reaches for a policy. Summarised, it would be read
 * after the fragment had already gone out. Divergence and answering also
 * delegate to it by name, so a summary here breaks two policies loaded in full.
 */
test('the patch policy is in force, not summarised', async () => {
  const text = await renderWorkflowBriefing(entries, loadAll);
  assert.match(text, /body of policy:patch/);
  assert.doesNotMatch(text, /- policy:patch:/);
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
