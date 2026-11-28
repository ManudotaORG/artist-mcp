import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

/**
 * These assert the grants on the hosted custody functions, because getting
 * them wrong is silent. A function that is reachable by anon looks exactly like
 * one that is not until someone calls it with valid arguments, and the first
 * attempt at this shipped two functions the public key could call.
 *
 * The trap is specific: Supabase's default privileges on the public schema
 * grant EXECUTE on new functions to anon and authenticated explicitly, which is
 * a different grant from the implicit one to PUBLIC. Revoking one leaves the
 * other. Both revokes are required, so both are asserted.
 */

const read = (file) =>
  readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8').toLowerCase();

const CUSTODY_FUNCTIONS = [
  'connection_access_token',
  'try_lock_refresh',
  'store_refreshed_tokens',
  'release_refresh_lock',
  'set_connection',
  'connection_refresh_token',
  'resolve_mcp_key',
  'redeem_oauth_code',
  'resolve_oauth_token',
  // What an account is allowed to do must not be readable or settable with the
  // publishable key, for the same reason its tokens are not.
  'write_grants_for',
  'set_write_grants',
  // A record anyone could write is not a record.
  'record_write',
  // A log of what was written on someone's pages, with what it replaced, is as
  // private as the pages (0018).
  'writes_for',
  // The task view's snapshot holds task text (0020): as private as the pages.
  'set_task_view_notebooks',
  'claim_task_refresh',
  'task_refresh_claim',
  'store_task_listing',
  'store_task_pages',
  'fail_task_notebook',
  'task_view_for',
  'mark_task_view_seen',
  // 0023: one page's tasks re-read after a tick, replacing a stored page only.
  'store_task_page',
];

const allMigrations = [
  '20260810000000_init.sql',
  '20260810010000_revoke_public_execute.sql',
  '20260824120000_hosted_token_custody.sql',
  '20260824130000_revoke_hosted_functions_from_roles.sql',
  '20260826090000_write_grants.sql',
  '20260826100000_write_audit.sql',
  '20260831120000_write_audit_pre_image.sql',
  '20261123120000_write_audit_two_phase.sql',
  '20260824140000_resolve_mcp_key.sql',
  '20260824150000_oauth_server.sql',
  '20261124120000_task_view.sql',
  '20261125120000_forget_google_writes.sql',
  '20261125130000_forget_onenote_writes.sql',
  '20261126120000_task_view_tick.sql',
]
  .map(read)
  .join('\n');

const revokesFrom = (fn, role) => {
  // Any revoke of this function naming this role, across every migration.
  const pattern = new RegExp(
    `revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)[\\s\\S]{0,80}?from[^;]*\\b${role}\\b`,
  );
  return pattern.test(allMigrations);
};

for (const fn of CUSTODY_FUNCTIONS) {
  test(`${fn} is revoked from public, anon and authenticated`, () => {
    assert.ok(revokesFrom(fn, 'public'), `${fn} is never revoked from public`);
    assert.ok(
      revokesFrom(fn, 'anon'),
      `${fn} is never revoked from anon — Supabase's default privileges grant it explicitly`,
    );
    assert.ok(
      revokesFrom(fn, 'authenticated'),
      `${fn} is never revoked from authenticated — the same default privilege applies`,
    );
  });
}

test('the custody functions are reachable only by the service role', () => {
  const custody = read('20260824120000_hosted_token_custody.sql');
  // Only the grantee list is examined. The statement itself contains
  // "public" in every function's schema-qualified name, so matching the whole
  // statement would flag every correct grant.
  const grantees = [...custody.matchAll(/grant\s+execute\s+on\s+function\s+[^;]*?\sto\s+([a-z_,\s]+);/g)].map(
    (m) => m[1].trim(),
  );
  assert.ok(grantees.length > 0, 'no grants found at all');
  for (const grantee of grantees) {
    assert.equal(
      grantee,
      'service_role',
      `a custody function is granted to something other than service_role: ${grantee}`,
    );
  }
});

test('tokens are encrypted with a key the database never stores', () => {
  const init = read('20260810000000_init.sql');
  const custody = read('20260824120000_hosted_token_custody.sql');
  assert.match(init, /pgp_sym_encrypt/);
  assert.match(custody, /pgp_sym_encrypt\(p_access_token, p_key\)/);
  // The key arrives as an argument on every call. A column holding it would
  // make the encryption decorative, since a dump would carry both halves.
  assert.doesNotMatch(init + custody, /add column[^;]*encryption_key/);
});

test('every oauth table has row level security enabled', () => {
  const oauth = read('20260824150000_oauth_server.sql');
  // Every table in this schema is served by PostgREST, so one without RLS is a
  // public endpoint — and these hold client registrations, live authorization
  // codes and token hashes.
  for (const table of ['oauth_clients', 'oauth_codes', 'oauth_tokens']) {
    assert.match(
      oauth,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      `${table} is exposed through PostgREST without RLS`,
    );
  }
});

test('an authorization code is redeemed in a single statement', () => {
  const oauth = read('20260824150000_oauth_server.sql');
  // Check-then-update lets two simultaneous redemptions both pass the check,
  // and a code that can be spent twice is an account takeover.
  assert.match(oauth, /update public\.oauth_codes[\s\S]*?set redeemed_at = now\(\)/);
  assert.match(oauth, /where[\s\S]*?redeemed_at is null/);
  assert.match(oauth, /and expires_at > now\(\)/);
});

test('the refresh lease is claimed in a single statement', () => {
  const custody = read('20260824120000_hosted_token_custody.sql');
  // Two statements — read then write — would let both callers observe a free
  // lease before either took it, which is the race this exists to prevent.
  assert.match(custody, /update public\.connections[\s\S]*?refresh_lock_until = now\(\)/);
  assert.match(custody, /where[\s\S]*?refresh_lock_until is null or refresh_lock_until < now\(\)/);
});

/**
 * A refresh must never ask for more than the connection was granted.
 *
 * The hosted refresh sent `scope: config.scope` — whatever the current build
 * would ask for. `config` comes from the package, so adding a scope there
 * (calendar.calendarlist.readonly, in 1.5.0) armed every hosted connection made
 * before it to fail on its next refresh: an hour later, inside a session, far
 * from the change that caused it. The package hit the identical bug and fixed
 * it by sending the stored scope; hosted stores none, so it sends nothing,
 * which returns exactly what was granted.
 *
 * Asserted over the source because the alternative is a live OAuth round trip
 * against a real connection, and the failure is silent until a token expires.
 */
test('the hosted refresh does not ask for a scope', () => {
  const source = readFileSync(
    new URL('../apps/web/src/lib/hosted-tokens.ts', import.meta.url),
    'utf8',
  );
  // Comments first, and before matching: the comment explaining this bug is
  // longer than the object it guards, so a window sized for code would miss the
  // object entirely and the assertion would pass by accident.
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  const refreshBody = code.match(/grant_type:\s*'refresh_token'[\s\S]{0,400}?\}/);
  assert.ok(refreshBody, 'the refresh_token grant is no longer a literal object');

  assert.doesNotMatch(
    refreshBody[0],
    /\bscope\s*:/,
    'The hosted refresh sends a scope again. A refresh asking for more than the ' +
      'grant carries is rejected, so this breaks connections made before the ' +
      'current scope list — in a session, not in CI.',
  );
});


/**
 * A table in this schema without RLS is a public PostgREST endpoint. This one
 * holds what each account is allowed to do, so a missing policy would let
 * anyone with the publishable key read — or worse, grant — a write capability.
 */
test('write_grants is not exposed through PostgREST', () => {
  const grants = read('20260826090000_write_grants.sql');
  assert.match(
    grants,
    /alter table public\.write_grants\s+enable row level security/,
    'write_grants is served by PostgREST without RLS',
  );
  assert.doesNotMatch(
    grants,
    /create policy/,
    'A policy on write_grants makes it reachable by a role other than the ' +
      'service role. Reads go through write_grants_for.',
  );
});

/**
 * Replacing rather than merging is what makes a grant withdrawable. A merge
 * would need a second function to remove one, and a capability nobody can take
 * back is not opt-in.
 */
test('setting grants replaces the set, so a capability can be withdrawn', () => {
  const grants = read('20260826090000_write_grants.sql');
  assert.match(grants, /delete from public\.write_grants/);
});

// ------------------------------------------------------------ hosted grants

const webSource = (file) =>
  readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');

/**
 * A failure to read the grant must land on the read-only side.
 *
 * An unreachable database, a missing function, a renamed capability — any of
 * them would otherwise let a fault decide that someone may write to a calendar.
 * This is the one place where "fail closed" is not a slogan: the closed side is
 * what the product was before #85.
 */
test('an unreadable grant is treated as no grant', () => {
  const source = webSource('lib/write-grants.ts');
  assert.match(source, /catch/, 'write-grants does not handle a failed read at all');
  // Every exit from the error paths returns nothing granted.
  const returns = [...source.matchAll(/return\s+\[\]/g)];
  assert.ok(
    returns.length >= 2,
    'a failed read should return no capabilities, on both the error and the throw path',
  );
});

/**
 * The security argument for hosted writes in 0002: a user who never opted in
 * holds a read-only token, so a compromise of this service cannot write their
 * calendar. A fixed write scope on the consent route would make every account's
 * token write-capable to serve the few who asked.
 */
test('the consent scope comes from the user grant, not a constant', () => {
  const route = webSource('app/api/auth/[provider]/route.ts');
  assert.match(
    route,
    /scopesFor\(\s*provider,\s*await writeGrantsFor\(/,
    'the authorize scope is no longer derived from this user\'s grant',
  );
  assert.doesNotMatch(
    route,
    /calendar\.events(?!\.readonly)/,
    'a write scope is named directly in the consent route, which would ask for ' +
      'it regardless of whether this user opted in',
  );
});

/**
 * One process serves many users. A grant read once and reused would hand one
 * user's capability to another's session — the failure createServer taking a
 * parameter exists to prevent.
 */
test('the hosted MCP route reads the grant per request', () => {
  const route = webSource('app/api/mcp/route.ts');
  assert.match(route, /await writeGrantsFor\(userId\)/);
  // Inside the request handler, not at module scope.
  const handler = route.slice(route.indexOf('const handle'));
  assert.match(handler, /writeGrantsFor\(userId\)/, 'the grant is read outside the handler');
});


/**
 * A file in a home directory is the local sink; on a serverless host it is a
 * file nobody will ever read. "Detectable and reversible" is the whole
 * justification for these writes existing, so hosted without the detectable
 * half would be strictly worse than the local case, not equivalent.
 */
test('write_audit is not exposed through PostgREST', () => {
  const audit = read('20260826100000_write_audit.sql');
  assert.match(audit, /alter table public\.write_audit\s+enable row level security/);
  assert.doesNotMatch(audit, /create policy/);
});

/**
 * A record that can be edited is not one. There is no function to amend or
 * remove a row, and adding one would need arguing for here first.
 */
test('nothing can amend or remove an audit row', () => {
  // Every migration touching the table, including the one that made recording
  // two-phase: completion is a second row, never an update of the first.
  for (const file of [
    '20260826100000_write_audit.sql',
    '20260831120000_write_audit_pre_image.sql',
    '20261123120000_write_audit_two_phase.sql',
  ]) {
    const audit = read(file);
    assert.doesNotMatch(audit, /update\s+public\.write_audit/, `${file} amends an audit row`);
    assert.doesNotMatch(audit, /delete\s+from\s+public\.write_audit/, `${file} removes an audit row`);
  }
});

/**
 * The two-phase migration has to be safe to apply before the code that uses it
 * ships: the running deployment calls record_write with six named arguments, so
 * every parameter after them needs a default, or production stops recording.
 */
test('the two-phase record_write still accepts the six-argument call', () => {
  const sql = read('20261123120000_write_audit_two_phase.sql');
  const signature = sql.match(/create function public\.record_write\(([\s\S]*?)\)\s*returns/)[1];
  for (const param of ['p_write_id', 'p_status', 'p_wrote']) {
    assert.match(signature, new RegExp(`${param}\\s+\\w+\\s+default\\s+null`), `${param} has no default`);
  }
});

test('the hosted sink refuses a write whose pending record failed', () => {
  const sink = webSource('lib/write-audit.ts');
  assert.match(sink, /entry\.status === 'pending'[\s\S]{0,200}throw new UnrecordedWriteError/);
});

/**
 * The audit must record what was written, not a reference to it: a wrong create
 * leaves something visible, a wrong delete leaves a gap, and nobody notices an
 * absence. The row has to be enough to put the event back by hand.
 */
test('an audit row carries the event as a person would read it', () => {
  const audit = read('20260826100000_write_audit.sql');
  for (const column of ['summary', 'target', 'source_page']) {
    assert.match(audit, new RegExp(`\\b${column}\\b`), `write_audit has no ${column}`);
  }
});

/**
 * Bound to one user, like hostedTokens. A recorder that took the user id per
 * call could be handed the wrong one; one that closes over it cannot.
 */
test('the hosted audit sink is bound to a single user', () => {
  const sink = webSource('lib/write-audit.ts');
  assert.match(sink, /hostedAudit\s*=\s*\(\s*userId: string\s*\)/);
  assert.match(sink, /p_user_id: userId/);
});

/**
 * The event exists by the time the record is written. Throwing would report a
 * successful write as a failure, which is the one outcome guaranteed to make
 * someone create it a second time.
 */
test('a failed audit does not fail a completed write', () => {
  // The catch in hostedAudit throws for exactly one case: a pending record,
  // made before a write that must then not happen (0018). For every completed
  // write the failure is swallowed, as it always was.
  const sink = webSource('lib/write-audit.ts');
  const audit = sink.slice(sink.indexOf('export const hostedAudit'), sink.indexOf('export const hostedWriteLog'));
  const handler = audit.slice(audit.indexOf('} catch (err) {'));
  const throws = handler.match(/\bthrow\b/g) ?? [];
  assert.equal(throws.length, 1, 'the catch throws for something other than a pending record');
  assert.match(handler, /if \(entry\.status === 'pending'\) \{\s*throw new UnrecordedWriteError/);
});


/**
 * Granting is done with the service role, because `set_write_grants` is revoked
 * from `authenticated` on purpose: what an account is allowed to do must not be
 * settable with the key the browser holds. The user id comes from the session,
 * so the action can only ever change the caller's own row.
 */
test('granting a write uses the service role and the session user', () => {
  const actions = webSource('app/actions.ts');
  const fn = actions.slice(actions.indexOf('export const setWriteGrant'));
  assert.match(fn, /supabaseAdmin\(\)\.rpc\('set_write_grants'/, 'the grant is set with the browser key');
  assert.doesNotMatch(fn, /supabase\.rpc\('set_write_grants'/, 'the grant is set with the session client');
  assert.match(fn, /p_user_id: user\.id/, 'the grant is set for someone other than the caller');
  assert.match(fn, /auth\.getUser\(\)/);
});

test('withdrawing sends an empty set rather than deleting nothing', () => {
  const actions = webSource('app/actions.ts');
  const fn = actions.slice(actions.indexOf('export const setWriteGrant'));
  assert.match(fn, /wanted \? \(Object\.keys\(WRITE_CAPABILITIES\)[^)]*\) : \[\]/);
});

/**
 * The dashboard asks one question and grants everything, so the set it grants
 * has to be derived. Listing the capabilities here would let the switch come to
 * mean less than its own label says the moment one was added.
 */
test('the single switch grants every capability, derived rather than listed', () => {
  const actions = webSource('app/actions.ts');
  const fn = actions.slice(actions.indexOf('export const setWriteGrant'));
  assert.match(fn, /Object\.keys\(WRITE_CAPABILITIES\)/);
  assert.doesNotMatch(fn, /'calendar-create'/, 'the switch names capabilities instead of deriving them');
});

/**
 * The other half of that decision. One switch means a capability added later is
 * covered by consent already given, and the only thing that keeps it honest is
 * clearing the grants so everyone answers the newly-worded question again.
 */
test('the capability that widened the switch also reset the grants', () => {
  const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url));
  const reset = migrations.filter((name) => /reset_write_grants/.test(name));
  assert.notDeepEqual(reset, [], 'no migration clears grants after the switch widened');
  assert.match(read(reset.at(-1)), /delete from public\.write_grants/);
});

/**
 * A grant that silently does nothing until an unrelated step is worse than no
 * grant. A token carries the scopes it was granted with, so allowing writes on
 * an existing connection changes nothing until it is renewed — and the page has
 * to say so where the choice is made, not in documentation.
 */
test('the connect screen states that a grant needs a reconnect', () => {
  const page = webSource('app/page.tsx');
  assert.match(page, /FOR THIS TO TAKE\n?\s*EFFECT/);
  // Both providers, since a grant now widens each of them.
  assert.match(page, /RECONNECT \{\[\.\.\.connected\]/);
  // And the off state says plainly that nothing can change either source.
  assert.match(page, /NOT ALLOWED — READ ONLY\. NOTHING CAN CHANGE YOUR CALENDAR OR YOUR NOTES/);
});

test('the service-role client is built in one file and nowhere else', () => {
  // It reads every hosted user's rows. Six copies of its construction used to
  // disagree about a missing key; one file means one place to read, and a
  // seventh copy fails here rather than in review.
  const root = new URL('../apps/web/src/', import.meta.url);
  const sources = readdirSync(root, { recursive: true })
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => [file.replaceAll('\\', '/'), readFileSync(new URL(file, root), 'utf8')]);

  const readers = sources
    .filter(([, source]) => source.includes('SUPABASE_SERVICE_ROLE_KEY'))
    .map(([file]) => file);
  assert.deepEqual(readers, ['lib/supabase/admin.ts']);

  const admin = sources.find(([file]) => file === 'lib/supabase/admin.ts')[1];
  assert.match(admin, /^import 'server-only';/m, 'the helper must be server-only');
});

/**
 * The task view's snapshot (0020) holds task text. No table of it may be
 * reachable through PostgREST, the text is encrypted with the per-call key, and
 * disconnecting Microsoft deletes it.
 */
test('the task view snapshot is not exposed, is encrypted, and goes with a disconnect', () => {
  const view = read('20261124120000_task_view.sql');
  for (const table of ['task_view_users', 'task_view_notebooks', 'task_view_pages']) {
    assert.match(view, new RegExp(`alter table public\\.${table}\\s+enable row level security`), `${table} without RLS`);
  }
  assert.doesNotMatch(view, /create policy/, 'a policy makes the snapshot reachable by a role other than the service role');
  assert.match(view, /pgp_sym_encrypt\(\(r->'tasks'\)::text, p_key\)/);
  assert.doesNotMatch(view, /add column[^;]*encryption_key/);
  assert.match(view, /if p_provider = 'microsoft' then\s+perform public\.forget_my_task_view\(\)/);
  // The one function the signed-in user may call takes no argument, so it
  // cannot name another account.
  assert.match(view, /create function public\.forget_my_task_view\(\)/);
  assert.match(view, /revoke execute on function public\.forget_my_task_view\(\) from public, anon/);
});

/**
 * Google's Workspace AI Tools Addendum, 2(d): nothing obtained through Google
 * is kept after the person disconnects it (0022). The calendar rows of the
 * write log hold event content, so a Google disconnect deletes them, through a
 * function that takes no argument and so can only reach the caller's own rows.
 */
test('a Google disconnect deletes that user\'s calendar rows of the write log', () => {
  const forget = read('20261125120000_forget_google_writes.sql');
  assert.match(forget, /if p_provider = 'google' then\s+perform public\.forget_my_google_writes\(\)/);
  assert.match(forget, /if p_provider = 'microsoft' then\s+perform public\.forget_my_task_view\(\)/, 'the Microsoft side is kept');
  assert.match(forget, /create function public\.forget_my_google_writes\(\)/);
  assert.match(forget, /where user_id = me\s+and operation like '%calendar%'/);
  assert.match(forget, /revoke execute on function public\.forget_my_google_writes\(\) from public, anon/);
  // Whatever migration defines disconnect_provider last is the one in force,
  // and it has to carry the Google branch.
  assert.match(read(latestDisconnect()), /if p_provider = 'google' then\s+perform public\.forget_my_google_writes\(\)/, `${latestDisconnect()} drops the Google branch`);
});

/**
 * 0019 decision 4: once the edit previews are retired the write log's
 * pre-images are the only way back for every OneNote overwrite, and they do not
 * outlive the consent behind them. A Microsoft disconnect deletes that user's
 * OneNote rows — every row that is not a calendar row — through a function
 * that takes no argument, and keeps forgetting the task view.
 */
test('a Microsoft disconnect deletes that user\'s OneNote rows of the write log', () => {
  const forget = read('20261125130000_forget_onenote_writes.sql');
  assert.match(forget, /create function public\.forget_my_onenote_writes\(\)/);
  assert.match(forget, /where user_id = me\s+and operation not like '%calendar%'/);
  assert.match(forget, /revoke execute on function public\.forget_my_onenote_writes\(\) from public, anon/);
  const latest = read(latestDisconnect());
  assert.match(
    latest,
    /if p_provider = 'microsoft' then\s+perform public\.forget_my_task_view\(\);\s+perform public\.forget_my_onenote_writes\(\)/,
    `${latestDisconnect()} drops a Microsoft branch`,
  );
});

/** The migration whose definition of disconnect_provider is the one in force. */
function latestDisconnect() {
  return readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((f) => f.endsWith('.sql') && /function public\.disconnect_provider/.test(read(f)))
    .sort()
    .at(-1);
}
