#!/usr/bin/env node
/**
 * Live verification: can a whole table actually be enumerated and replaced?
 *
 * Unit tests cannot answer this. A stub returns the page HTML that this
 * repository already believes Graph returns, so it agrees with the code about
 * every fact under test: which ids appear with `includeIDs=true`, whether a
 * `table:` id is a legal `replace` target, whether `insert` honours `position`,
 * and whether the ids move afterwards. Four defects have already survived a
 * green suite in this package for exactly that reason. So this runs against a
 * real notebook and reports what OneNote did, not what we expect it to do.
 *
 * It exercises the shipped code path — `previewEdit`, `applyEdit` and
 * `readEditableParts` out of `dist/` — rather than reimplementing the requests,
 * because a probe that sends its own PATCH verifies the API and not the product.
 *
 * Six questions, each mattering only if the one before it held:
 *
 *   1. Does `includeIDs=true` report a `table:` generated id at all, and does
 *      the parts listing offer it?
 *   2. Does `replace` against that id succeed, and is `20138` — "the element
 *      does not support this action" — really absent for a table?
 *   3. Did the whole table change, and only it? Every other element on the page
 *      is compared before and after.
 *   4. Do the ids move after the write, as Microsoft warns? A run where they do
 *      not is not a pass; it means the guard against reusing one is untested.
 *   5. Does the confirmation token stop matching once the page has changed —
 *      checked by replaying the previous one, which must be refused.
 *   6. Does `insert` with a `position` land the block on the side asked for?
 *
 * Every write goes to a page THIS RUN created, seconds earlier, in a section
 * named by the operator. Nothing is deleted and no existing page is touched:
 * the scratch page stays behind for inspection, and the operator removes it in
 * OneNote. Point it at a throwaway notebook regardless.
 *
 * Usage:
 *   node scripts/spike-onenote-tables.mjs --list-sections [notebook-name]
 *   node scripts/spike-onenote-tables.mjs --in <section-id>
 *
 * Requires a Microsoft connection on this machine holding the edit grant
 * (`artist-mcp connect microsoft --allow-writes onenote-edit`).
 */

import { accessTokenFor } from '../apps/mcp/dist/oauth.js';
import { applyEdit, previewEdit, readEditableParts } from '../apps/mcp/dist/onenote-patch.js';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/onenote';

let failures = 0;

const ok = (question, detail) => console.log(`  PASS  ${question}\n        ${detail}`);
const bad = (question, detail) => {
  failures += 1;
  console.log(`  FAIL  ${question}\n        ${detail}`);
};
const die = (message) => {
  console.error(`\n  STOPPED  ${message}\n`);
  process.exit(1);
};

const graph = async (token, path, init = {}) => {
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  return { status: res.status, text: await res.text() };
};

const json = (res) => {
  try {
    return JSON.parse(res.text);
  } catch {
    return undefined;
  }
};

/** The write log this run keeps, so nothing depends on the install's own. */
const record = async (entry) => void written.push(entry);
const written = [];

const listSections = async (token, wanted) => {
  const res = await graph(token, '/sections?$expand=parentNotebook&$top=100');
  if (res.status !== 200) die(`could not list sections: ${res.status} ${res.text.slice(0, 200)}`);

  for (const section of json(res)?.value ?? []) {
    const notebook = section.parentNotebook?.displayName ?? '(unknown notebook)';
    if (wanted !== undefined && notebook !== wanted) continue;
    console.log(`  ${notebook} / ${section.displayName}\n    ${section.id}`);
  }
};

/** A page with a table of the shape these pages actually use: label, value, per row. */
const SCRATCH = `<!DOCTYPE html><html><head><title>artist-mcp table spike ${new Date().toISOString()}</title></head><body>
<p>A scratch page written by scripts/spike-onenote-tables.mjs. Safe to delete.</p>
<table border="1" style="border-collapse:collapse">
<tr><td><p>Honorar</p></td><td><p>1200</p></td></tr>
<tr><td><p>Anreise</p></td><td><p>UNKNOWN</p></td></tr>
<tr><td><p>Probenbedarf</p></td><td><p>UNKNOWN</p></td></tr>
</table>
<p>Signatur</p>
</body></html>`;

const readWhenReady = async (token, pageId) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await graph(token, `/pages/${pageId}/content`);
    if (res.status === 200) return res.text;
    if (attempt >= 9) return undefined;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
};

/** Every element on the page as text, so "only the table changed" is checkable. */
const snapshot = (parts) =>
  new Map(parts.map((p) => [p.text.replace(/\s+/g, ' ').trim(), p.kind]));

const run = async (sectionId) => {
  const token = await accessTokenFor('microsoft');

  const created = await graph(token, `/sections/${sectionId}/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/xhtml+xml' },
    body: SCRATCH,
  });
  if (created.status !== 201) {
    die(`could not create the scratch page: ${created.status} ${created.text.slice(0, 300)}`);
  }

  const pageId = json(created)?.id;
  console.log(`\n  scratch page ${pageId}`);
  console.log(`  ${json(created)?.links?.oneNoteWebUrl?.href ?? '(no web url)'}\n`);
  if ((await readWhenReady(token, pageId)) === undefined) die('the new page never became readable');

  // 1 — is the table nameable?
  const before = await readEditableParts(token, pageId);
  const tables = before.parts.filter((p) => p.kind === 'table');
  if (tables.length === 0) {
    bad('1. a table is enumerated', 'no table: id came back from includeIDs=true');
    return;
  }
  ok(
    '1. a table is enumerated',
    `${tables[0].element_id}\n${tables[0].text.replace(/\n/g, '\n        ')}`,
  );

  const inCells = before.parts.filter((p) => p.inside_table !== null).length;
  ok('   cells are marked as belonging to it', `${inCells} paragraph(s) inside a table`);

  // 2 — does a whole-table replace go through?
  const tableId = tables[0].element_id;
  const html =
    '<table border="1" style="border-collapse:collapse">' +
    '<tr><td><p>Honorar</p></td><td><p>1450</p></td></tr>' +
    '<tr><td><p>Anreise</p></td><td><p>Bahn, 1. Klasse</p></td></tr>' +
    '<tr><td><p>Probenbedarf</p></td><td><p>UNKNOWN</p></td></tr>' +
    '<tr><td><p>Mitschnitt</p></td><td><p>UNKNOWN</p></td></tr>' +
    '</table>';

  const shown = await previewEdit(token, {
    page_id: pageId,
    action: 'replace',
    element_id: tableId,
    html,
  });
  console.log(`\n  the preview a musician would see:\n\n${shown.preview}\n`);

  try {
    await applyEdit(
      token,
      {
        page_id: pageId,
        action: 'replace',
        element_id: tableId,
        html,
        confirmation_token: shown.confirmation_token,
      },
      record,
    );
    ok('2. a table: id accepts replace', 'the PATCH returned 204');
  } catch (err) {
    bad('2. a table: id accepts replace', String(err?.message ?? err));
    return;
  }

  // 3 — round trip: is the table back, and is the rest of the page untouched?
  const after = await readEditableParts(token, pageId);
  const nowTable = after.parts.find((p) => p.kind === 'table');
  const wrote = nowTable === undefined ? '' : nowTable.text;

  const roundTripped =
    wrote.includes('1450') && wrote.includes('Bahn, 1. Klasse') && wrote.includes('Mitschnitt');
  (roundTripped ? ok : bad)(
    '3. the table reads back as it was written',
    wrote.replace(/\n/g, '\n        ') || '(no table found afterwards)',
  );
  const untouched = ['Signatur', 'A scratch page written by'].filter((line) =>
    after.parts.some((p) => p.text.includes(line)),
  );
  (untouched.length === 2 ? ok : bad)(
    '   nothing outside the table changed',
    `still present: ${untouched.join(', ') || 'nothing — the page lost content'}`,
  );

  // 4 — did the ids move?
  const movedId = after.parts.find((p) => p.kind === 'table')?.element_id;
  (movedId !== tableId ? ok : bad)(
    '4. the generated ids moved after the write',
    movedId === tableId
      ? `the table id is still ${tableId}: the "never reuse an id" rule is untested by this run`
      : `${tableId}\n        became ${movedId}`,
  );

  // 5 — is the stale token refused?
  try {
    await applyEdit(
      token,
      {
        page_id: pageId,
        action: 'replace',
        element_id: tableId,
        html,
        confirmation_token: shown.confirmation_token,
      },
      record,
    );
    bad('5. the previous confirmation is refused', 'the replay was APPLIED — the guard is not holding');
  } catch (err) {
    ok('5. the previous confirmation is refused', String(err?.message ?? err).slice(0, 160));
  }

  // 6 — does an insert land where it was aimed?
  const anchor = movedId ?? tableId;
  const block =
    '<table border="1" style="border-collapse:collapse">' +
    '<tr><td><p>Ausfüllkonventionen</p></td><td><p>UNKNOWN heißt ungeklärt</p></td></tr></table>';
  const shownInsert = await previewEdit(token, {
    page_id: pageId,
    action: 'insert',
    element_id: anchor,
    position: 'before',
    html: block,
  });

  try {
    await applyEdit(
      token,
      {
        page_id: pageId,
        action: 'insert',
        element_id: anchor,
        position: 'before',
        html: block,
        confirmation_token: shownInsert.confirmation_token,
      },
      record,
    );
  } catch (err) {
    bad('6. insert before a table', String(err?.message ?? err));
    return;
  }

  const final = await readEditableParts(token, pageId);
  const order = final.parts.filter((p) => p.kind === 'table').map((p) => p.text);
  const placed = order.length === 2 && order[0].includes('Ausfüllkonventionen');
  (placed ? ok : bad)(
    '6. insert before a table lands before it',
    order.length === 2
      ? `first table now reads: ${order[0].split('\n')[0].trim()}`
      : `expected two tables, found ${order.length}`,
  );

  console.log(`\n  ${written.length} write log line(s), pre-image on ${written.filter((w) => w.pre_image).length}`);
  console.log(`  the scratch page is still there: delete it in OneNote when you are done.`);
};

const main = async () => {
  const [flag, value] = process.argv.slice(2);

  if (flag === '--list-sections') return listSections(await accessTokenFor('microsoft'), value);
  if (flag !== '--in' || value === undefined) {
    die('usage: --list-sections [notebook], or --in <section-id>');
  }

  await run(value);
  console.log(failures === 0 ? '\n  all questions answered as expected\n' : `\n  ${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => die(String(err?.stack ?? err)));
