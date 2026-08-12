import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const script = resolve('scripts/set-staging-version.mjs');

test('creates a unique next-patch staging version', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'artist-staging-version-'));
  const packagePath = resolve(fixture, 'package.json');
  try {
    await writeFile(packagePath, `${JSON.stringify({ version: '1.4.2' })}\n`);
    const { stdout } = await run(process.execPath, [script, '317', packagePath]);
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    assert.equal(stdout.trim(), '1.4.3-staging.317');
    assert.equal(packageJson.version, '1.4.3-staging.317');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('rejects a non-numeric staging build id', async () => {
  await assert.rejects(run(process.execPath, [script, 'release']), /numeric-build-id/);
});

test('creates a unique staging version for a retried workflow run', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'artist-staging-version-'));
  const packagePath = resolve(fixture, 'package.json');
  try {
    await writeFile(packagePath, `${JSON.stringify({ version: '2.0.0' })}\n`);
    const { stdout } = await run(process.execPath, [script, '418.2', packagePath]);
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    assert.equal(stdout.trim(), '2.0.1-staging.418.2');
    assert.equal(packageJson.version, '2.0.1-staging.418.2');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
