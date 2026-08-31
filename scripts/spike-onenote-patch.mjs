#!/usr/bin/env node
/**
 * Spike: is `PATCH` against a `data-id` target survivable, and is a replace
 * genuinely undoable?
 *
 * docs/decisions/0003-onenote-writes.md rules replacing out permanently, on
 * recoverability grounds rather than scope grounds, and names its own reversal
 * condition: "a way to undo them". It also leaves one thing untested —
 * "Whether `data-id` targeting is survivable for an append. A body-level
 * `append` was tested and behaved; targeting a specific element by `data-id`
 * was not." CLAUDE.md's original warning was about exactly that target.
 *
 * This script answers both against a real notebook, because the OneNote
 * reference has already diverged from OneNote's behaviour three times in this
 * record (`lastModifiedDateTime`, the delete semantics, and
 * `Notes.ReadWrite.CreatedByApp` being absent from the tables for the
 * operations it enables). Quoting it is not evidence.
 *
 * Six questions, in the order that a later one only matters if the earlier
 * one held:
 *
 *   1. Does consent return `Notes.ReadWrite.CreatedByApp`, and does it still
 *      fold in `Notes.Create` unasked?
 *   2. Do the `data-id`s we can address survive a create-then-read round trip,
 *      and are author-set ids honoured or replaced by OneNote's own?
 *   3. Does `append` at a `data-id` target land where it was aimed, leaving
 *      the rest of the page intact?
 *   4. Does `replace` at a `data-id` target leave the rest of the page intact?
 *   5. Is there ANY concurrency guard — does the PATCH honour `If-Match`, or
 *      is a lost update silent? This is what decides whether an additive
 *      operation can be safely built out of a destructive one.
 *   6. Does a pre-image captured before a replace actually restore the element
 *      byte-for-byte? An undo that does not round-trip is not an undo, and
 *      0003 reopens nothing without one.
 *
 * Every write in this script targets a page THIS RUN created, seconds earlier,
 * in a section named by the operator. The single exception is the negative
 * control (SPIKE_FOREIGN_PAGE_ID), which is expected to be refused and which
 * uses `append` and never `replace` — so if the scope boundary turns out not
 * to hold, the damage is a stray line the operator deletes by hand rather than
 * lost content. Point it at a throwaway notebook regardless.
 *
 * Deliberately standalone: no imports from apps/mcp, no workspace deps, nothing
 * written to disk. It is a probe, not a prototype.
 *
 * Usage:
 *   SPIKE_MS_CLIENT_ID=... node scripts/spike-onenote-patch.mjs --list-sections
 *   SPIKE_MS_CLIENT_ID=... SPIKE_SECTION_ID=... node scripts/spike-onenote-patch.mjs
 *   SPIKE_MS_CLIENT_ID=... SPIKE_SECTION_ID=... SPIKE_FOREIGN_PAGE_ID=... \
 *     node scripts/spike-onenote-patch.mjs
 *
 * Run --list-sections first. It consents and reads, and writes nothing — the
 * point is to choose the throwaway section deliberately rather than let this
 * script take the first one the account happens to expose, which on a real
 * account is the notebook you care about.
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.SPIKE_PORT ?? 8765);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const GRAPH = 'https://graph.microsoft.com/v1.0/me/onenote';

// The scope 0003 found in the body of Microsoft's own 403 and then verified.
// Notes.Create is not requested: the point of asking for exactly this is to
// re-observe whether consent folds it in unbidden, as it did once before.
const SCOPE = 'offline_access Notes.Read Notes.ReadWrite.CreatedByApp';

const die = (message) => {
  console.error(`\n  FAILED  ${message}\n`);
  process.exit(1);
};

const pkcePair = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

const awaitCallback = (expectedState) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not here.');
        return;
      }

      const params = Object.fromEntries(url.searchParams);
      const ok = params.code && params.state === expectedState;

      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' });
      res.end(ok ? 'Authorised. Close this tab and return to the terminal.' : 'Authorisation failed.');
      server.close();

      if (params.error) reject(new Error(`${params.error}: ${params.error_description ?? 'no description'}`));
      else if (params.state !== expectedState) reject(new Error('state mismatch — discarding the response'));
      else if (!params.code) reject(new Error('no authorization code in the callback'));
      else resolve(params.code);
    });

    server.on('error', (err) =>
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`port ${PORT} is busy. Set SPIKE_PORT and re-register the redirect URI.`)
          : err,
      ),
    );

    server.listen(PORT);
  });

const consent = async (clientId) => {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');

  const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
    // Without this a cached grant is reused and the question "what does
    // consent actually return for this scope" is answered from last time.
    prompt: 'consent',
  }).toString();

  // Opened rather than printed for copying. The URL is ~600 characters and
  // wraps over several terminal lines, and a selection that clips a character
  // out of code_challenge fails later as AADSTS70000 "code_verifier does not
  // match" — which reads like a PKCE bug rather than a mangled paste.
  //
  // A challenge fingerprint was printed here at both ends for a while. It was
  // useless: both values came from this process, so it compared a number to
  // itself. `state` is the check that means anything, because the browser
  // round-trips it — a code from another run fails it below.

  // The authorize URL once went out with no code_challenge on it. Microsoft
  // then issued a code with no challenge attached and rejected the exchange as
  // AADSTS70000 "code_verifier does not match the original code_challenge" —
  // which describes a mismatch between two values when in fact one of them was
  // never sent. Checked here rather than trusted, because the error message
  // points away from the cause.
  if (authUrl.searchParams.get('code_challenge') !== challenge) {
    die('the authorize URL is not carrying this run\'s code_challenge — refusing to consent.');
  }

  // Before the browser opens, not after: a consent that returns instantly can
  // otherwise arrive at a port nothing is watching yet. apps/mcp/src/oauth.ts
  // says the same in the same order, and for the same reason.
  const pending = awaitCallback(state);

  // rundll32 on Windows rather than `start`: cmd reads `&` as a command
  // separator and chops the URL at the first parameter. Same reason the
  // product's browserOpener avoids a shell on every platform.
  const opener = {
    darwin: { command: 'open', args: [authUrl.toString()] },
    win32: { command: 'rundll32', args: ['url.dll,FileProtocolHandler', authUrl.toString()] },
    linux: { command: 'xdg-open', args: [authUrl.toString()] },
  }[process.platform];
  let opened = false;
  if (opener) {
    try {
      spawn(opener.command, opener.args, { detached: true, stdio: 'ignore' })
        .on('error', () => {})
        .unref();
      opened = true;
    } catch {
      opened = false;
    }
  }

  console.log(
    opened
      ? '\nA browser tab is opening. Consent there, then come back.\n'
      : '\nOpen this and consent — copy the WHOLE line, it wraps:\n\n' + `  ${authUrl}\n`,
  );

  const code = await pending.catch((err) => die(`callback: ${err.message}`));

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (String(body.error_description ?? '').includes('AADSTS70000')) {
      console.error('\n  The state check passed, so this code came from the URL this run opened,');
      console.error('  and the verifier below is the one that challenge was built from.');
      console.error('  That points at the app registration rather than at this script:');
      console.error('  a loopback redirect registered under the Web platform instead of');
      console.error('  "Mobile and desktop applications" produces exactly this error.');
      console.error('  Control test: node scripts/spike-pkce.mjs microsoft');
    }
    die(`token exchange: ${res.status} ${body.error_description ?? JSON.stringify(body)}`);
  }

  return body;
};

/** Graph call returning status, body and headers — the status is the finding. */
const graph = async (token, path, init = {}) => {
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  return { status: res.status, text, json, headers: res.headers };
};

// A page with three addressable elements and one author-set data-id. The
// paragraphs are distinct strings so a patch that lands in the wrong place is
// visible in a diff rather than plausible.
const PAGE_HTML = (marker) => `<!DOCTYPE html>
<html>
  <head><title>artist-mcp patch spike ${marker}</title></head>
  <body>
    <div id="intro">
      <p data-id="author-set-paragraph">ALPHA original intro paragraph ${marker}</p>
    </div>
    <div id="body">
      <p>BRAVO second paragraph, untouched throughout ${marker}</p>
      <p>CHARLIE third paragraph, untouched throughout ${marker}</p>
    </div>
  </body>
</html>`;

/**
 * Cuts one element, with its children, out of returned page HTML.
 *
 * This is the pre-image capture the product would have to perform before any
 * replace, so its reliability is the finding rather than an implementation
 * detail: 0003 reopens replace only given "a way to undo them", and an undo
 * that cannot capture what it is about to overwrite is not one.
 *
 * Depth-counted rather than a regex. A non-greedy match to the first closing
 * tag returns a fragment whenever the target contains children, which an
 * outline div always does — and a fragment restores as silent truncation,
 * the exact failure this is supposed to make impossible.
 */
const extractElement = (html, attr, value) => {
  const open = new RegExp(`<([a-z0-9]+)[^>]*\\b${attr}="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'i').exec(html);
  if (!open) return undefined;

  const tag = open[1];
  const step = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  step.lastIndex = open.index;

  let depth = 0;
  let m;
  while ((m = step.exec(html)) !== null) {
    if (m[2] === '/') continue; // self-closing: enters and leaves at once
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(open.index, m.index + m[0].length);
  }

  return undefined; // unbalanced — report the capture as failed, never guess
};

const patch = (token, pageId, commands, extraHeaders = {}) =>
  graph(token, `/pages/${pageId}/content`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(commands),
  });

/**
 * Reads the page back, and refuses to return anything but real HTML.
 *
 * The first run of this script scanned `.text` without checking the status. A
 * read that had failed therefore contained none of the marker strings, and the
 * script reported that untouched paragraphs had been "lost" and that a replace
 * had "taken untargeted content with it" — neither of which had happened, on a
 * page no write had reached. A probe that invents damage is worse than one that
 * fails, so this throws instead.
 */
const content = async (token, pageId, { retryMissing = false } = {}) => {
  // OneNote returns the page id from CREATE before the page is readable:
  // a 201 followed straight away by 404 20102 "The specified resource ID does
  // not exist." Observed intermittently — two runs read back instantly and the
  // third did not — so it is a race, and code that creates then touches a page
  // has to wait rather than assume. Retried only for the first read, and the
  // wait is reported, because how long it takes is the finding.
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    const res = await graph(token, `/pages/${pageId}/content?includeIDs=true`);
    if (res.status === 200) {
      if (attempt > 0) {
        console.log(`   (readable after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}, ${Date.now() - started}ms)`);
      }
      return res;
    }

    const missing = res.status === 404 && res.json?.error?.code === '20102';
    if (!retryMissing || !missing || attempt >= 9) {
      die(`reading the page back: ${res.status} ${res.text.slice(0, 300)}`);
    }

    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
};

const main = async () => {
  const listOnly = process.argv.includes('--list-sections');
  const clientId = process.env.SPIKE_MS_CLIENT_ID;
  const sectionId = process.env.SPIKE_SECTION_ID;
  const foreignPageId = process.env.SPIKE_FOREIGN_PAGE_ID;

  if (!clientId) {
    console.error('\nSet SPIKE_MS_CLIENT_ID first (the same public client used by scripts/spike-pkce.mjs).\n');
    console.error('Entra portal → App registrations → your app:');
    console.error('  • Authentication → Mobile and desktop applications');
    console.error(`  • Custom redirect URI: ${REDIRECT_URI}`);
    console.error('  • Advanced settings → Allow public client flows → Yes\n');
    process.exit(1);
  }

  console.log(listOnly ? '\nOneNote sections (read-only, nothing is written)' : '\nOneNote data-id PATCH spike');
  console.log(`redirect  ${REDIRECT_URI}`);
  console.log(`scope     ${SCOPE}`);
  console.log(
    listOnly
      ? 'target    nothing — this mode only lists what the account can see.\n'
      : 'target    a page this run creates. USE A THROWAWAY NOTEBOOK.\n',
  );

  const grant = await consent(clientId);

  // ── 1. What consent actually returned ──────────────────────────────────
  const granted = (grant.scope ?? '').split(' ').filter(Boolean);
  console.log('\n1. consent');
  console.log(`   granted: ${granted.join(' ') || '(none reported)'}`);
  if (!granted.some((s) => s.endsWith('Notes.ReadWrite.CreatedByApp'))) {
    die('Notes.ReadWrite.CreatedByApp was not granted — nothing below is testable.');
  }
  console.log(
    granted.some((s) => s.endsWith('Notes.Create'))
      ? '   ok     folded in Notes.Create unasked, as 0003 observed'
      : '   note   did NOT fold in Notes.Create this time — 0003 says it did before',
  );

  const token = grant.access_token;

  if (listOnly) {
    // Notebook name included because section names repeat across notebooks and
    // "Quick Notes" in the wrong notebook is the mistake this mode prevents.
    const listed = await graph(token, '/sections?$expand=parentNotebook&$top=100');
    if (listed.status !== 200) die(`listing sections: ${listed.status} ${listed.text.slice(0, 300)}`);

    const sections = listed.json?.value ?? [];
    if (!sections.length) die('the account exposes no OneNote sections at all.');

    console.log(`\n${sections.length} section(s) visible:\n`);
    for (const s of sections) {
      console.log(`  ${s.parentNotebook?.displayName ?? '(unknown notebook)'} / ${s.displayName}`);
      console.log(`    ${s.id}\n`);
    }

    console.log('Pick the one in a THROWAWAY notebook and re-run with:\n');
    console.log('  SPIKE_MS_CLIENT_ID=$SPIKE_MS_CLIENT_ID \\');
    console.log('  SPIKE_SECTION_ID=<the id above> \\');
    console.log('    node scripts/spike-onenote-patch.mjs\n');
    return;
  }

  // Where the throwaway page goes. Named explicitly, or the first section the
  // account exposes — reported either way, because "wrong notebook" is the one
  // mistake this script cannot undo for you.
  // Deliberately not defaulted. Guessing a section means guessing a notebook,
  // and the one write this script cannot undo for you is writing to the wrong
  // one.
  const section = sectionId;
  if (!section) die('set SPIKE_SECTION_ID. Run with --list-sections to find it.');

  // ── 2. Create, then read back to see which ids are addressable ─────────
  const marker = randomBytes(3).toString('hex');
  const created = await graph(token, `/sections/${section}/pages`, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body: PAGE_HTML(marker),
  });

  console.log('\n2. create + read back');
  console.log(`   CREATE -> ${created.status}`);
  if (created.status !== 201) die(`create: ${created.text.slice(0, 300)}`);

  const pageId = created.json.id;
  console.log(`   page   ${pageId}`);
  console.log(`   appId  ${created.json.createdByAppId ?? '(absent)'}`);

  const first = await content(token, pageId, { retryMissing: true });
  if (first.status !== 200) die(`read back: ${first.status} ${first.text.slice(0, 300)}`);

  // Two different attributes, and the distinction is the whole game.
  //
  //   data-id  author-supplied, addressed as '#name' — the '#' is required,
  //            and omitting it was why an earlier run saw 20134 for every
  //            element and concluded, wrongly, that only `body` was updateable.
  //   id       generated by Graph, returned only with includeIDs=true, and
  //            addressed with NO prefix. Required for replace on everything
  //            except the title and images inside a div.
  //
  // The docs also warn that generated ids may change after any page update, so
  // they are re-read before each command rather than remembered.
  const dataIds = [...first.text.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  const genIds = [...first.text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const ids = dataIds;
  console.log(`   data-id  ${dataIds.join(', ') || '(none)'}`);
  console.log(`   id       ${genIds.join(', ') || '(none — includeIDs returned nothing)'}`);
  console.log(
    ids.includes('author-set-paragraph')
      ? '   ok     the author-set data-id survived the round trip'
      : '   note   the author-set data-id did NOT survive — only OneNote-generated ids are addressable',
  );
  if (!ids.length) die('no addressable ids at all, so data-id targeting is not available.');

  // Prefer the author-set id when it survived; otherwise the first generated
  // one that is not the page-level container, so the test targets an element
  // rather than the whole body by another name.
  // Established on the first run: a data-id is addressable but not thereby
  // patchable. Targeting the <p> returned
  //   20134 "The selected target author-set-paragraph is not a valid
  //          updateable element."
  // OneNote patches its own units — the body, the title, and outline divs —
  // so the paragraph id that survives the round trip is still not a target.
  // Both are tested: the div we can aim at, and the paragraph we cannot, so
  // the boundary is recorded rather than assumed to sit where it did today.
  const unpatchable = 'author-set-paragraph';

  const survived = (html) => ['BRAVO', 'CHARLIE'].filter((needle) => html.includes(needle));

  // ── 2b. which targets are actually updateable? ─────────────────────────
  // Discovered, not assumed. Two earlier runs picked a target by reasoning
  // about what OneNote "should" accept — first the paragraph, then an
  // author-set div — and both were refused with 20134, which left every
  // question below untested while still printing answers to them. So every
  // candidate is tried, and the finding is the whole table rather than one
  // verdict.
  console.log('\n2b. which data-ids are updateable?');
  const candidates = [
    ...dataIds.map((id) => `#${id}`),
    ...genIds,
    'body',
    'title',
  ];
  const updateable = [];
  for (const candidate of candidates) {
    const probe = await patch(token, pageId, [
      { target: candidate, action: 'append', content: `<p>PROBE ${candidate}</p>` },
    ]);
    const verdict = probe.status === 204 ? 'UPDATEABLE' : `${probe.status} ${probe.json?.error?.code ?? ''}`;
    console.log(`   ${candidate.padEnd(22)} ${verdict}`);
    if (probe.status === 204) updateable.push(candidate);
  }

  // The loop probes with APPEND, so a paragraph failing it is the documented
  // behaviour (p supports replace and insert, never append) and says nothing
  // about whether it can be replaced. Two error codes, and conflating them is
  // what produced a wrong conclusion earlier:
  //   20134  not a valid updateable element — the target did not resolve,
  //          which is what a data-id sent without its '#' prefix looks like
  //   20138  the element resolved, but does not support this action
  console.log(
    '\n   note   20138 above is "this element does not support append", not\n' +
      '          "this element is unreachable". Paragraph replace is tested at\n' +
      '          step 4 against the generated id, which is the only way to\n' +
      '          address it for a replace.',
  );

  if (!updateable.length) {
    die(
      'no target on this page is updateable, so append and replace are both unreachable.\n' +
        '          That is the finding: `data-id` targeting does not work here at all.',
    );
  }

  // Append and replace do NOT share a target set, so one discovered target
  // cannot stand in for both. Per the supported-elements table: body and divs
  // take append but not replace; p, li and h1-h6 take replace but not append.
  // The loop above probes with append, so a paragraph correctly fails it —
  // and a paragraph is exactly what a "change this value" feature must reach.
  const appendTarget = updateable.find((id) => id !== 'body' && id !== 'title') ?? updateable[0];

  // Replace needs the GENERATED id, never the data-id, for everything but the
  // title and images inside a div. A paragraph's generated id looks like
  // `p:{guid}{40}`.
  const replaceTarget = genIds.find((id) => id.startsWith('p:'));

  console.log(`   append target  ${appendTarget}`);
  console.log(`   replace target ${replaceTarget ?? 'NONE — no generated paragraph id was returned'}`);

  // ── 3. append at a data-id target ──────────────────────────────────────
  const appended = await patch(token, pageId, [
    { target: appendTarget, action: 'append', content: `<p>DELTA appended at ${appendTarget}</p>` },
  ]);
  const afterAppend = await content(token, pageId);

  console.log('\n3. append at a data-id target');
  console.log(`   PATCH  -> ${appended.status}${appended.status === 204 ? '' : ` ${appended.text.slice(0, 200)}`}`);
  if (appended.status !== 204) {
    die(`append was refused at a target discovered to be updateable — ${appended.text.slice(0, 200)}`);
  }
  console.log(`   landed: ${afterAppend.text.includes('DELTA') ? 'yes' : 'NO — a 204 that did not put it on the page'}`);
  console.log(`   intact: ${survived(afterAppend.text).join(', ') || 'NEITHER — untouched paragraphs were lost'}`);

  // ── 4 & 6. replace at a data-id target, and whether the pre-image restores ──
  // The pre-image is captured the way the product would have to capture it:
  // read the element out of the page immediately before writing over it.
  const before = afterAppend.text;

  if (!replaceTarget) {
    die('no generated paragraph id came back, so replace cannot be tested at all.');
  }

  // Re-read rather than reuse: "Generated id values might change after a page
  // update, so you should get the current values before building a PATCH
  // request that uses them." The append above was such an update. An id read
  // before it is not safe to send after it.
  const current = [...before.matchAll(/\sid="(p:[^"]+)"/g)].map((m) => m[1]);
  const live = current.includes(replaceTarget) ? replaceTarget : current[0];
  if (live !== replaceTarget) {
    console.log(`\n   note   the paragraph id changed across the append:`);
    console.log(`          was ${replaceTarget}`);
    console.log(`          now ${live ?? '(gone)'} — ids must be re-read per command`);
  }
  if (!live) die('the paragraph id did not survive the append, and no replacement was found.');

  const preImage = extractElement(before, 'id', live);

  const replaced = await patch(token, pageId, [
    { target: live, action: 'replace', content: `<p>ECHO replaced ${marker}</p>` },
  ]);
  const afterReplace = await content(token, pageId);

  console.log('\n4. replace at a data-id target');
  console.log(`   PATCH  -> ${replaced.status}${replaced.status === 204 ? '' : ` ${replaced.text.slice(0, 200)}`}`);
  if (replaced.status !== 204) die(`replace refused: ${replaced.text.slice(0, 200)}`);
  console.log(`   landed: ${afterReplace.text.includes('ECHO') ? 'yes' : 'no'}`);
  console.log(`   gone:   ALPHA ${afterReplace.text.includes('ALPHA') ? 'survived' : 'overwritten (expected)'}`);
  console.log(`   intact: ${survived(afterReplace.text).join(', ') || 'NEITHER — replace took untargeted content with it'}`);

  console.log('\n6. does the pre-image restore?');
  if (!preImage) {
    console.log('   SKIP   could not isolate the element from the returned HTML.');
    console.log('          That is itself a finding: if the pre-image cannot be captured');
    console.log('          reliably, the undo 0003 requires does not exist.');
  } else {
    // Only meaningful if the replace above actually destroyed ALPHA. An
    // earlier run reported "ALPHA back: yes" when no write had landed at all,
    // which is the same false positive in a different place: a restore cannot
    // be demonstrated against content that was never overwritten.
    if (afterReplace.text.includes('ALPHA')) {
      die('the replace did not remove ALPHA, so there is nothing here to restore. Undo untested.');
    }

    // The replace changed the page, so the id to restore over must be re-read
    // exactly as the id to replace was.
    const afterIds = [...afterReplace.text.matchAll(/\sid="(p:[^"]+)"/g)].map((m) => m[1]);
    const echo = afterIds.find((id) => extractElement(afterReplace.text, 'id', id)?.includes('ECHO'));
    if (!echo) die('could not find the replaced paragraph to restore over.');

    const restored = await patch(token, pageId, [{ target: echo, action: 'replace', content: preImage }]);
    const afterRestore = await content(token, pageId);
    console.log(`   PATCH  -> ${restored.status}`);
    if (restored.status !== 204) die(`the restore was refused: ${restored.text.slice(0, 200)}`);
    console.log(`   ALPHA back: ${afterRestore.text.includes('ALPHA') ? 'yes' : 'NO — the replace was not reversible'}`);
    console.log(`   exact:      ${afterRestore.text.includes(preImage) ? 'element round-tripped verbatim' : 'restored but NOT byte-identical — OneNote rewrote it'}`);
  }

  // ── 5. concurrency: is a lost update even detectable? ──────────────────
  // If If-Match is ignored, two writers cannot be serialised, and building an
  // append out of read-then-replace races silently against OneNote's own
  // clients. A 412 means the guard exists; a 204 means it does not.
  // Deliberately the target proved to work above. The first run sent this at
  // an invalid target, so its 400 was the invalid-target error and said
  // nothing whatever about If-Match — a control that tests the wrong thing
  // reads exactly like a finding.
  const guarded = await patch(
    token,
    pageId,
    [{ target: appendTarget, action: 'append', content: '<p>FOXTROT if-match probe</p>' }],
    { 'if-match': '"an-etag-that-cannot-be-current"' },
  );

  console.log('\n5. concurrency guard');
  console.log(`   PATCH with a stale If-Match -> ${guarded.status} ${guarded.json?.error?.code ?? ''}`);
  console.log(
    guarded.status === 412
      ? '   ok     honoured — a lost update is detectable, so read-then-replace can be made safe'
      : guarded.status === 204
        ? '   note   IGNORED — the stale If-Match was accepted and the write landed, so a\n' +
          '          page that moved under us is undetectable and a read-then-replace\n' +
          '          overwrites concurrent edits silently'
        : `   note   inconclusive — ${guarded.status}, which is neither honoured nor ignored;\n` +
          '          read the error before concluding anything',
  );

  // ── negative control ───────────────────────────────────────────────────
  console.log('\nnegative control (a page this tool did not create)');
  // Found rather than asked for. This is the claim the entire capability rests
  // on, so it should not be the step that gets skipped because it needed an id
  // pasted in by hand. A page with an empty createdByAppId was made by a
  // person, which is precisely the page that must be unreachable.
  let foreign = foreignPageId;
  if (!foreign) {
    const pages = await graph(token, `/sections/${section}/pages?$top=100&$select=id,title,createdByAppId`);
    const handmade = (pages.json?.value ?? []).find((page) => !page.createdByAppId);
    if (handmade) {
      foreign = handmade.id;
      console.log(`   using  "${handmade.title}" — createdByAppId is empty, so a person made it`);
    }
  }

  if (!foreign) {
    console.log('   SKIP   no handmade page found in this section, and SPIKE_FOREIGN_PAGE_ID was');
    console.log('          not set. Write a page by hand in it and re-run to observe the boundary.');
  } else {
    // append, never replace: if the boundary fails, this leaves a line to
    // delete rather than destroying what was there.
    const attempt = await patch(token, foreign, [
      { target: 'body', action: 'append', content: '<p>artist-mcp spike — this should never have landed</p>' },
    ]);
    console.log(`   PATCH  -> ${attempt.status} ${attempt.json?.error?.code ?? ''}`);
    if (attempt.status === 204) {
      console.error('\n  BOUNDARY FAILED  the token edited a page it did not create.');
      console.error('  0003 says this is the thing that reverses the whole capability.');
      console.error(`  Remove the appended line from page ${foreign} by hand.\n`);
      process.exit(1);
    }
    console.log(`   ok     refused: ${attempt.json?.error?.message ?? attempt.text.slice(0, 160)}`);
  }

  console.log(`\nThe spike page is left in place for inspection: "${created.json.title}"`);
  console.log('Delete it by hand when you are done — this script never deletes anything.\n');
};

main().catch((err) => die(err.stack ?? err.message));
