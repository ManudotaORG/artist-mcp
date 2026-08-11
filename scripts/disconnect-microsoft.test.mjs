import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260811145654_disconnect_microsoft.sql', import.meta.url),
  'utf8',
).toLowerCase();

test('disconnect is authenticated, invoker-secured, and revokes both credentials', () => {
  assert.match(migration, /security invoker/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /delete from public\.mcp_keys/);
  assert.match(migration, /delete from public\.connections/);
  assert.match(migration, /revoke execute on function public\.disconnect_microsoft\(\) from public, anon/);
  assert.match(migration, /grant execute on function public\.disconnect_microsoft\(\) to authenticated/);
});
