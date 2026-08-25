import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
];

const allMigrations = [
  '20260810000000_init.sql',
  '20260810010000_revoke_public_execute.sql',
  '20260824120000_hosted_token_custody.sql',
  '20260824130000_revoke_hosted_functions_from_roles.sql',
  '20260824140000_resolve_mcp_key.sql',
  '20260824150000_oauth_server.sql',
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
