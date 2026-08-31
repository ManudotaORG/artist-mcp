import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEdit, editFrom, previewEdit } from '../dist/onenote-patch.js';

const GUID = '33f8a242-7c33-4bb2-90c5-8425a68cc5bf';
const para = `p:{${GUID}}{40}`;
const other = `p:{${GUID}}{45}`;

const pageHtml = (fee = '1200') =>
  `<html><body><div id="div:{${GUID}}{32}">` +
  `<p id="${para}">Fee: ${fee}</p>` +
  `<p id="${other}">Load-in 18:00</p>` +
  `</div></body></html>`;

/** A page read, then a 204 for the patch, recording what went out. */
const server = ({ html = pageHtml(), etag = 'W/"1"' } = {}) => {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      return new Response(html, { status: 200, headers: { etag } });
    }
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return { sent, fetchImpl };
};

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const audit = () => {
  const lines = [];
  return { lines, record: async (entry) => void lines.push(entry) };
};

test('a replace needs a generated id, and an append refuses one', () => {
  assert.throws(() => editFrom({ page_id: 'p1', action: 'replace', text: 'x' }), /needs element_id/);
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'replace', text: 'x', element_id: 'intro' }),
    /generated id/,
  );
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'append', text: 'x', element_id: para }),
    /takes no element_id/,
  );
  assert.throws(() => editFrom({ page_id: 'p1', action: 'delete', text: 'x' }), /append.*replace/s);
});

test('the preview quotes what would be overwritten', async () => {
  const { fetchImpl } = server();
  const preview = await withFetch(fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: para, text: 'Fee: 1400' }),
  );

  assert.match(preview.preview, /Fee: 1200/, 'the musician must see what is destroyed');
  assert.match(preview.preview, /Fee: 1400/);
  assert.match(preview.note, /OneNote keeps no version/);
});

test('the preview lists the parts, so an id never has to be guessed', async () => {
  const { fetchImpl } = server();
  const preview = await withFetch(fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'append', text: 'Curfew 23:00' }),
  );

  assert.deepEqual(preview.parts, [
    { element_id: para, text: 'Fee: 1200' },
    { element_id: other, text: 'Load-in 18:00' },
  ]);
});

test('an edit previewed against one value will not apply to another', async () => {
  // The token binds the pre-image, so a page edited in OneNote between the
  // preview and the apply fails closed rather than overwriting the new value.
  const shown = server();
  const preview = await withFetch(shown.fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: para, text: 'Fee: 1400' }),
  );

  const moved = server({ html: pageHtml('1250') });
  const { lines, record } = audit();

  await withFetch(moved.fetchImpl, async () => {
    await assert.rejects(
      applyEdit(
        't',
        {
          page_id: 'p1',
          action: 'replace',
          element_id: para,
          text: 'Fee: 1400',
          confirmation_token: preview.confirmation_token,
        },
        record,
      ),
      /not what was previewed/,
    );
  });

  assert.deepEqual(moved.sent, [], 'nothing may be written when the page moved');
  assert.deepEqual(lines, [], 'and nothing may be recorded as written');
});

test('a replace sends If-Match from the read it just did', async () => {
  const s = server({ etag: 'W/"7"' });
  const preview = await withFetch(s.fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: para, text: 'Fee: 1400' }),
  );

  const { record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'replace',
        element_id: para,
        text: 'Fee: 1400',
        confirmation_token: preview.confirmation_token,
      },
      record,
    ),
  );

  assert.equal(s.sent[0].headers['if-match'], 'W/"7"');
  assert.deepEqual(s.sent[0].body, [
    { target: para, action: 'replace', content: '<p>Fee: 1400</p>' },
  ]);
});

test('what a replace destroyed is written to the audit line, and nowhere else', async () => {
  const s = server();
  const preview = await withFetch(s.fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'replace', element_id: para, text: 'Fee: 1400' }),
  );

  const { lines, record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'replace',
        element_id: para,
        text: 'Fee: 1400',
        confirmation_token: preview.confirmation_token,
      },
      record,
    ),
  );

  assert.equal(lines.length, 1);
  assert.equal(lines[0].operation, 'replace_onenote_element');
  // The only surviving copy of the previous content once the PATCH returns 204.
  assert.equal(lines[0].pre_image, `<p id="${para}">Fee: 1200</p>`);
});

test('an append records no pre-image, because it destroyed nothing', async () => {
  const s = server();
  const preview = await withFetch(s.fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'append', text: 'Curfew 23:00' }),
  );

  const { lines, record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'append',
        text: 'Curfew 23:00',
        confirmation_token: preview.confirmation_token,
      },
      record,
    ),
  );

  assert.equal(lines[0].operation, 'append_onenote_page');
  assert.equal(lines[0].pre_image, null);
  assert.deepEqual(s.sent[0].body, [
    { target: 'body', action: 'append', content: '<p>Curfew 23:00</p>' },
  ]);
});

test('an edit with no token, or a stale one, writes nothing', async () => {
  const s = server();
  const { lines, record } = audit();

  await withFetch(s.fetchImpl, async () => {
    for (const token of [undefined, 'not-the-token']) {
      await assert.rejects(
        applyEdit(
          't',
          { page_id: 'p1', action: 'append', text: 'x', confirmation_token: token },
          record,
        ),
        /confirmation token does not match/,
      );
    }
  });

  assert.deepEqual(s.sent, []);
  assert.deepEqual(lines, []);
});

test('text going onto a page is escaped', async () => {
  const s = server();
  const preview = await withFetch(s.fetchImpl, () =>
    previewEdit('t', { page_id: 'p1', action: 'append', text: 'Fee & rider <b>' }),
  );

  const { record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'append',
        text: 'Fee & rider <b>',
        confirmation_token: preview.confirmation_token,
      },
      record,
    ),
  );

  assert.equal(s.sent[0].body[0].content, '<p>Fee &amp; rider &lt;b&gt;</p>');
});
