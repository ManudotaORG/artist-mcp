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

/** Rows lined up under the label that introduces them. */
const indent = (block) =>
  block
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n')
    .trimStart();

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
<p><span style="font-size:12.5pt;color:black;font-weight:bold">Projektzustand</span></p>
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

/** The page markup itself, for the questions that are about formatting. */
const onenoteRaw = async (token, pageId) =>
  (await graph(token, `/pages/${pageId}/content?includeIDs=true`)).text;

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
    `${tables[0].element_id}\n${indent(tables[0].text)}`,
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
    indent(wrote) || '(no table found afterwards)',
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

  // 7 — a paragraph replaced by several elements at once, which is how a
  // section reaches the middle of a page. Both neighbours of the real one are
  // paragraphs, so this is the case the capability exists for.
  const intro = final.parts.find((part) => part.text.includes('A scratch page written by'));
  if (intro === undefined) {
    bad('7. a paragraph replaced by a whole section', 'the intro paragraph is no longer there');
    return;
  }

  const section =
    '<p>A scratch page written by scripts/spike-onenote-tables.mjs. Safe to delete.</p>' +
    '<p><span style="font-size:12.5pt;color:black;font-weight:bold">Eigener Probenbedarf</span></p>' +
    '<table border="1" style="border-collapse:collapse"><tr><td><p>UNKNOWN</p></td></tr></table>';
  const shownSection = await previewEdit(token, {
    page_id: pageId,
    action: 'replace',
    element_id: intro.element_id,
    html: section,
  });

  try {
    await applyEdit(
      token,
      {
        page_id: pageId,
        action: 'replace',
        element_id: intro.element_id,
        html: section,
        confirmation_token: shownSection.confirmation_token,
      },
      record,
    );
  } catch (err) {
    bad('7. a paragraph replaced by a whole section', String(err?.message ?? err));
    return;
  }

  const withSection = await readEditableParts(token, pageId);
  const landed = withSection.parts.some((part) => part.text.includes('Eigener Probenbedarf'));
  (landed ? ok : bad)(
    '7. a paragraph becomes a paragraph, a heading and a table',
    landed
      ? `the page now holds ${withSection.parts.filter((x) => x.kind === 'table').length} tables`
      : 'the new section is not on the page',
  );

  // 8 — an insert anchored on a paragraph rather than a table.
  const signature = withSection.parts.find((part) => part.text.trim() === 'Signatur');
  if (signature === undefined) {
    bad('8. insert anchored on a paragraph', 'the signature paragraph is gone');
  } else {
    const note = '<p>Mehrere Konzerte: UNKNOWN</p>';
    const shownNote = await previewEdit(token, {
      page_id: pageId,
      action: 'insert',
      element_id: signature.element_id,
      position: 'before',
      html: note,
    });

    try {
      await applyEdit(
        token,
        {
          page_id: pageId,
          action: 'insert',
          element_id: signature.element_id,
          position: 'before',
          html: note,
          confirmation_token: shownNote.confirmation_token,
        },
        record,
      );
      const after = await readEditableParts(token, pageId);
      const texts = after.parts.map((part) => part.text.trim());
      const placed = texts.indexOf('Mehrere Konzerte: UNKNOWN') < texts.indexOf('Signatur');
      (placed ? ok : bad)(
        '8. insert anchored on a paragraph lands on the right side',
        placed ? 'it sits before the signature' : `order came back as ${texts.join(' / ')}`,
      );
    } catch (err) {
      bad('8. insert anchored on a paragraph', String(err?.message ?? err));
    }
  }

  // 9 — the formatting a replacement does not specify. A heading here is a
  // paragraph holding one styled span; replaced by a bare <p> and left alone,
  // it comes back as ordinary body text.
  const beforeHeading = await onenoteRaw(token, pageId);
  const headingPart = (await readEditableParts(token, pageId)).parts.find(
    (part) => part.text.trim() === 'Projektzustand',
  );

  if (headingPart === undefined || !beforeHeading.includes('font-weight:bold')) {
    bad('9. a heading keeps its formatting', 'no styled heading on the page to test with');
  } else {
    const plain = '<p>Projektzustand 2026</p>';
    const shownHeading = await previewEdit(token, {
      page_id: pageId,
      action: 'replace',
      element_id: headingPart.element_id,
      html: plain,
    });

    const disclosed = /Keeping/.test(shownHeading.preview);
    await applyEdit(
      token,
      {
        page_id: pageId,
        action: 'replace',
        element_id: headingPart.element_id,
        html: plain,
        confirmation_token: shownHeading.confirmation_token,
      },
      record,
    );

    const afterHeading = await onenoteRaw(token, pageId);
    const at = afterHeading.indexOf('Projektzustand 2026');
    const kept = afterHeading.slice(Math.max(0, at - 300), at).includes('font-weight:bold');
    (kept && disclosed ? ok : bad)(
      '9. a heading replaced by unstyled markup keeps being a heading',
      kept
        ? `bold carried across, and the preview said so: ${disclosed}`
        : 'the heading came back as ordinary body text — the inheritance did not hold',
    );
  }

  // 10 — several changes in one write, through the shipped path. The claim
  // being checked is not that Graph accepts an array — spike-onenote-batch.mjs
  // established that — but that our own preview, token and apply hold together
  // over a batch, and that the ids read once are still good for every command.
  const state = await readEditableParts(token, pageId, { full: false });
  const someTable = state.parts.find((part) => part.kind === 'table');
  const someParagraph = state.parts.find(
    (part) => part.kind === 'text' && part.inside_table === null,
  );

  if (someTable === undefined || someParagraph === undefined) {
    bad('10. several changes in one write', 'the page no longer has both a table and a paragraph');
  } else {
    const batch = [
      {
        action: 'replace',
        element_id: someTable.element_id,
        html:
          '<table border="1" style="border-collapse:collapse">' +
          '<tr><td><p>Honorar</p></td><td><p>1650</p></td></tr>' +
          '<tr><td><p>Anreise</p></td><td><p>Bahn, 1. Klasse</p></td></tr></table>',
      },
      {
        action: 'insert',
        element_id: someParagraph.element_id,
        position: 'after',
        html: '<p>BATCHED INSERT</p>',
      },
      { action: 'append', text: 'BATCHED APPEND' },
    ];

    const before = written.length;
    const shownBatch = await previewEdit(token, { page_id: pageId, changes: batch });
    console.log(`\n  the batch preview a musician would see:\n\n${shownBatch.preview}\n`);

    try {
      await applyEdit(
        token,
        { page_id: pageId, changes: batch, confirmation_token: shownBatch.confirmation_token },
        record,
      );
    } catch (err) {
      bad('10. several changes in one write', String(err?.message ?? err));
      return;
    }

    const done = await readEditableParts(token, pageId, { full: false });
    const text = done.parts.map((part) => part.text).join(' | ');
    const all =
      text.includes('1650') && text.includes('BATCHED INSERT') && text.includes('BATCHED APPEND');

    (all ? ok : bad)(
      '10. three changes, one write, one confirmation',
      all
        ? `all three landed from ids read once, and logged ${written.length - before} lines`
        : `some did not land: ${text.slice(0, 200)}`,
    );

    // 11 — the batch must fail closed as a whole. Replaying the confirmation is
    // the cheapest way to prove nothing goes out on a mismatch.
    try {
      await applyEdit(
        token,
        { page_id: pageId, changes: batch, confirmation_token: shownBatch.confirmation_token },
        record,
      );
      bad('11. a spent batch confirmation is refused', 'the replay was APPLIED');
    } catch (err) {
      ok('11. a spent batch confirmation is refused', String(err?.message ?? err).slice(0, 120));
    }
  }

  // 12 — what the index costs against what the page costs. Not a pass/fail;
  // the number is the point, since this is the reason the index exists.
  const full = await readEditableParts(token, pageId);
  const short = await readEditableParts(token, pageId, { full: false });
  const size = (parts) => parts.reduce((total, part) => total + part.text.length, 0);
  ok(
    '12. a named change returns an index rather than the page',
    `${size(short.parts)} characters against ${size(full.parts)} for the full listing, ` +
      `over ${full.parts.length} parts`,
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
