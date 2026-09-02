#!/usr/bin/env node
/**
 * Spike: can several changes ride in one PATCH, and what happens when one of
 * them is wrong?
 *
 * The reasoning for batching is that generated ids move *after* a write, so a
 * batch resolved against one read has no id churn in it. That is plausible and
 * it is not established: it depends on Graph resolving every target in the array
 * against the document as it was read, rather than against the document as the
 * earlier commands in the same array have left it. Those two behaviours are
 * indistinguishable until a batch's first command changes the element a later
 * command names.
 *
 * The second question matters more than the first. One confirmation token would
 * cover N destructive changes, so the failure mode to understand before building
 * it is the partial one: if command 2 cannot be applied, has command 1 already
 * landed? A batch that half-applies is not a smaller version of a batch that
 * works — it is a page in a state nobody previewed and nobody approved.
 *
 * Four questions:
 *
 *   1. Do three commands read from one page state all land, in order?
 *   2. Does a later command still resolve a target that an earlier command in
 *      the same batch has already rewritten past?
 *   3. When one command in the middle has a target that cannot resolve, do the
 *      others apply anyway? (all-or-nothing, or partial)
 *   4. Can a command target an element that an earlier command in the same batch
 *      created?
 *
 * Every write goes to a page THIS RUN created, seconds earlier, in a section
 * named by the operator. Nothing existing is touched and nothing is deleted.
 *
 * Usage:
 *   node scripts/spike-onenote-batch.mjs --in <section-id>
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

const report = (n, question, verdict, detail) =>
  console.log(`\n  ${n}. ${question}\n     ${verdict}\n     ${detail}`);

const SCRATCH = (n) => `<!DOCTYPE html><html><head><title>artist-mcp batch spike ${n}</title></head><body>
<p>Intro line. Safe to delete.</p>
<p><span style="font-size:12.5pt;color:black;font-weight:bold">Projektzustand</span></p>
<table border="1" style="border-collapse:collapse">
<tr><td><p>Honorar</p></td><td><p>1200</p></td></tr>
<tr><td><p>Anreise</p></td><td><p>UNKNOWN</p></td></tr>
</table>
<p>Signatur</p>
</body></html>`;

const makePage = async (token, sectionId, label) => {
  const created = await graph(token, `/sections/${sectionId}/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/xhtml+xml' },
    body: SCRATCH(label),
  });
  if (created.status !== 201) die(`could not create a page: ${created.status} ${created.text.slice(0, 200)}`);
  const id = JSON.parse(created.text).id;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await graph(token, `/pages/${id}/content?includeIDs=true`);
    if (res.status === 200 && res.text.startsWith('<html')) return { id, html: res.text };
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  die('a page never became readable');
};

const read = async (token, id) => {
  // OneNote is eventually consistent; a read straight after a PATCH can serve
  // the previous version, which is what made an earlier probe contradict itself.
  await new Promise((r) => setTimeout(r, 3000));
  return (await graph(token, `/pages/${id}/content?includeIDs=true`)).text;
};

const patch = async (token, id, commands) => {
  const res = await fetch(`${GRAPH}/pages/${encodeURIComponent(id)}/content`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  return { status: res.status, text: res.status === 204 ? '' : (await res.text()).slice(0, 400) };
};

const idsOf = (html, tag) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*\\sid="([^"]+)"`, 'g'))].map((m) => m[1]);

const run = async (sectionId) => {
  const token = await accessTokenFor('microsoft');

  // 1 + 2 — three commands from one read, one of which names an element that an
  // earlier command in the same batch has rewritten past.
  {
    const { id, html } = await makePage(token, sectionId, 'ordered');
    // OneNote strips the <p> inside a table cell, so the page's paragraphs are
    // exactly the three outside the table: intro, heading, signature.
    const paragraphs = idsOf(html, 'p');
    const intro = paragraphs[0];
    const signature = paragraphs[paragraphs.length - 1];
    if (paragraphs.length < 3) die(`expected three paragraphs, found ${paragraphs.length}`);
    const [table] = idsOf(html, 'table');

    const result = await patch(token, id, [
      { target: intro, action: 'replace', content: '<p>Intro line, corrected.</p>' },
      {
        target: table,
        action: 'replace',
        content:
          '<table border="1" style="border-collapse:collapse">' +
          '<tr><td><p>Honorar</p></td><td><p>1450</p></td></tr>' +
          '<tr><td><p>Anreise</p></td><td><p>Bahn</p></td></tr></table>',
      },
      { target: signature, action: 'insert', position: 'before', content: '<p>Mitschnitt: UNKNOWN</p>' },
    ]);

    const after = await read(token, id);
    const all =
      after.includes('Intro line, corrected.') &&
      after.includes('1450') &&
      after.includes('Mitschnitt: UNKNOWN');

    report(
      1,
      'three commands from one read all land',
      result.status === 204 && all ? 'ALL APPLIED' : `PARTIAL OR REFUSED (${result.status})`,
      result.status === 204
        ? `intro: ${after.includes('Intro line, corrected.')}, table: ${after.includes('1450')}, ` +
          `insert: ${after.includes('Mitschnitt: UNKNOWN')}`
        : result.text,
    );
    report(
      2,
      'a target read before the batch resolves even after earlier commands ran',
      all ? 'RESOLVED' : 'DID NOT RESOLVE',
      all
        ? 'ids are resolved against the page as read, so one read is enough for a whole batch'
        : 'a later command lost its target — a batch would need re-reading between commands, ' +
          'which is what batching was meant to avoid',
    );
    console.log(`     page ${id}`);
  }

  // 3 — one bad target in the middle. THE question: is a batch atomic?
  {
    const { id, html } = await makePage(token, sectionId, 'partial');
    const [intro] = idsOf(html, 'p');
    const [table] = idsOf(html, 'table');
    // A well-formed generated id that names nothing on this page.
    const ghost = table.replace(/\{(\d+)\}$/, (_, n) => `{${Number(n) + 900}}`);

    const result = await patch(token, id, [
      { target: intro, action: 'replace', content: '<p>FIRST COMMAND LANDED</p>' },
      { target: ghost, action: 'replace', content: '<table><tr><td><p>never</p></td></tr></table>' },
      { target: table, action: 'replace', content: '<table><tr><td><p>THIRD COMMAND LANDED</p></td></tr></table>' },
    ]);

    const after = await read(token, id);
    const first = after.includes('FIRST COMMAND LANDED');
    const third = after.includes('THIRD COMMAND LANDED');

    report(
      3,
      'a batch with one unresolvable target — all or nothing?',
      first || third ? 'PARTIAL: the good commands applied' : 'ATOMIC: nothing applied',
      `status ${result.status}; first landed: ${first}, third landed: ${third}\n     ` +
        (result.text ? `body: ${result.text.replace(/\s+/g, ' ').slice(0, 240)}` : '(204, no body)'),
    );
    console.log(`     page ${id}`);
  }

  // 4 — targeting something the same batch created.
  {
    const { id, html } = await makePage(token, sectionId, 'self-reference');
    const [intro] = idsOf(html, 'p');

    const result = await patch(token, id, [
      { target: intro, action: 'replace', content: '<p data-id="fresh">Made by command one</p>' },
      // insert, not append: a p never supports append, which is a fact about the
      // element and not about batching — an earlier run of this probe read that
      // 20138 as an answer to the question being asked.
      { target: '#fresh', action: 'insert', position: 'after', content: '<p>Added by command two</p>' },
    ]);

    const after = await read(token, id);
    report(
      4,
      'a command can target what an earlier command in the same batch created',
      after.includes('Added by command two') ? 'YES' : 'NO',
      after.includes('Added by command two')
        ? 'a batch may build on itself'
        : `it cannot — status ${result.status}${result.text ? `, ${result.text.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`,
    );
    console.log(`     page ${id}`);
  }

  console.log('\n  scratch pages left behind for inspection; delete them in OneNote.\n');
};

const [flag, value] = process.argv.slice(2);
if (flag !== '--in' || value === undefined) die('usage: --in <section-id>');
run(value).catch((err) => die(String(err?.stack ?? err)));
