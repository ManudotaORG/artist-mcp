import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeBody, extractAttachments, extractText, listEmails, readEmail } from '../dist/mail.js';

const b64url = (text) => Buffer.from(text, 'utf8').toString('base64url');

const stubGmail = (routes) => {
  const seen = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    seen.push(path);
    const match = Object.keys(routes).find((key) => path.includes(key));
    return new Response(JSON.stringify(match === undefined ? {} : routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return seen;
};

test.afterEach(() => {
  delete globalThis.fetch;
});

/** base64url uses - and _ where base64 uses + and /, and drops the padding. */
test('base64url bodies decode, including characters that need padding', () => {
  assert.equal(decodeBody(b64url('hello')), 'hello');
  assert.equal(decodeBody(b64url('a')), 'a');
  assert.equal(decodeBody(b64url('ab')), 'ab');
});

test('non-ASCII survives decoding as UTF-8 rather than arriving mojibaked', () => {
  assert.equal(decodeBody(b64url('Müller — soundcheck 20:00')), 'Müller — soundcheck 20:00');
});

test('undecodable data yields empty text rather than throwing', () => {
  assert.equal(decodeBody('!!!not base64!!!'), '');
});

/** A real message is multipart/alternative, often nested inside multipart/mixed. */
test('text/plain is preferred over the HTML sibling', () => {
  const text = extractText({
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/html', body: { data: b64url('<p>html version</p>') } },
      { mimeType: 'text/plain', body: { data: b64url('plain version') } },
    ],
  });
  assert.equal(text, 'plain version');
});

test('HTML is stripped to prose when there is no plain part', () => {
  const text = extractText({
    mimeType: 'multipart/mixed',
    parts: [{ mimeType: 'text/html', body: { data: b64url('<p>one</p><p>two</p>') } }],
  });
  assert.equal(text, 'one\ntwo');
});

test('nested parts are found, not just the top level', () => {
  const text = extractText({
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'application/pdf', body: { attachmentId: 'x' } },
      {
        mimeType: 'multipart/alternative',
        parts: [{ mimeType: 'text/plain', body: { data: b64url('buried') } }],
      },
    ],
  });
  assert.equal(text, 'buried');
});

/**
 * Gmail mints a fresh attachmentId on every fetch, so the published id is the
 * part's position in the MIME tree, which does not move.
 */
test('attachments are identified by MIME position, with Gmail ids kept separate', () => {
  const found = extractAttachments({
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('body') } },
      { mimeType: 'application/pdf', filename: 'rider.pdf', body: { attachmentId: 'aaa', size: 12 } },
      {
        mimeType: 'multipart/related',
        parts: [{ mimeType: 'image/png', filename: 'plot.png', body: { attachmentId: 'bbb' } }],
      },
    ],
  });

  assert.deepEqual(
    found.map((f) => f.id),
    ['2', '3.1'],
  );
  assert.equal(found[0].gmail_id, 'aaa');
  assert.equal(found[1].filename, 'plot.png');
  assert.equal(found[1].size, null);
});

test('an unnamed attachment still gets a usable label', () => {
  const [only] = extractAttachments({
    mimeType: 'multipart/mixed',
    parts: [{ mimeType: 'image/png', body: { attachmentId: 'aaa' } }],
  });
  assert.equal(only.filename, '(unnamed)');
  assert.equal(only.mime_type, 'image/png');
});

test('the volatile Gmail id is never published by read_email', async () => {
  stubGmail({
    '/messages/msg1?': {
      id: 'msg1',
      payload: {
        headers: [{ name: 'Subject', value: 'Rider' }],
        mimeType: 'multipart/mixed',
        parts: [{ mimeType: 'application/pdf', filename: 'r.pdf', body: { attachmentId: 'volatile' } }],
      },
    },
  });

  const mail = await readEmail('token', 'msg1');

  assert.equal(mail.attachments[0].id, '1');
  assert.equal(mail.attachments[0].gmail_id, undefined);
  assert.doesNotMatch(JSON.stringify(mail), /volatile/);
});

test('a malformed email id is refused before any request is made', async () => {
  const seen = stubGmail({});
  for (const bad of ['', '../x', 'a'.repeat(129), 7, undefined]) {
    await assert.rejects(() => readEmail('token', bad), /email_id is missing or malformed/);
  }
  assert.equal(seen.length, 0);
});

test('a message with no body falls back to the snippet', async () => {
  stubGmail({
    '/messages/msg1?': { id: 'msg1', snippet: 'just the preview', payload: { headers: [] } },
  });

  const mail = await readEmail('token', 'msg1');
  assert.equal(mail.text, 'just the preview');
  assert.equal(mail.subject, '(no subject)');
});

/** The user's search syntax goes in a query parameter, never into a path. */
test('a search query is capped and sent as a parameter', async () => {
  const seen = stubGmail({ '/messages?': { messages: [] } });

  await listEmails('token', 'x'.repeat(900));

  const [url] = seen;
  assert.match(url, /[?&]q=x+/);
  assert.equal(new URL(url).searchParams.get('q').length, 500);
});

test('ids of the wrong shape are dropped rather than fetched', async () => {
  const seen = stubGmail({
    '/messages?': { messages: [{ id: 'good1' }, { id: '../../evil' }] },
    '/messages/good1': { id: 'good1', payload: { headers: [{ name: 'From', value: 'a@b.c' }] } },
  });

  const { emails } = await listEmails('token', '');

  assert.equal(emails.length, 1);
  assert.equal(emails[0].from, 'a@b.c');
  assert.ok(!seen.some((u) => u.includes('evil')));
});
