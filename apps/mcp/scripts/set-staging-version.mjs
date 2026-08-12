import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const buildId = process.argv[2];
const packagePath = resolve(process.argv[3] ?? 'package.json');

if (!buildId || !/^[0-9]+(?:\.[0-9]+)*$/.test(buildId)) {
  throw new Error('Usage: set-staging-version <numeric-build-id[.attempt]> [package.json]');
}

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(packageJson.version);
if (!match) {
  throw new Error(`Unsupported package version: ${packageJson.version}`);
}

const [, major, minor, patch] = match;
packageJson.version = `${major}.${minor}.${Number(patch) + 1}-staging.${buildId}`;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(packageJson.version);
