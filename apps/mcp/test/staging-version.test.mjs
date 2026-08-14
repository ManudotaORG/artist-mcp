import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const script = resolve('scripts/set-staging-version.mjs');

/**
 * A package.json and the source file that carries the same version, laid out as
 * the real package is. The server announces the second one over MCP, so a
 * fixture without it would pass while the published build reported the wrong
 * version — which is exactly what happened.
 */
const fixturePackage = async (version, source = `const serverVersion = '${version}'; // x-release-please-version\n`) => {
  const root = await mkdtemp(resolve(tmpdir(), 'artist-staging-version-'));
  const packagePath = resolve(root, 'package.json');
  await writeFile(packagePath, `${JSON.stringify({ version })}\n`);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'src/server.ts'), source);
  return { root, packagePath, sourcePath: resolve(root, 'src/server.ts') };
};

test('creates a unique next-patch staging version in both files', async () => {
  const { root, packagePath, sourcePath } = await fixturePackage('1.4.2');
  try {
    const { stdout } = await run(process.execPath, [script, '317', packagePath]);
    assert.equal(stdout.trim(), '1.4.3-staging.317');
    assert.equal(JSON.parse(await readFile(packagePath, 'utf8')).version, '1.4.3-staging.317');
    // The version the MCP handshake announces, not just the one npm publishes.
    assert.match(await readFile(sourcePath, 'utf8'), /'1\.4\.3-staging\.317'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a source file without the marker fails rather than being skipped', async () => {
  const { root, packagePath } = await fixturePackage('1.4.2', 'const serverVersion = "1.4.2";\n');
  try {
    await assert.rejects(run(process.execPath, [script, '317', packagePath]), /marker/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a non-numeric staging build id', async () => {
  await assert.rejects(run(process.execPath, [script, 'release']), /numeric-build-id/);
});

test('creates a unique staging version for a retried workflow run', async () => {
  const { root, packagePath, sourcePath } = await fixturePackage('2.0.0');
  try {
    const { stdout } = await run(process.execPath, [script, '418.2', packagePath]);
    assert.equal(stdout.trim(), '2.0.1-staging.418.2');
    assert.equal(JSON.parse(await readFile(packagePath, 'utf8')).version, '2.0.1-staging.418.2');
    assert.match(await readFile(sourcePath, 'utf8'), /'2\.0\.1-staging\.418\.2'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
