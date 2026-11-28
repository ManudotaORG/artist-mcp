import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * The Node versions this repository names, kept in step (scope.md, gap 8).
 *
 * They drifted apart once already: `.nvmrc` pinned 22 while CI, the release
 * workflow and Vercel ran 24, and `engines.node` promised users 20, which
 * nothing ran at all. A comment asking for them to match is a rule nobody
 * applies, so this test applies it.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const floor = (pkg) => Number(JSON.parse(read(pkg)).engines.node.match(/^>=\s*(\d+)/)[1]);

/** The node-version of one job in a workflow, read without a YAML parser. */
const jobNode = (workflow, job) => {
  const text = read(workflow);
  const start = text.indexOf(`\n  ${job}:`);
  assert.ok(start >= 0, `${workflow} has no job ${job}`);
  const next = text.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  const body = next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
  return Number(body.match(/node-version:\s*(\d+)/)[1]);
};

test('the package and the workspace promise the same oldest Node', () => {
  assert.equal(floor('apps/mcp/package.json'), floor('package.json'));
});

test('CI runs the package tests on exactly the oldest Node it promises', () => {
  assert.equal(jobNode('.github/workflows/ci.yml', 'package-floor'), floor('apps/mcp/package.json'));
});

test('.nvmrc names the Node CI builds with', () => {
  assert.equal(Number(read('.nvmrc').trim()), jobNode('.github/workflows/ci.yml', 'quality'));
});
