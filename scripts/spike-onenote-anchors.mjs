#!/usr/bin/env node
/**
 * Spike: what may a paragraph be replaced with, and what may an insert anchor
 * on?
 *
 * Our code refuses HTML on a paragraph replace and anchors `insert` on tables
 * only. Both are ours rather than OneNote's — or so the reference reads. This
 * record has caught that reference out four times now (`lastModifiedDateTime`,
 * the delete semantics, `Notes.ReadWrite.CreatedByApp` missing from the tables,
 * and `tr`/`td` supporting nothing), so the restriction is not lifted on the
 * strength of reading it again.
 *
 * Raw Graph on purpose. The question is what the API permits, and asking it
 * through our own validator would only tell us what our validator permits.
 *
 * Seven questions:
 *
 *   1. Does `replace` on a `p` accept HTML at all, rather than escaping it?
 *   2. Does it accept MULTI-element content — a paragraph, a heading and a
 *      table in one command? That is what makes "add a section between two
 *      paragraphs" a single call.
 *   3. What happens to a heading's formatting when it is replaced by a bare
 *      `<p>`? On these pages a heading is a `<p>` holding one styled `<span>`,
 *      so this is the borders failure again, one level down.
 *   4. Does `insert` anchor on a `p`?
 *   5. Does `insert` anchor on an `h2`, if OneNote keeps one at all?
 *   6. Does `insert` accept multi-element content?
 *   7. Does replacing a bordered table with a bare `<table>` drop the borders?
 *
 * Every write goes to a page THIS RUN created, seconds earlier, in a section
 * named by the operator. Nothing is deleted and nothing existing is touched.
 * The page stays behind for inspection.
 *
 * Usage:
 *   node scripts/spike-onenote-anchors.mjs --in <section-id>
 */

import { accessTokenFor } from '../apps/mcp/dist/oauth.js';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/onenote';

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

/** The page as it stands, with the generated ids that address it. */
const content = async (token, pageId) =>
  (await graph(token, `/pages/${pageId}/content?includeIDs=true`)).text;

const idsOf = (html, tag) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*\\sid="([^"]+)"`, 'g'))].map((m) => m[1]);

const patch = async (token, pageId, command) => {
  const res = await fetch(`${GRAPH}/pages/${encodeURIComponent(pageId)}/content`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify([command]),
  });
  const text = res.status === 204 ? '' : (await res.text()).slice(0, 300);
  return { status: res.status, text };
};

/** A page shaped like the ones this is for: intro, heading, table, closing line. */
const SCRATCH = `<!DOCTYPE html><html><head><title>artist-mcp anchor spike ${new Date().toISOString()}</title></head><body>
<p><span style="font-size:9.5pt;color:#555555">Intro line, small and grey. Safe to delete.</span></p>
<p><span style="font-size:12.5pt;color:black;font-weight:bold">Projektzustand</span></p>
<table border="1" style="border-collapse:collapse;border:1pt solid #a3a3a3">
<tr><td><p>Honorar</p></td><td><p>1200</p></td></tr>
<tr><td><p>Anreise</p></td><td><p>UNKNOWN</p></td></tr>
</table>
<p>Signatur</p>
</body></html>`;

const report = (n, question, verdict, detail) =>
  console.log(`\n  ${n}. ${question}\n     ${verdict}\n     ${detail}`);

const run = async (sectionId) => {
  const token = await accessTokenFor('microsoft');

  const created = await graph(token, `/sections/${sectionId}/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/xhtml+xml' },
    body: SCRATCH,
  });
  if (created.status !== 201) die(`could not create the page: ${created.status} ${created.text.slice(0, 300)}`);

  const pageId = json(created)?.id;
  console.log(`\n  scratch page ${pageId}`);

  // Wait for it to be readable.
  let html = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    html = await content(token, pageId);
    if (html.startsWith('<html')) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  if (!html.startsWith('<html')) die('the page never became readable');

  console.log(`  headings kept as h1-h6: ${idsOf(html, 'h[1-6]').length}`);

  // 1 + 2 — a paragraph replaced by three elements at once.
  let paragraphs = idsOf(html, 'p');
  const intro = paragraphs[0];
  const multi =
    '<p><span style="font-size:9.5pt;color:#555555">Intro line, small and grey. Safe to delete.</span></p>' +
    '<p><span style="font-size:12.5pt;color:black;font-weight:bold">Ausfüllkonventionen</span></p>' +
    '<table border="1" style="border-collapse:collapse;border:1pt solid #a3a3a3">' +
    '<tr><td><p>UNKNOWN</p></td><td><p>heißt ungeklärt</p></td></tr></table>';

  const r1 = await patch(token, pageId, { target: intro, action: 'replace', content: multi });
  html = await content(token, pageId);
  report(
    1,
    'replace on a p accepts HTML, and multi-element content',
    r1.status === 204 ? 'ACCEPTED' : `REFUSED ${r1.status}`,
    r1.status === 204
      ? `the page now holds ${idsOf(html, 'table').length} table(s) and ` +
        `${idsOf(html, 'p').length} paragraph(s); "Ausfüllkonventionen" present: ` +
        `${html.includes('Ausfüllkonventionen')}`
      : r1.text,
  );
  report(
    2,
    'the markup was interpreted rather than escaped',
    html.includes('&lt;p&gt;') ? 'ESCAPED — it is not HTML' : 'INTERPRETED',
    html.includes('Ausfüllkonventionen')
      ? 'the new heading is a real element on the page'
      : 'the new content is not there at all',
  );

  // 3 — a styled heading replaced by a bare paragraph.
  paragraphs = idsOf(html, 'p');
  const heading = paragraphs.find((id) => {
    const at = html.indexOf(`id="${id}"`);
    return html.slice(at, at + 400).includes('font-weight:bold');
  });
  if (heading === undefined) {
    report(3, 'a bare replace of a styled heading', 'NOT TESTED', 'no styled heading found');
  } else {
    const r3 = await patch(token, pageId, {
      target: heading,
      action: 'replace',
      content: '<p>Projektzustand</p>',
    });
    html = await content(token, pageId);
    const survived = html.includes('font-weight:bold');
    report(
      3,
      'a styled heading replaced by a bare <p> keeps its formatting',
      survived ? 'STYLE SURVIVED SOMEWHERE' : 'STYLE LOST',
      survived
        ? 'bold is still present on the page — check which element carries it'
        : 'the heading is now ordinary body text: the caller must carry the span across',
    );
  }

  // 4 — insert anchored on a paragraph.
  paragraphs = idsOf(html, 'p');
  const last = paragraphs[paragraphs.length - 1];
  const r4 = await patch(token, pageId, {
    target: last,
    action: 'insert',
    position: 'before',
    content: '<p>INSERTED BEFORE A PARAGRAPH</p>',
  });
  html = await content(token, pageId);
  report(
    4,
    'insert anchors on a p',
    r4.status === 204 ? 'ACCEPTED' : `REFUSED ${r4.status}`,
    r4.status === 204
      ? `landed before its anchor: ${
          html.indexOf('INSERTED BEFORE A PARAGRAPH') < html.indexOf(`id="${last}"`)
        }`
      : r4.text,
  );

  // 5 — insert anchored on a heading element, if OneNote kept one.
  const headings = idsOf(html, 'h[1-6]');
  if (headings.length === 0) {
    report(
      5,
      'insert anchors on an h1-h6',
      'NOT TESTABLE',
      'OneNote keeps no h1-h6 on these pages: a heading is a p holding a styled span, ' +
        'so question 4 is the one that matters',
    );
  } else {
    const r5 = await patch(token, pageId, {
      target: headings[0],
      action: 'insert',
      position: 'after',
      content: '<p>INSERTED AFTER A HEADING</p>',
    });
    report(5, 'insert anchors on an h1-h6', r5.status === 204 ? 'ACCEPTED' : `REFUSED ${r5.status}`, r5.text);
  }

  // 6 — multi-element insert.
  paragraphs = idsOf(html, 'p');
  const r6 = await patch(token, pageId, {
    target: paragraphs[paragraphs.length - 1],
    action: 'insert',
    position: 'after',
    content:
      '<p><span style="font-size:12.5pt;color:black;font-weight:bold">Mitschnitt</span></p>' +
      '<table border="1" style="border-collapse:collapse"><tr><td><p>UNKNOWN</p></td></tr></table>',
  });
  html = await content(token, pageId);
  report(
    6,
    'insert accepts a heading and a table in one command',
    r6.status === 204 ? 'ACCEPTED' : `REFUSED ${r6.status}`,
    r6.status === 204
      ? `"Mitschnitt" present: ${html.includes('Mitschnitt')}, tables now: ${idsOf(html, 'table').length}`
      : r6.text,
  );

  // 7 — a bordered table replaced by a bare one.
  const tables = idsOf(html, 'table');
  const bordered = tables.find((id) => {
    const at = html.indexOf(`id="${id}"`);
    return html.slice(Math.max(0, at - 200), at + 200).includes('border="1"');
  });
  if (bordered === undefined) {
    report(7, 'a bare table replace keeps borders', 'NOT TESTED', 'no bordered table found');
  } else {
    const r7 = await patch(token, pageId, {
      target: bordered,
      action: 'replace',
      content: '<table><tr><td><p>Honorar</p></td><td><p>1450</p></td></tr></table>',
    });
    html = await content(token, pageId);
    const at = html.indexOf('1450');
    const around = html.slice(Math.max(0, at - 600), at);
    report(
      7,
      'a bordered table replaced by a bare <table> keeps its borders',
      around.includes('border="1"') || around.includes('1pt solid') ? 'BORDERS SURVIVED' : 'BORDERS LOST',
      r7.status === 204
        ? 'the caller has to carry the table attributes across, or we inherit them for it'
        : `${r7.status} ${r7.text}`,
    );
  }

  console.log(`\n  the scratch page is still there: delete it in OneNote when you are done.\n`);
};

const [flag, value] = process.argv.slice(2);
if (flag !== '--in' || value === undefined) die('usage: --in <section-id>');
run(value).catch((err) => die(String(err?.stack ?? err)));
