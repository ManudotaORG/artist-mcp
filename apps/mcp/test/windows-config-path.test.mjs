import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { windowsConfigPath } from '../dist/config.js';

/**
 * Claude Desktop on Windows is not always at %APPDATA%.
 *
 * A packaged install has a virtualised %APPDATA%: Desktop reads
 * Packages\Claude_<id>\LocalCache\Roaming\Claude\, while this package is an
 * ordinary Node process whose %APPDATA% is the real Roaming folder. Writing to
 * the obvious path produced two config files, each internally consistent, and
 * `init` and `status` agreed with each other about a grant Claude Desktop had
 * never seen. Every check passed and the tools did not appear.
 *
 * No test here runs on Windows, so the path decision is exercised against a
 * fake filesystem instead.
 */
const withFakeWindows = async (build, run) => {
  const root = await mkdtemp(join(tmpdir(), 'artist-win-'));
  const previous = { appdata: process.env.APPDATA, local: process.env.LOCALAPPDATA };
  process.env.APPDATA = join(root, 'AppData', 'Roaming');
  process.env.LOCALAPPDATA = join(root, 'AppData', 'Local');
  try {
    await build(root);
    return await run(root);
  } finally {
    if (previous.appdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previous.appdata;
    if (previous.local === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous.local;
    await rm(root, { recursive: true, force: true });
  }
};

const packagedDir = (root, id = 'Claude_pzs8sxrjxfjjc') =>
  join(root, 'AppData', 'Local', 'Packages', id, 'LocalCache', 'Roaming', 'Claude');

test('a packaged install wins, because it is the one Desktop reads', async () => {
  await withFakeWindows(
    async (root) => {
      const dir = packagedDir(root);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'claude_desktop_config.json'), '{}');
      // The decoy: the path this used to write, which Desktop never opens.
      const plain = join(root, 'AppData', 'Roaming', 'Claude');
      await mkdir(plain, { recursive: true });
      await writeFile(join(plain, 'claude_desktop_config.json'), '{}');
    },
    (root) => {
      const chosen = windowsConfigPath(root);
      assert.match(chosen, /Packages/);
      assert.equal(chosen, join(packagedDir(root), 'claude_desktop_config.json'));
    },
  );
});

test('an ordinary install still uses %APPDATA%', async () => {
  await withFakeWindows(
    async (root) => {
      const plain = join(root, 'AppData', 'Roaming', 'Claude');
      await mkdir(plain, { recursive: true });
      await writeFile(join(plain, 'claude_desktop_config.json'), '{}');
    },
    (root) => {
      const chosen = windowsConfigPath(root);
      assert.doesNotMatch(chosen, /Packages/);
      assert.match(chosen, /Roaming/);
    },
  );
});

test('no Packages directory at all is not an error', async () => {
  await withFakeWindows(
    async () => {},
    (root) => {
      assert.match(windowsConfigPath(root), /Roaming/);
    },
  );
});

/**
 * A packaged install before its config exists. The plain path would be written
 * and ignored, which is the failure this whole file is about.
 */
test('a packaged install with no config yet is still preferred', async () => {
  await withFakeWindows(
    async (root) => {
      await mkdir(packagedDir(root), { recursive: true });
    },
    (root) => {
      assert.match(windowsConfigPath(root), /Packages/);
    },
  );
});

/**
 * An uninstalled package can leave the directory behind. An existing plain
 * config is then better evidence of what is in use than an empty shell.
 */
test('an empty package shell does not beat an existing ordinary config', async () => {
  await withFakeWindows(
    async (root) => {
      await mkdir(packagedDir(root, 'Claude_leftover'), { recursive: true });
      const plain = join(root, 'AppData', 'Roaming', 'Claude');
      await mkdir(plain, { recursive: true });
      await writeFile(join(plain, 'claude_desktop_config.json'), '{}');
    },
    (root) => {
      assert.doesNotMatch(windowsConfigPath(root), /Packages/);
    },
  );
});

test('a package holding a config beats an empty one', async () => {
  await withFakeWindows(
    async (root) => {
      await mkdir(packagedDir(root, 'Claude_aaa_empty'), { recursive: true });
      const real = packagedDir(root, 'Claude_zzz_real');
      await mkdir(real, { recursive: true });
      await writeFile(join(real, 'claude_desktop_config.json'), '{}');
    },
    (root) => {
      assert.match(windowsConfigPath(root), /Claude_zzz_real/);
    },
  );
});
