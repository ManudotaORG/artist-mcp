import assert from 'node:assert/strict';
import test from 'node:test';

import { onenotePageContent, onenotePatchPage } from '../dist/api.js';
import { GraphError, ScopeError } from '../dist/client.js';

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const refusal = (status, body) => new Response(body, { status });

test('reading a page asks for the ids a patch can aim at', async () => {
  let seen;
  await withFetch(
    async (url) => {
      seen = url;
      return new Response('<html></html>', { status: 200, headers: { etag: 'W/"1"' } });
    },
    async () => {
      const page = await onenotePageContent('page-1', 't');
      assert.equal(page.html, '<html></html>');
      // The only thing that can tell us the page moved between read and write.
      assert.equal(page.etag, 'W/"1"');
    },
  );

  assert.match(seen, /includeIDs=true/, 'without this the generated ids are absent entirely');
});

test('the etag is sent as If-Match so a concurrent edit is refused', async () => {
  let headers;
  await withFetch(
    async (_url, init) => {
      headers = init.headers;
      return new Response(null, { status: 204 });
    },
    () => onenotePatchPage('page-1', [{ target: 'body', action: 'append', content: '<p>x</p>' }], 't', 'W/"1"'),
  );

  assert.equal(headers['if-match'], 'W/"1"');
});

test('a page that moved under us is reported, never retried over the top', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return refusal(412, '');
    },
    async () => {
      await assert.rejects(
        onenotePatchPage('p', [{ target: 'body', action: 'append', content: '<p>x</p>' }], 't', 'W/"1"'),
        (err) => err instanceof GraphError && /changed while this change was being prepared/.test(err.message),
      );
    },
  );

  assert.equal(calls, 1, 'retrying would overwrite whatever was just done to the page');
});

test("a page this tool did not create is refused as ownership, not as a fault", async () => {
  // 40003 is a page the musician wrote, 40006 one another app created. This is
  // the boundary the capability rests on, and Microsoft keeps it, not us.
  for (const [status, code] of [
    [401, '40003'],
    [403, '40006'],
  ]) {
    await withFetch(
      async () => refusal(status, JSON.stringify({ error: { code } })),
      async () => {
        await assert.rejects(
          onenotePatchPage('p', [{ target: 'body', action: 'append', content: '<p>x</p>' }], 't', null),
          (err) => err instanceof GraphError && /not created by artist-mcp/.test(err.message),
        );
      },
    );
  }
});

test('a connection predating the grant is told to reconnect', async () => {
  await withFetch(
    async () => refusal(403, JSON.stringify({ error: { code: '40004', message: 'scope' } })),
    async () => {
      await assert.rejects(
        onenotePatchPage('p', [{ target: 'body', action: 'append', content: '<p>x</p>' }], 't', null),
        (err) => err instanceof ScopeError && /Reconnect/.test(err.message),
      );
    },
  );
});

test('20134 and 20138 are told apart, because they read alike and are not alike', async () => {
  // 20134: the target did not resolve — for a generated id, it moved since the
  // read. 20138: the element resolved and does not support that action.
  await withFetch(
    async () => refusal(400, JSON.stringify({ error: { code: '20134' } })),
    async () => {
      await assert.rejects(
        onenotePatchPage('p', [{ target: 'x', action: 'replace', content: '<p>x</p>' }], 't', null),
        (err) => /could not be found/.test(err.message) && /Nothing was written/.test(err.message),
      );
    },
  );

  await withFetch(
    async () => refusal(400, JSON.stringify({ error: { code: '20138' } })),
    async () => {
      await assert.rejects(
        onenotePatchPage('p', [{ target: 'x', action: 'append', content: '<p>x</p>' }], 't', null),
        (err) => /cannot be changed in that way/.test(err.message),
      );
    },
  );
});
