import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * The hosted route layers `vendor/artist-pack` over the bundled pack, and that
 * layer deliberately does not fall back: a directory it cannot read throws
 * rather than quietly serving different playbooks. That strictness is right —
 * misreporting what is in force is the one thing the layer must not do — but it
 * means a packaging slip is an outage for every hosted caller rather than a
 * silent substitution. These assertions are what stops the slip reaching a
 * deploy, so they check the layout rules the runtime enforces, not the prose.
 *
 * They are deliberately static. The root suite runs before `pnpm build`, so
 * `deriveRegistry` is not importable here; the rules below are copied from
 * `agent-registry.ts` and any change there must be made here too.
 */

const root = new URL('..', import.meta.url).pathname;
const pack = join(root, 'vendor', 'artist-pack');

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? walk(join(directory, item.name)) : [join(directory, item.name)],
  );

const markdown = () =>
  walk(join(pack, 'artist')).map((path) => path.slice(pack.length + 1).replaceAll('\\', '/'));

test('the vendored pack uses exactly one container', () => {
  const containers = readdirSync(pack, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name);
  // Both present is an error at runtime, not a preference: they would merge and
  // whichever copy lost would be invisible.
  assert.deepEqual(containers, ['artist']);
});

test('every file sits at container/kind/name.md', () => {
  // A file anywhere else does not load as a lesser playbook — `kindOf` throws,
  // and with no fallback that is the whole pack gone.
  for (const file of markdown()) {
    const segments = file.split('/');
    assert.equal(segments.length, 3, `${file} is nested or loose`);
    assert.ok(
      ['roles', 'project-types', 'policies'].includes(segments[1]),
      `${file} is not under a recognised kind directory`,
    );
    assert.ok(file.endsWith('.md'), `${file} is not Markdown`);
  }
});

test('nothing but Markdown was vendored', () => {
  // The pack repository accumulates `.bak-*` copies and `.DS_Store`. None of it
  // is ever loaded, and `collectMarkdown` ignores it — but a `.bak` of a
  // playbook in a deploy is a second copy of executable policy, which is worth
  // keeping out on its own.
  for (const file of markdown()) assert.ok(file.endsWith('.md'), `${file} is not Markdown`);
});

test('no file is empty or oversized', () => {
  // 64 KiB is MAX_LOCAL_FILE_BYTES. The ceiling matters because project types
  // and the ALWAYS policies are injected in full, unasked: an oversized file
  // does not fail, it spends the context the notes needed.
  for (const file of markdown()) {
    const bytes = statSync(join(pack, file)).size;
    assert.ok(bytes > 0, `${file} is empty`);
    assert.ok(bytes <= 64 * 1024, `${file} is ${bytes} bytes, over the 64 KiB limit`);
  }
});

test('no two files derive the same id', () => {
  const ids = markdown().map((file) => {
    const [, kind, name] = file.split('/');
    return `${kind}:${name.replace(/\.md$/, '').toLowerCase().replaceAll('_', '-')}`;
  });
  assert.equal(new Set(ids).size, ids.length, 'two playbooks derive one id');
});

test('the policies loaded in full are all present', () => {
  // These are the ALWAYS array in server.ts. The bundled pack would supply any
  // that were missing, since this is a layer rather than a replacement — but a
  // half-shadowed policy set means hosted runs a mix of the two, which is
  // harder to reason about than either.
  const ids = new Set(markdown().map((file) => file.split('/')[2].replace(/\.md$/, '')));
  for (const policy of ['INTAKE', 'ANSWERING', 'EVIDENCE', 'DIVERGENCE', 'PATCH']) {
    assert.ok(ids.has(policy), `${policy} is missing from the vendored pack`);
  }
});

test('the source commit is recorded', () => {
  const source = JSON.parse(readFileSync(join(pack, 'SOURCE.json'), 'utf8'));
  assert.match(source.commit, /^[a-f0-9]{40}$/);
  assert.equal(source.repository, 'https://github.com/ManudotaORG/artist-mcp-custom-pack');
});

test('the hosted route points at the vendored pack, and the deploy carries it', () => {
  // Two halves of one fact, in two files. The route naming a directory that the
  // trace does not upload resolves on a developer's machine and throws in
  // production — the exact failure outputFileTracingIncludes already exists to
  // prevent for the bundled pack.
  const route = readFileSync(join(root, 'apps/web/src/app/api/mcp/route.ts'), 'utf8');
  assert.match(
    route,
    /ARTIST_MCP_AGENTS_DIR \?\?= join\(process\.cwd\(\), '\.\.', '\.\.', 'vendor', 'artist-pack'\)/,
  );
  const config = readFileSync(join(root, 'apps/web/next.config.ts'), 'utf8');
  assert.match(config, /'\.\.\/\.\.\/vendor\/artist-pack\/\*\*\/\*'/);
});
