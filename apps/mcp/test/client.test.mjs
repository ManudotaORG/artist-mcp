import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEndpoint, endpoint } from '../dist/client.js';

const productionEndpoint = 'https://zxiemadwrkcoovvpscfb.supabase.co/functions/v1/graph';
const stagingEndpoint = 'https://cakkwvxwlkdfzqjbvrpa.supabase.co/functions/v1/graph';

test('selects an isolated service endpoint from the package version', () => {
  assert.equal(defaultEndpoint('1.2.3'), productionEndpoint);
  assert.equal(defaultEndpoint('1.2.4-staging.317'), stagingEndpoint);
});

test('keeps the endpoint override for development and testing', () => {
  process.env.ARTIST_MCP_ENDPOINT = 'http://127.0.0.1:54321/functions/v1/graph';
  try {
    assert.equal(endpoint(), process.env.ARTIST_MCP_ENDPOINT);
  } finally {
    delete process.env.ARTIST_MCP_ENDPOINT;
  }
});
