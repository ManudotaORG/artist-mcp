import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { forGrants } from '../dist/server.js';
import { createServer } from '../dist/server.js';
import { WRITE_CAPABILITIES } from '../dist/grants.js';

/**
 * A playbook section may be marked `<!-- needs:<capability> -->`, and is then
 * loaded only by an install holding that grant.
 *
 * This is the one conditional thing about a playbook, so it is guarded the way
 * the operation table is. The failure that matters is not "a section was kept"
 * — it is a section silently vanishing for an install that could have acted on
 * it, which is the shape of the three bugs this pack already has on record.
 */

test('an untagged playbook is returned byte for byte', () => {
  const doc = '# A\n\nbody\n\n## B\n\nmore\n';
  assert.equal(forGrants(doc, []), doc);
  assert.equal(forGrants(doc, ['onenote-edit']), doc);
});

test('a tagged section is kept for an install holding the grant, marker removed', () => {
  const doc = '# A\n\nkeep\n\n## B <!-- needs:onenote-edit -->\n\ngated\n';
  const out = forGrants(doc, ['onenote-edit']);
  assert.match(out, /gated/);
  assert.match(out, /^## B$/m, 'the marker itself must not reach the model');
});

test('a tagged section is dropped for an install without the grant', () => {
  const doc = '# A\n\nkeep\n\n## B <!-- needs:onenote-edit -->\n\ngated\n\n## C\n\nafter\n';
  const out = forGrants(doc, ['calendar-create']);
  assert.match(out, /keep/);
  assert.doesNotMatch(out, /gated/);
  assert.match(out, /after/, 'the next sibling heading ends the gated section');
});

test('a gated section takes its subsections and stops at the same level', () => {
  const doc = '## B <!-- needs:onenote-edit -->\n\ngated\n\n### B1\n\nalso gated\n\n## C\n\nkept\n';
  const out = forGrants(doc, []);
  assert.doesNotMatch(out, /gated/);
  assert.match(out, /kept/);
});

test('a gated subsection does not swallow the section after it', () => {
  const doc = '## A\n\nkept\n\n### A1 <!-- needs:onenote-edit -->\n\ngated\n\n## B\n\nalso kept\n';
  const out = forGrants(doc, []);
  assert.doesNotMatch(out, /gated/);
  assert.match(out, /kept/);
  assert.match(out, /also kept/);
});

test('an unknown capability throws rather than quietly removing a section', () => {
  assert.throws(
    () => forGrants('## B <!-- needs:onenote-delete -->\n\nx\n', []),
    /not a capability/,
    'a typo that silently deletes rules is the bug this marker could cause',
  );
});

/**
 * The pack itself. These assert the intent of every marker actually committed,
 * so adding one to a section that is not about a gated tool fails here.
 */
test('every marker in the pack names a real capability', async () => {
  const patch = await readFile(
    new URL('../agent-pack/.artist/policies/PATCH.md', import.meta.url),
    'utf8',
  );
  const names = [...patch.matchAll(/<!--\s*needs:([a-z-]+)\s*-->/g)].map((m) => m[1]);
  assert.ok(names.length > 0, 'PATCH.md is the file this mechanism exists for');
  for (const name of names) assert.ok(name in WRITE_CAPABILITIES, `${name} is not a capability`);
});

test('policy:patch keeps the rules that hold with no grant at all', async () => {
  const server = await createServer(async () => ({}), []);
  const text = (await server._registeredTools.list_agent_workflows.handler({})).content
    .map((c) => c.text)
    .join('\n');
  // The paste workflow exists whatever the install may write, so these must
  // survive: gating the file wholesale would have taken them.
  assert.match(text, /There is a patch when there is a decision/);
  assert.match(text, /Never invent a value/);
  assert.match(text, /Name where it goes/);
  // And the parts that describe a tool this install does not have must not.
  assert.doesNotMatch(text, /Whose page is it/);
  assert.doesNotMatch(text, /border-collapse/);
});

test('an install granted onenote-edit still gets the whole of policy:patch', async () => {
  const server = await createServer(async () => ({}), ['onenote-edit']);
  const text = (await server._registeredTools.list_agent_workflows.handler({})).content
    .map((c) => c.text)
    .join('\n');
  assert.match(text, /Whose page is it/);
  assert.match(text, /A table is the exception/);
});
