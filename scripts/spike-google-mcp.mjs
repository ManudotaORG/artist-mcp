#!/usr/bin/env node
/**
 * Spike for 0022 step 3: can artist-mcp do its Google work through Google's own
 * MCP servers instead of the REST APIs it calls today?
 *
 * From 1 February 2027 Google requires a tool driven by an AI model to reach
 * Gmail and Calendar through gmailmcp.googleapis.com and
 * calendarmcp.googleapis.com, with an OAuth client flagged "Use this client
 * for an AI-powered agent". The reference pages answer some questions and
 * leave the ones that decide the migration open. This script asks them of the
 * real servers:
 *
 *   1. Is a refresh token issued before the client was flagged still accepted
 *      after it is? (Decides whether every Google user has to reconnect.)
 *   2. Can create_event take our own event id? (The `artist` prefix, base32hex,
 *      derived from content: dedup, provenance and the delete rule rest on it.)
 *   3. What guard against overwriting a changed event is left without
 *      etag / If-Match?
 *   4. What does one tool call cost against 5,000 requests a day per project
 *      per product?
 *   5. Is there any way to read an attachment's contents?
 *
 * Deliberately standalone, like spike-pkce.mjs: no imports from apps/mcp/src.
 * The MCP SDK client is borrowed from apps/mcp/node_modules because it is
 * already installed there; nothing in apps/mcp changes.
 *
 * The refresh token is kept in ~/.artist-mcp-spike/ (directory 700, file 600),
 * outside the repository, and is never printed. Results go to the same
 * directory as JSON. Mail content is not printed: probes report shapes,
 * counts and field names, plus attachment metadata exactly as returned.
 *
 * Usage:
 *   SPIKE_GOOGLE_CLIENT_ID=... SPIKE_GOOGLE_CLIENT_SECRET=... \
 *     node scripts/spike-google-mcp.mjs                # sign in, then probe
 *   ... node scripts/spike-google-mcp.mjs --reuse      # use the stored token
 *
 *   SPIKE_LABEL=before-flag   names the stored token and the results file
 *                             (default "default"), so the reconnect test keeps
 *                             the pre-flag token apart from any later one
 *   SPIKE_AGENT_FLAG=off|on   what you set in the console, recorded with the
 *                             results; the script cannot read it itself
 *   SPIKE_GMAIL_QUERY=...     default "has:attachment newer_than:180d"
 *   SPIKE_SEASON_START=...    default 2026-08-01 (list_events window)
 *   SPIKE_SEASON_END=...      default 2027-07-31
 *
 * Write probes run only with BOTH of:
 *   SPIKE_WRITE=1
 *   SPIKE_CALENDAR_ID=<a scratch calendar's id>   never primary
 * and a typed confirmation of that id at the terminal. Every event the probe
 * creates is deleted again, with notificationLevel NONE, in a finally block.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const sdk = (path) =>
  import(new URL(`../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/${path}`, import.meta.url));
const { Client } = await sdk('client/index.js');
const { StreamableHTTPClientTransport } = await sdk('client/streamableHttp.js');

const PORT = Number(process.env.SPIKE_PORT ?? 8766);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

const SERVERS = {
  gmail: 'https://gmailmcp.googleapis.com/mcp/v1',
  calendar: 'https://calendarmcp.googleapis.com/mcp/v1',
};

// The product's read scopes, kept in step with PROVIDERS.google.scope in
// apps/mcp/src/oauth.ts, plus calendar.events, which is what the calendar
// write grants add (WRITE_SCOPES). Asking for the same set the product asks
// for is the point: a spike on an easier consent proves nothing about ours.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

const STATE_DIR = join(homedir(), '.artist-mcp-spike');
const LABEL = (process.env.SPIKE_LABEL ?? 'default').replace(/[^a-z0-9_-]/gi, '_');
const TOKEN_FILE = join(STATE_DIR, `google-${LABEL}.json`);
const RUN_AT = new Date().toISOString();
const RESULTS_FILE = join(STATE_DIR, `results-${LABEL}-${RUN_AT.replace(/[:.]/g, '-')}.json`);

const results = {
  runAt: RUN_AT,
  label: LABEL,
  mode: process.argv.includes('--reuse') ? 'reuse' : 'sign-in',
  agentFlagAsDeclared: process.env.SPIKE_AGENT_FLAG ?? '(not declared)',
  token: {},
  servers: {},
  calls: [],
  findings: {},
};

const log = (...args) => console.log(...args);
const die = (message) => {
  console.error(`\n  FAILED  ${message}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------- OAuth

const pkcePair = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const awaitCallback = (expectedState) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') return void res.writeHead(404).end('Not here.');
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
      reject(err.code === 'EADDRINUSE' ? new Error(`port ${PORT} is busy; set SPIKE_PORT`) : err),
    );
    server.listen(PORT, '127.0.0.1');
  });

/** Google explains a refusal in the body; the body is the result when it fails. */
const tokenRequest = async (form) => {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${body.error ?? 'unknown'} — ${body.error_description ?? JSON.stringify(body)}`);
  }
  return body;
};

const signIn = async (clientId, clientSecret) => {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

  log('Open this in your browser and consent (you sign in; nothing is typed for you):\n');
  log(`  ${url}\n`);

  const code = await awaitCallback(state).catch((err) => die(`callback: ${err.message}`));
  const tokens = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  }).catch((err) => die(`code exchange: ${err.message}`));

  if (!tokens.refresh_token) die('no refresh token returned');

  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await chmod(STATE_DIR, 0o700);
  await writeFile(
    TOKEN_FILE,
    JSON.stringify(
      {
        clientId,
        issuedAt: new Date().toISOString(),
        agentFlagAsDeclared: results.agentFlagAsDeclared,
        scope: tokens.scope,
        refreshToken: tokens.refresh_token,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await chmod(TOKEN_FILE, 0o600);
  log(`  ok      refresh token stored in ${TOKEN_FILE} (mode 600, not printed)`);
  return { refreshToken: tokens.refresh_token, issuedAt: new Date().toISOString(), scope: tokens.scope };
};

const loadStored = async (clientId) => {
  const raw = await readFile(TOKEN_FILE, 'utf8').catch(() =>
    die(`no stored token at ${TOKEN_FILE}; run once without --reuse (same SPIKE_LABEL)`),
  );
  const stored = JSON.parse(raw);
  if (stored.clientId !== clientId) {
    die('the stored token belongs to a different client id than SPIKE_GOOGLE_CLIENT_ID');
  }
  log(`  ok      stored token from ${stored.issuedAt} (agent flag then: ${stored.agentFlagAsDeclared})`);
  return stored;
};

/** Scopes the access token really carries, read from Google rather than assumed. */
const tokenInfo = async (accessToken) => {
  const res = await fetch(TOKENINFO, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: accessToken }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { scope: body.scope, expiresIn: body.expires_in, aud: body.aud === undefined ? undefined : 'present' } : { error: body };
};

// ---------------------------------------------------------------- MCP

/**
 * Every HTTP request the SDK makes is counted per server, so "what does one
 * tool call cost" has at least the client-side answer. The server-side answer
 * (some tools count as several requests, Google says, without saying which) is
 * only in Cloud Console's metrics; the totals printed at the end are what to
 * compare against there.
 */
const httpCounts = { gmail: 0, calendar: 0 };

const connect = async (name, accessToken) => {
  const transport = new StreamableHTTPClientTransport(new URL(SERVERS[name]), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    fetch: async (input, init) => {
      httpCounts[name] += 1;
      return fetch(input, init);
    },
  });
  const client = new Client({ name: 'artist-mcp-spike', version: '0.0.0' });
  const started = performance.now();
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const ms = Math.round(performance.now() - started);
    results.servers[name] = {
      connected: true,
      connectAndListMs: ms,
      serverInfo: client.getServerVersion(),
      tools: listed.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations: t.annotations,
      })),
    };
    log(`  ok      ${name}: connected, ${listed.tools.length} tools (${ms} ms)`);
    for (const t of listed.tools) {
      log(`            ${t.name}(${Object.keys(t.inputSchema?.properties ?? {}).join(', ')})`);
    }
    return { client, tools: new Map(listed.tools.map((t) => [t.name, t])) };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    results.servers[name] = { connected: false, ms, error: describeError(err) };
    log(`  FAIL    ${name}: ${describeError(err)} (${ms} ms)`);
    return undefined;
  }
};

const describeError = (err) => {
  const parts = [err?.name, err?.code, err?.message].filter(Boolean);
  return parts.join(' · ') || String(err);
};

/** The payload of a tool result: structured content, or the first text block as JSON. */
const payload = (result) => {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { _text: text };
  }
};

/** One tool call, timed and recorded. Never throws: an outcome is the result. */
const call = async (server, conn, tool, args, note) => {
  const before = httpCounts[server];
  const started = performance.now();
  let outcome;
  try {
    const result = await conn.client.callTool({ name: tool, arguments: args });
    const body = payload(result);
    outcome = {
      ok: !result.isError,
      isError: Boolean(result.isError),
      // An error result's text is the explanation; keep it whole.
      error: result.isError ? result.content?.map((c) => c.text).join('\n') : undefined,
      body,
    };
  } catch (err) {
    outcome = { ok: false, thrown: describeError(err) };
  }
  const entry = {
    server,
    tool,
    note,
    args: redactArgs(args),
    ms: Math.round(performance.now() - started),
    httpRequests: httpCounts[server] - before,
    ok: outcome.ok,
    error: outcome.error ?? outcome.thrown,
  };
  results.calls.push(entry);
  log(
    `  ${outcome.ok ? 'ok  ' : 'FAIL'}    ${server}.${tool}${note ? ` [${note}]` : ''} — ${entry.ms} ms, ` +
      `${entry.httpRequests} HTTP${outcome.ok ? '' : ` — ${(entry.error ?? '').slice(0, 300)}`}`,
  );
  return outcome;
};

// Gmail queries can name people; keep them out of the shared results.
const redactArgs = (args) =>
  Object.fromEntries(Object.entries(args).map(([k, v]) => [k, k === 'query' ? '(query)' : v]));

const props = (conn, tool) => conn.tools.get(tool)?.inputSchema?.properties ?? {};
const pickKey = (conn, tool, candidates) => candidates.find((c) => c in props(conn, tool));

const shape = (value, depth = 0) => {
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1), `×${value.length}`] : [];
  if (value && typeof value === 'object' && depth < 4) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return value === null ? 'null' : typeof value;
};

// ---------------------------------------------------------------- Gmail

const gmailProbes = async (gmail) => {
  const query = process.env.SPIKE_GMAIL_QUERY ?? 'has:attachment newer_than:180d';
  const findings = {};

  findings.attachmentToolsListed = [...gmail.tools.keys()].filter((n) => /attach|download|raw|blob/i.test(n));

  const search = await call('gmail', gmail, 'search_threads', { query, pageSize: 10 }, 'Gmail query, 10 threads');
  const threads = search.body?.threads ?? [];
  findings.searchShape = shape(search.body);
  findings.threadsFound = threads.length;
  if (!threads.length) {
    log(search.ok ? '  note    no threads matched; set SPIKE_GMAIL_QUERY to something that has attachments' : '  stop    search failed; Gmail probes end here');
    return findings;
  }

  const thread = await call('gmail', gmail, 'get_thread', { threadId: threads[0].id }, 'first thread');
  findings.threadShape = shape(thread.body);
  const messages = thread.body?.messages ?? [];
  const withAttachment = messages.find((m) => m.attachments?.length || m.attachmentIds?.length) ?? messages[0];
  if (!withAttachment) return findings;

  const message = await call('gmail', gmail, 'get_message', { messageId: withAttachment.id }, 'full content');
  const m = message.body ?? {};
  findings.messageFields = Object.keys(m);
  findings.attachmentFieldsExactly = {
    attachmentIds: m.attachmentIds,
    attachments: m.attachments,
    // Anything else on the message that could carry bytes or a link to them.
    otherCandidates: Object.fromEntries(
      Object.entries(m).filter(([k]) => /attach|part|payload|data|url|link|body/i.test(k) && !/plaintextBody|htmlBody/.test(k))
        .map(([k, v]) => [k, shape(v)]),
    ),
  };
  log(`  note    attachment fields: ${JSON.stringify(findings.attachmentFieldsExactly)}`);

  // Ask for the tool the reference says does not exist, so a hidden one shows
  // up as a success rather than an assumption. Read-only either way.
  const firstAttachment = m.attachments?.[0]?.id ?? m.attachmentIds?.[0];
  if (firstAttachment) {
    const probe = await call(
      'gmail',
      gmail,
      'get_attachment',
      { messageId: withAttachment.id, attachmentId: firstAttachment },
      'undocumented tool, expected to fail',
    );
    findings.getAttachmentTool = probe.ok ? 'EXISTS' : (probe.error ?? 'refused');
  }

  // RAW is in the live schema's enum but not on the reference pages: "Returns
  // the raw MIME message content". Raw MIME carries attachments as base64
  // parts, so this may be a way to read one. Nothing of the message is printed
  // or stored: only its size and whether each listed attachment's part is in it.
  const raw = await call('gmail', gmail, 'get_message', { messageId: withAttachment.id, messageFormat: 'RAW' }, 'RAW (attachment bytes?)');
  const rawText = typeof raw.body?.raw === 'string' ? raw.body.raw : undefined;
  if (rawText !== undefined) {
    // Gmail's REST raw is base64url; this may be either that or plain MIME.
    const decoded = /^[A-Za-z0-9_-]+=*$/.test(rawText.slice(0, 200).replace(/\s/g, ''))
      ? Buffer.from(rawText, 'base64url').toString('latin1')
      : rawText;
    findings.raw = {
      chars: rawText.length,
      encoding: decoded === rawText ? 'plain MIME' : 'base64url',
      decodedBytes: decoded.length,
      truncatedHint: /truncat/i.test(rawText.slice(-200)),
      attachmentDispositions: (decoded.match(/content-disposition:\s*attachment/gi) ?? []).length,
      listedAttachmentsFoundInRaw: (m.attachments ?? []).map((a) => ({
        mimeType: a.mimeType,
        filenameInRaw: Boolean(a.filename) && decoded.includes(a.filename),
      })),
      base64PartsOver1k: (decoded.match(/content-transfer-encoding:\s*base64\r?\n(?:[^\r\n]+\r?\n)*?\r?\n([A-Za-z0-9+/=\r\n]{1024,})/gi) ?? []).length,
    };
  } else {
    findings.raw = { returned: raw.ok ? shape(raw.body) : raw.error };
  }
  log(`  note    RAW: ${JSON.stringify(findings.raw)}`);

  for (const format of ['MINIMAL', 'METADATA_ONLY']) {
    const r = await call('gmail', gmail, 'get_message', { messageId: withAttachment.id, messageFormat: format }, format);
    findings[`attachmentsWith_${format}`] = { attachments: r.body?.attachments, attachmentIds: r.body?.attachmentIds };
  }
  return findings;
};

// ---------------------------------------------------------------- Calendar reads

const SEASON_START = process.env.SPIKE_SEASON_START ?? '2026-08-01';
const SEASON_END = process.env.SPIKE_SEASON_END ?? '2027-07-31';

const calendarReads = async (calendar) => {
  const findings = {};
  const cals = await call('calendar', calendar, 'list_calendars', {}, 'all calendars');
  const list = cals.body?.calendars ?? cals.body?.items ?? [];
  findings.calendarsShape = shape(cals.body);
  findings.calendarCount = list.length;

  // Parameter names are read from the live schema rather than guessed, and
  // recorded, since the reference pages did not show them for list_events.
  const startKey = pickKey(calendar, 'list_events', ['startTime', 'timeMin', 'start']);
  const endKey = pickKey(calendar, 'list_events', ['endTime', 'timeMax', 'end']);
  const pageKey = pickKey(calendar, 'list_events', ['pageToken']);
  const sizeKey = pickKey(calendar, 'list_events', ['pageSize', 'maxResults']);
  findings.listEventsParams = { startKey, endKey, pageKey, sizeKey, all: Object.keys(props(calendar, 'list_events')) };

  const window = {
    ...(startKey && { [startKey]: `${SEASON_START}T00:00:00` }),
    ...(endKey && { [endKey]: `${SEASON_END}T23:59:59` }),
  };
  const pages = [];
  let token;
  for (let page = 0; page < 20; page += 1) {
    const r = await call(
      'calendar',
      calendar,
      'list_events',
      { ...window, ...(sizeKey && { [sizeKey]: 250 }), ...(token && pageKey && { [pageKey]: token }) },
      `season ${SEASON_START}..${SEASON_END}, page ${page + 1}`,
    );
    if (!r.ok) break;
    const events = r.body?.events ?? r.body?.items ?? [];
    pages.push(events.length);
    if (page === 0) findings.eventShape = shape(events[0]);
    token = r.body?.nextPageToken;
    if (!token) {
      const starts = events.map((e) => e.start?.dateTime ?? e.start?.date ?? e.startTime).filter(Boolean).sort();
      findings.lastPageSpan = [starts[0], starts.at(-1)];
      break;
    }
  }
  findings.seasonPages = pages;
  findings.seasonEvents = pages.reduce((a, b) => a + b, 0);
  // Whether reads expose anything a write guard could compare against.
  findings.guardFieldsOnRead = ['etag', 'updated', 'sequence', 'updateTime'].filter(
    (k) => findings.eventShape && k in findings.eventShape,
  );
  return { findings, calendars: list };
};

// ---------------------------------------------------------------- Calendar writes

/** The product's id rule: `artist` + 32 base32hex chars of a content hash. */
const artistId = (content) => {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  const bytes = createHash('sha256').update(`event ${content}`).digest();
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `artist${out.slice(0, 32)}`;
};

const calendarWrites = async (calendar, calendars) => {
  const calendarId = process.env.SPIKE_CALENDAR_ID;
  const findings = {};
  if (!calendarId || /^primary$/i.test(calendarId)) die('SPIKE_CALENDAR_ID must name a scratch calendar, never primary');
  const target = calendars.find((c) => c.id === calendarId);
  if (target?.primary) die(`${calendarId} is the primary calendar; refusing`);
  if (!target) log(`  note    ${calendarId} was not in list_calendars; continuing only on your confirmation`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question(
    `\nWrite probes will create, edit and delete events on\n  ${calendarId}${target ? ` ("${target.summary}")` : ''}\n` +
      'Type that calendar id again to go ahead, anything else to stop: ',
  );
  rl.close();
  if (typed.trim() !== calendarId) {
    log('  stop    writes skipped');
    return { skipped: true };
  }

  const createProps = props(calendar, 'create_event');
  findings.createEventParams = Object.keys(createProps);
  findings.createEventIdParam = pickKey(calendar, 'create_event', ['id', 'eventId', 'event_id', 'iCalUID']) ?? null;
  findings.updateEventParams = Object.keys(props(calendar, 'update_event'));
  findings.deleteEventParams = Object.keys(props(calendar, 'delete_event'));
  findings.guardParamsOnUpdate = findings.updateEventParams.filter((k) => /etag|match|sequence|precondition|version/i.test(k));

  const idKey = (tool) => pickKey(calendar, tool, ['eventId', 'event_id', 'id']) ?? 'eventId';
  const stamp = new Date().toISOString().slice(0, 16);
  const start = new Date(Date.now() + 7 * 86400e3);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 3600e3);
  const local = (d) => d.toISOString().slice(0, 19);
  const base = {
    calendarId,
    summary: `artist-mcp spike ${stamp}`,
    description: 'Created by scripts/spike-google-mcp.mjs; deleted by it again.',
    location: 'Scratch',
    startTime: local(start),
    endTime: local(end),
    timeZone: 'Europe/Berlin',
    notificationLevel: 'NONE',
  };

  const created = [];
  try {
    // A: our own id, under whatever name the schema offers, or `id` if none —
    // an undocumented field is either refused (the answer) or ignored (then
    // the returned id says so).
    const wanted = artistId(`${base.summary} ${base.startTime}`);
    const a = await call(
      'calendar',
      calendar,
      'create_event',
      { ...base, [findings.createEventIdParam ?? 'id']: wanted },
      `with our id under "${findings.createEventIdParam ?? 'id'}"`,
    );
    let event = a.ok ? a.body : undefined;
    if (event?.id) created.push(event.id);
    findings.customId = a.ok
      ? { accepted: event?.id === wanted, sent: wanted, returned: event?.id }
      : { refused: a.error };

    if (!event) {
      const b = await call('calendar', calendar, 'create_event', base, 'no id');
      event = b.ok ? b.body : undefined;
      if (event?.id) created.push(event.id);
      findings.serverAssignedId = event?.id;
    }
    if (!event?.id) return findings;
    findings.createdEventShape = shape(event);

    // Retry of the same create: with a client id a retry collides; without
    // one, does it double-book?
    const again = await call('calendar', calendar, 'create_event', base, 'same content again (dedup?)');
    if (again.ok && again.body?.id) created.push(again.body.id);
    findings.secondCreate = again.ok ? { newId: again.body?.id, duplicate: again.body?.id !== event.id } : { refused: again.error };

    const got = await call('calendar', calendar, 'get_event', { calendarId, [idKey('get_event')]: event.id }, 'read back');
    findings.getEventGuardFields = ['etag', 'updated', 'sequence'].filter((k) => got.body && k in got.body);
    findings.getEventShape = shape(got.body);

    // Is update a patch or a replace? Send only the summary and see whether
    // the description and location survive.
    const upd = await call(
      'calendar',
      calendar,
      'update_event',
      { calendarId, [idKey('update_event')]: event.id, summary: `${base.summary} (edited)`, notificationLevel: 'NONE' },
      'summary only, notificationLevel NONE',
    );
    const after = await call('calendar', calendar, 'get_event', { calendarId, [idKey('get_event')]: event.id }, 'after update');
    findings.update = {
      ok: upd.ok,
      error: upd.error,
      summaryChanged: after.body?.summary === `${base.summary} (edited)`,
      descriptionKept: after.body?.description === base.description,
      locationKept: after.body?.location === base.location,
      etagBefore: got.body?.etag,
      etagAfter: after.body?.etag,
      updatedBefore: got.body?.updated,
      updatedAfter: after.body?.updated,
    };

    // A stale-guard probe: if the schema offers any precondition field, send
    // the etag from before the update and see whether it is refused.
    for (const key of findings.guardParamsOnUpdate) {
      const stale = await call(
        'calendar',
        calendar,
        'update_event',
        { calendarId, [idKey('update_event')]: event.id, summary: 'should be refused', [key]: got.body?.etag, notificationLevel: 'NONE' },
        `stale ${key}`,
      );
      findings[`staleGuard_${key}`] = stale.ok ? 'ACCEPTED (no guard)' : stale.error;
    }
  } finally {
    for (const id of created) {
      const del = await call(
        'calendar',
        calendar,
        'delete_event',
        { calendarId, [idKey('delete_event')]: id, notificationLevel: 'NONE' },
        'cleanup, notificationLevel NONE',
      );
      const gone = await call('calendar', calendar, 'get_event', { calendarId, [idKey('get_event')]: id }, 'after delete');
      (findings.deletes ??= []).push({ ok: del.ok, error: del.error, stillReadable: gone.ok, status: gone.body?.status });
    }
  }
  return findings;
};

// ---------------------------------------------------------------- main

const main = async () => {
  const clientId = process.env.SPIKE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.SPIKE_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) die('set SPIKE_GOOGLE_CLIENT_ID and SPIKE_GOOGLE_CLIENT_SECRET (a Desktop client)');

  log(`\nGoogle MCP spike — label "${LABEL}", ${results.mode}, agent flag declared: ${results.agentFlagAsDeclared}`);
  log(`redirect  ${REDIRECT_URI}\n`);

  const stored = results.mode === 'reuse' ? await loadStored(clientId) : await signIn(clientId, clientSecret);
  results.token.issuedAt = stored.issuedAt;
  results.token.issuedWithAgentFlag = stored.agentFlagAsDeclared ?? results.agentFlagAsDeclared;
  results.token.grantedScope = stored.scope;

  // The question 1 call: redeem the stored refresh token now.
  const started = performance.now();
  const refreshed = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
  }).then(
    (body) => ({ ok: true, body }),
    (err) => ({ ok: false, error: err.message }),
  );
  results.token.refresh = { ok: refreshed.ok, ms: Math.round(performance.now() - started), error: refreshed.error };
  if (!refreshed.ok) {
    log(`  FAIL    refresh: ${refreshed.error}`);
    await save();
    process.exit(1);
  }
  log(`  ok      refresh token redeemed (${results.token.refresh.ms} ms)`);
  results.token.rotated = Boolean(refreshed.body.refresh_token) && refreshed.body.refresh_token !== stored.refreshToken;
  results.token.accessTokenInfo = await tokenInfo(refreshed.body.access_token);
  log(`  note    access token scopes: ${results.token.accessTokenInfo.scope ?? JSON.stringify(results.token.accessTokenInfo)}`);

  const accessToken = refreshed.body.access_token;
  const gmail = await connect('gmail', accessToken);
  const calendar = await connect('calendar', accessToken);

  if (gmail) results.findings.gmail = await gmailProbes(gmail);
  let calendars = [];
  if (calendar) {
    const reads = await calendarReads(calendar);
    results.findings.calendarReads = reads.findings;
    calendars = reads.calendars;
    if (process.env.SPIKE_WRITE === '1') results.findings.calendarWrites = await calendarWrites(calendar, calendars);
    else log('  skip    write probes (set SPIKE_WRITE=1 and SPIKE_CALENDAR_ID)');
  }

  results.httpRequestsTotal = { ...httpCounts };
  results.toolCallsTotal = {
    gmail: results.calls.filter((c) => c.server === 'gmail').length,
    calendar: results.calls.filter((c) => c.server === 'calendar').length,
  };
  await Promise.all([gmail?.client.close(), calendar?.client.close()]);
  await save();

  log(`\nTool calls: gmail ${results.toolCallsTotal.gmail}, calendar ${results.toolCallsTotal.calendar}`);
  log(`HTTP requests incl. initialize/list: gmail ${httpCounts.gmail}, calendar ${httpCounts.calendar}`);
  log('Compare with Cloud Console → APIs & Services → Gmail MCP / Calendar MCP → Metrics for this hour.');
};

const save = async () => {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(RESULTS_FILE, JSON.stringify(results, null, 2), { mode: 0o600 });
  log(`\nResults (no tokens, no mail bodies): ${RESULTS_FILE}`);
};

main().catch((err) => die(err.stack ?? err.message));
