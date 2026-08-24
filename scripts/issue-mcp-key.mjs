/**
 * Mint a connection key for one named user of the hosted MCP.
 *
 * A maintainer operation, not a product feature. Hosted access is for people
 * who were told what it means and agreed to it, so issuing a key is a
 * deliberate act by someone with the service role — not something a visitor can
 * do for themselves. That is the isolation issue #55 asks for, expressed as
 * "there is no button".
 *
 * The key is printed once and never stored. Only its sha256 goes to the
 * database, so losing it means issuing another, and a stolen dump yields
 * hashes that cannot be presented.
 *
 *   node scripts/issue-mcp-key.mjs <email> [--env apps/web/.env.local]
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const envPath = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'apps/web/.env.local';

if (email === undefined) {
  console.error('Usage: node scripts/issue-mcp-key.mjs <email> [--env <path>]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const [k, ...rest] = l.split('=');
      return [k.trim(), rest.join('=').trim().replace(/^"|"$/g, '')];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error(`${envPath} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}

const headers = {
  apikey: secret,
  authorization: `Bearer ${secret}`,
  'content-type': 'application/json',
};

// Paged, because the admin endpoint returns the first page only and a missing
// user would otherwise be reported as "no account" when there simply were more.
const findUser = async () => {
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`Listing users failed: HTTP ${res.status}`);
    const { users = [] } = await res.json();
    if (users.length === 0) return undefined;
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
};

const user = await findUser();
if (user === undefined) {
  console.error(
    `No account for ${email}. Hosted access needs one deliberately created — ` +
      'signup is closed, which is the point.',
  );
  process.exit(1);
}

// 32 bytes, so guessing is not a strategy. The prefix makes the string
// recognisable in a log or a config file as something that should not be there.
const key = `amcp_${randomBytes(32).toString('base64url')}`;
const keyHash = createHash('sha256').update(key).digest('hex');

const res = await fetch(`${url}/rest/v1/mcp_keys`, {
  method: 'POST',
  headers: { ...headers, prefer: 'return=representation' },
  body: JSON.stringify({ user_id: user.id, key_hash: keyHash }),
});

if (!res.ok) {
  console.error(`Storing the key failed: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`Issued for ${user.email} (${user.id}).`);
console.log('\nShown once. It is not recoverable — issue another if it is lost.\n');
console.log(`  ${key}\n`);
console.log('Send as: Authorization: Bearer <key>');
