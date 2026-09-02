#!/usr/bin/env node
/**
 * Copy a OneNote page so that artist-mcp owns the copy.
 *
 * A page a person wrote can never be edited by this tool: Microsoft refuses it
 * with `401 40003` on the strength of `createdByAppId`, before any of our code
 * runs. That is the boundary docs/decisions/0004-onenote-page-maintenance.md
 * depends on, and it is not negotiable per page. The only way a filled-in
 * template becomes maintainable is for this app to have created it.
 *
 * So this copies the page's own HTML, byte for byte, into a new page. Not
 * through `create_onenote_page`, whose body is plain text on purpose — a model
 * composing a page from an email is passing through text it did not author, so
 * `onenote-write.ts` escapes all of it. Sending these pages through that path
 * would flatten every bordered table into a column of loose lines and hand back
 * ownership at the cost of the document.
 *
 * This is maintenance tooling, not a capability. It is deliberately not a tool:
 * a model never calls it, it copies rather than composes, and the HTML it sends
 * came out of the user's own notebook a second earlier rather than out of a
 * model. Those three together are why it may do what the tool surface may not.
 *
 * It never deletes. The original stays exactly where it was, which also means
 * the notebook holds two records of one event until someone removes it by hand
 * — see `policy:divergence`, and do that before working from either.
 *
 * Usage:
 *   node scripts/copy-onenote-page.mjs --list-sections [notebook-name]
 *   node scripts/copy-onenote-page.mjs --to <section-id> <page-id> [<page-id>...]
 *   node scripts/copy-onenote-page.mjs --to <section-id> --dry-run <page-id>
 */

import { accessTokenFor } from '../apps/mcp/dist/oauth.js';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/onenote';

const die = (message) => {
  console.error(`\n  FAILED  ${message}\n`);
  process.exit(1);
};

const graph = async (token, path, init = {}) => {
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  return { status: res.status, text: await res.text(), headers: res.headers };
};

const json = (res) => {
  try {
    return JSON.parse(res.text);
  } catch {
    return undefined;
  }
};

/**
 * Anything the copy cannot carry.
 *
 * OneNote serves attachments and images from resource URLs that need an
 * authorization header, and a create will not fetch them: the reference is
 * explicit that an image "must be part of the request". So a copied page would
 * come back missing the rider, the contract or the stage plan while looking
 * complete — a page that is quietly less than the one it replaced is worse than
 * a refusal, because the refusal is visible.
 */
const unportable = (html) => {
  const found = [];
  if (/<img\b/i.test(html)) found.push('images');
  if (/<object\b/i.test(html)) found.push('file attachments');
  return found;
};

/**
 * Put the table borders back, because a create silently removes them.
 *
 * OneNote's *output* HTML expresses a bordered table as
 * `<table style="border:1px solid;border-collapse:collapse">`, and its *input*
 * parser throws that away — a page copied verbatim comes back with
 * `border:0px` on every table and cell. The text is identical, so nothing that
 * reads the page as text can detect it; it is visible only by looking at the
 * page, which is how it was found.
 *
 * Probed against a real notebook rather than guessed, three syntaxes at once:
 *
 *   style="border:1px solid"                        stripped to border:0px
 *   border="1"  (the attribute)                     SURVIVES
 *   border-style/-width/-color longhand             stripped to border:0px
 *
 * The attribute is honoured and OneNote regenerates the style from it, on the
 * table and on every cell. It coexists with the style already present, and
 * cell background colours survive alongside it.
 *
 * Only tables that were visibly bordered get the attribute: a table whose style
 * says `border:0px` was borderless in the original and stays that way.
 */
const preserveTableBorders = (html) =>
  html.replace(/<table\b([^>]*)>/gi, (tag, attrs) => {
    if (/\bborder\s*=/.test(attrs)) return tag;
    const bordered = /border\s*:\s*(?!0)(\d*\.?\d+)\s*(px|pt|em)?\s+solid/i.test(attrs);
    return bordered ? `<table border="1"${attrs}>` : tag;
  });

const titleOf = (html) => html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '(untitled)';

const listSections = async (token, wantedNotebook) => {
  const res = await graph(token, '/sections?$expand=parentNotebook&$top=200');
  if (res.status !== 200) die(`listing sections: ${res.status} ${res.text.slice(0, 300)}`);

  const sections = (json(res)?.value ?? []).filter(
    (s) =>
      wantedNotebook === undefined ||
      (s.parentNotebook?.displayName ?? '').toLowerCase() === wantedNotebook.toLowerCase(),
  );

  if (sections.length === 0) die(`no sections found${wantedNotebook ? ` in "${wantedNotebook}"` : ''}.`);

  console.log(`\n${sections.length} section(s):\n`);
  for (const s of sections) {
    console.log(`  ${s.parentNotebook?.displayName ?? '(unknown notebook)'} / ${s.displayName}`);
    console.log(`    ${s.id}\n`);
  }
};

/**
 * Read a page back until OneNote admits it exists.
 *
 * A create returns the new page's id before the page is readable — a 201
 * followed by 404 20102. Observed intermittently while probing the patch API,
 * so it is a race rather than a fixed delay, and a copy that reports success
 * without confirming the page is there is reporting the id rather than the page.
 */
const readWhenReady = async (token, pageId) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await graph(token, `/pages/${pageId}/content`);
    if (res.status === 200) return res.text;
    const missing = res.status === 404 && json(res)?.error?.code === '20102';
    if (!missing || attempt >= 9) return undefined;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
};

const copyPage = async (token, sectionId, pageId, { dryRun }) => {
  const source = await graph(token, `/pages/${pageId}/content`);
  if (source.status !== 200) {
    console.log(`  SKIP   ${pageId}\n         could not read it: ${source.status} ${source.text.slice(0, 160)}`);
    return { ok: false };
  }

  const html = preserveTableBorders(source.text);
  const title = titleOf(html);
  const blockers = unportable(html);

  if (blockers.length > 0) {
    // Refused rather than copied-without. See `unportable`.
    console.log(`  SKIP   "${title}"`);
    console.log(`         carries ${blockers.join(' and ')}, which a copy cannot bring across.`);
    console.log('         Recreate this one by hand, or accept the loss knowingly.');
    return { ok: false, skipped: true };
  }

  if (dryRun) {
    const borders = (html.match(/<table border="1"/g) ?? []).length;
    console.log(
      `  would copy "${title}" (${html.length} characters, no attachments, ` +
        `${borders} bordered table(s) preserved)`,
    );
    return { ok: true, dryRun: true };
  }

  const created = await graph(token, `/sections/${sectionId}/pages`, {
    method: 'POST',
    // The page as OneNote gave it to us. Not JSON: OneNote takes an XHTML
    // document, and sending JSON is answered with a 400 that names neither
    // problem.
    headers: { 'content-type': 'application/xhtml+xml' },
    body: html,
  });

  if (created.status !== 201) {
    console.log(`  FAIL   "${title}"\n         ${created.status} ${created.text.slice(0, 200)}`);
    return { ok: false };
  }

  const body = json(created) ?? {};
  const readable = await readWhenReady(token, body.id);

  console.log(`  copied "${title}"`);
  console.log(`         from ${pageId}`);
  console.log(`         to   ${body.id}`);
  console.log(`         appId ${body.createdByAppId ?? '(none reported)'}`);
  console.log(
    readable === undefined
      ? '         NOT yet readable — the page exists; check it in OneNote before relying on it'
      : `         readable, ${readable.length} characters`,
  );

  return { ok: true, id: body.id, title };
};

/**
 * Everything a copy could quietly lose, compared against the original.
 *
 * Written after a copy was declared faithful on the strength of `read_note`
 * output matching. That comparison could not have failed: `read_note` renders
 * a page as text, so it flattens a table to lines whether or not the table
 * survived, and the missing borders were found by a person looking at the page
 * instead. A check that cannot distinguish the failure it is looking for is
 * worse than no check, because it is reported as a pass.
 *
 * So this compares the markup: the words, and the structure that carries them.
 */
const shape = (html) => {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const tables = [...html.matchAll(/<table[^>]*>/gi)].map((m) => m[0]);

  return {
    text,
    words: text.split(' ').length,
    tables: tables.length,
    // A border that reads as 0px is a table that lost its lines — the exact
    // regression this whole verification exists for.
    borderedTables: tables.filter((t) => /border[:="]/.test(t) && !/border:\s*0/.test(t)).length,
    rows: (html.match(/<tr\b/gi) ?? []).length,
    cells: (html.match(/<td\b/gi) ?? []).length,
  };
};

const verify = async (token, sourceSection, targetSection) => {
  const pagesIn = async (id) => {
    const res = await graph(
      token,
      `/sections/${encodeURIComponent(id)}/pages?$top=100&$select=id,title,createdByAppId`,
    );
    if (res.status !== 200) die(`listing pages: ${res.status} ${res.text.slice(0, 200)}`);
    return json(res)?.value ?? [];
  };

  const originals = await pagesIn(sourceSection);
  const copies = await pagesIn(targetSection);
  const byTitle = new Map(copies.map((c) => [c.title, c]));

  let checked = 0;
  const problems = [];

  for (const original of originals) {
    const copy = byTitle.get(original.title);
    if (copy === undefined) continue;

    const a = await graph(token, `/pages/${encodeURIComponent(original.id)}/content`);
    const c = await graph(token, `/pages/${encodeURIComponent(copy.id)}/content`);
    // Status checked before the body is read as HTML: an error body contains
    // none of the markers, so it compares as catastrophic loss.
    if (a.status !== 200 || c.status !== 200) {
      problems.push(`${original.title}: could not read (${a.status}/${c.status})`);
      continue;
    }

    const before = shape(a.text);
    const after = shape(c.text);
    checked += 1;

    const differences = [];
    if (before.text !== after.text) {
      const at = [...before.text].findIndex((ch, i) => ch !== after.text[i]);
      differences.push(
        `text differs at character ${at}: ` +
          `"…${before.text.slice(Math.max(0, at - 40), at + 40)}…" vs ` +
          `"…${after.text.slice(Math.max(0, at - 40), at + 40)}…"`,
      );
    }
    for (const key of ['tables', 'borderedTables', 'rows', 'cells']) {
      if (before[key] !== after[key]) differences.push(`${key}: ${before[key]} → ${after[key]}`);
    }
    if (!copy.createdByAppId) differences.push('the copy has no createdByAppId, so it is not editable');

    console.log(
      differences.length === 0
        ? `  ok    ${original.title}  (${before.words} words, ${before.tables} tables, ${before.cells} cells)`
        : `  DIFF  ${original.title}\n          ${differences.join('\n          ')}`,
    );
    if (differences.length > 0) problems.push(original.title);
  }

  console.log(`\n${checked} pair(s) compared, ${problems.length} with differences.`);
  const missing = originals.filter((o) => !byTitle.has(o.title));
  if (missing.length > 0) {
    console.log(`\n${missing.length} original(s) with no copy of that title:`);
    for (const m of missing) console.log(`  ${m.title || '(untitled)'}`);
  }
};

const main = async () => {
  const argv = process.argv.slice(2);
  const token = await accessTokenFor('microsoft').catch((err) => die(err.message));

  if (argv[0] === '--list-sections') {
    await listSections(token, argv[1]);
    return;
  }

  // Ids are transcribed by hand otherwise, twenty of them, which is a way to
  // copy the wrong page while believing otherwise.
  if (argv[0] === '--list-pages') {
    const sectionId = argv[1];
    if (!sectionId) die('--list-pages needs a section id.');
    const res = await graph(
      token,
      `/sections/${encodeURIComponent(sectionId)}/pages?$top=100&$select=id,title,createdByAppId`,
    );
    if (res.status !== 200) die(`listing pages: ${res.status} ${res.text.slice(0, 300)}`);
    const pages = json(res)?.value ?? [];
    console.log(`\n${pages.length} page(s):\n`);
    for (const page of pages) {
      // The raw value, not a verdict. An empty createdByAppId means a person
      // wrote it — the page that can never be edited, and therefore the one
      // worth copying. A non-empty one means *some* app and not necessarily
      // this one, so "app-created" would be the unsound check 0003 warns
      // about: only equality against our own known value says anything.
      const owner = page.createdByAppId || 'handmade';
      console.log(`  ${page.title || '(untitled)'}  [${owner}]`);
      console.log(`    ${page.id}`);
    }
    return;
  }

  if (argv[0] === '--verify') {
    if (!argv[1] || !argv[2]) die('--verify needs <source-section-id> <target-section-id>.');
    console.log('\nComparing every copy against its original, by markup rather than by text.\n');
    await verify(token, argv[1], argv[2]);
    return;
  }

  const at = argv.indexOf('--to');
  const sectionId = at === -1 ? undefined : argv[at + 1];
  const dryRun = argv.includes('--dry-run');
  const pages = argv.filter((a, i) => !a.startsWith('--') && i !== at + 1);

  if (!sectionId || pages.length === 0) {
    console.error('\nUsage:');
    console.error('  node scripts/copy-onenote-page.mjs --list-sections [notebook-name]');
    console.error('  node scripts/copy-onenote-page.mjs --to <section-id> [--dry-run] <page-id>...\n');
    process.exit(1);
  }

  console.log(`\nCopying ${pages.length} page(s)${dryRun ? ' — DRY RUN, nothing is written' : ''}`);
  console.log('The originals are never touched, and never deleted.\n');

  const results = [];
  for (const pageId of pages) {
    results.push(await copyPage(token, sectionId, pageId, { dryRun }));
  }

  const copied = results.filter((r) => r.ok && !r.dryRun).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok && !r.skipped).length;

  console.log(`\n${copied} copied, ${skipped} skipped, ${failed} failed.`);
  if (copied > 0) {
    console.log(
      '\nThe notebook now holds two records of each copied page. Check each copy,\n' +
        'then remove the original in OneNote yourself — this script cannot, and\n' +
        'until you do, any answer about those events has to name which page it read.',
    );
  }
};

main().catch((err) => die(err.stack ?? err.message));
