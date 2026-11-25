import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEdit, editFrom, editablePartsFrom } from '../dist/onenote-patch.js';

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

test('a replace with no element_id is sent to read_note for the ids', () => {
  // preview_onenote_edit answered this with the page's parts until 0019 step 4;
  // read_note returns them now, and the refusal says so.
  assert.throws(
    () => editFrom({ page_id: 'p1', action: 'replace', text: 'Fee: 1400' }),
    /as read_note lists it/,
  );
});

test('a page with no generated ids has no editable parts', () => {
  assert.deepEqual(editablePartsFrom('<html><body><div><p>no ids at all</p></div></body></html>'), []);
});

test('entities OneNote stores are decoded before the musician reads them', () => {
  // OneNote hands back an apostrophe as the numeric &#39;, not the &apos; this
  // tool writes. A decoder built only from what we emit showed a live preview
  // reading "the product&#39;s own tool path".
  const html =
    `<html><body><div id="div:{${GUID}}{32}">` +
    `<p id="${para}">The band&#39;s fee &amp; rider &#x2014; agreed</p>` +
    `</div></body></html>`;
  assert.equal(editablePartsFrom(html)[0].text, "The band's fee & rider — agreed");
});

test('the result quotes what was overwritten and what replaced it, and the way back', async () => {
  // What the preview showed before the write, the result shows after it (0019).
  const { fetchImpl } = server();
  const result = await withFetch(fetchImpl, () =>
    applyEdit('t', { page_id: 'p1', action: 'replace', element_id: para, text: 'Fee: 1400', expect: 'Fee: 1200' }, audit().record),
  );
  assert.match(result.note, /Replaced this:\n\nFee: 1200\n\nWith this:\n\nFee: 1400/);
  assert.match(result.note, /OneNote keeps no version/);
  assert.match(result.note, /call undo_write with its write id/);
});

test('an edit made against one value will not apply to another', async () => {
  // The page was edited in OneNote after the caller read it: the expect no
  // longer matches, and the write fails closed rather than overwriting it.
  const moved = server({ html: pageHtml('1250') });
  const { lines, record } = audit();

  await withFetch(moved.fetchImpl, async () => {
    await assert.rejects(
      applyEdit('t', { page_id: 'p1', action: 'replace', element_id: para, text: 'Fee: 1400', expect: 'Fee: 1200' }, record),
      /changed since it was read/,
    );
  });

  assert.deepEqual(moved.sent, [], 'nothing may be written when the page moved');
  assert.deepEqual(lines, [], 'and nothing may be recorded as written');
});

test('a replace sends If-Match from the read it just did', async () => {
  const s = server({ etag: 'W/"7"' });
  const { record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'replace',
        element_id: para,
        text: 'Fee: 1400',
        expect: 'Fee: 1200',
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
  const { lines, record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'replace',
        element_id: para,
        text: 'Fee: 1400',
        expect: 'Fee: 1200',
      },
      record,
    ),
  );

  // Pending before the write, done after, under one write id (0019 step 1).
  assert.deepEqual(lines.map((l) => l.status), ['pending', 'done']);
  assert.equal(lines[0].write_id, lines[1].write_id);
  assert.equal(lines[0].wrote, '<p>Fee: 1400</p>', 'the element as sent, which an undo finds it by');
  assert.equal(lines[0].operation, 'replace_onenote_element');
  // Both halves of the change, because the line is read back by someone who
  // cannot see the page as it was and can no longer see what replaced it.
  assert.equal(lines[0].summary, 'Replaced "Fee: 1200" with "Fee: 1400"');
  // The only surviving copy of the previous content once the PATCH returns 204.
  assert.equal(lines[0].pre_image, `<p id="${para}">Fee: 1200</p>`);
});

test('an append records no pre-image, because it destroyed nothing', async () => {
  const s = server();
  const { lines, record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'append',
        text: 'Curfew 23:00',
      },
      record,
    ),
  );

  assert.equal(lines[0].operation, 'append_onenote_page');
  assert.equal(lines[0].summary, 'Added to the end of the page: Curfew 23:00');
  assert.equal(lines[0].pre_image, null);
  assert.deepEqual(s.sent[0].body, [
    { target: 'body', action: 'append', content: '<p>Curfew 23:00</p>' },
  ]);
});

test('a replace or insert with no expect writes nothing', async () => {
  const s = server();
  const { lines, record } = audit();

  await withFetch(s.fetchImpl, async () => {
    for (const change of [
      { action: 'replace', element_id: para, text: 'x' },
      { action: 'insert', element_id: para, position: 'after', html: '<p>x</p>' },
    ]) {
      await assert.rejects(applyEdit('t', { page_id: 'p1', ...change }, record), /needs expect/);
      // A token from a client still following the old two-step flow is not a
      // substitute: it is ignored, and the expect is still required.
      await assert.rejects(
        applyEdit('t', { page_id: 'p1', ...change, confirmation_token: 'from-an-old-preview' }, record),
        /needs expect/,
      );
    }
  });

  assert.deepEqual(s.sent, []);
  assert.deepEqual(lines, []);
});

test('an append commits in one call: no token, no read, one PATCH', async () => {
  // 0015's first step. An append destroys nothing, so 0009's rule lets it
  // commit directly — and with nothing to capture, the page read is skipped
  // too, since it would spend a OneNote request protecting nothing.
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ method: init.method ?? 'GET', url: String(url), headers: init.headers, body: init.body });
    if ((init.method ?? 'GET') === 'GET') throw new Error('an append must not read the page');
    return new Response(null, { status: 204 });
  };

  const { lines, record } = audit();
  const result = await withFetch(fetchImpl, () =>
    applyEdit('t', { page_id: 'p1', action: 'append', text: 'Curfew 23:00' }, record),
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].headers['if-match'], undefined, 'nothing is overwritten, so nothing to guard');
  assert.deepEqual(JSON.parse(requests[0].body), [
    { target: 'body', action: 'append', content: '<p>Curfew 23:00</p>' },
  ]);

  // The result carries what a preview would have shown, and the way back.
  assert.match(result.note, /Curfew 23:00/);
  assert.match(result.note, /Nothing on the page was changed or removed/);
  assert.match(result.note, /To take this back, call undo_write with its write id/);

  assert.deepEqual(lines.map((l) => l.status), ['pending', 'done']);
  assert.equal(lines[0].write_id, lines[1].write_id);
  assert.equal(lines[0].operation, 'append_onenote_page');
  assert.equal(lines[0].pre_image, null);
  assert.equal(lines[0].wrote, '<p>Curfew 23:00</p>', 'what an undo will look for');
  assert.match(result.note, new RegExp(`Recorded as write ${lines[0].write_id}`));
});

test('an append ignores a token, so the old two-step flow still works', async () => {
  const s = server();
  const { record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      { page_id: 'p1', action: 'append', text: 'x', confirmation_token: 'from-an-old-preview' },
      record,
    ),
  );
  assert.equal(s.sent.length, 1);
});

test('a batch of appends commits together in one PATCH', async () => {
  const s = server();
  const { lines, record } = audit();
  const result = await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        changes: [
          { action: 'append', text: 'Neu, automatisch ergänzt' },
          { action: 'append', text: '[ ] Probenplan schicken' },
        ],
      },
      record,
    ),
  );

  assert.equal(s.sent.length, 1);
  assert.deepEqual(
    s.sent[0].body.map((c) => c.content),
    ['<p>Neu, automatisch ergänzt</p>', '<p>[ ] Probenplan schicken</p>'],
  );
  assert.equal(lines.filter((l) => l.status === 'done').length, 2);
  assert.equal(lines.filter((l) => l.status === 'pending').length, 2);
  assert.match(result.note, /in one write/);
});

test('a batch mixing an append with a replace still needs the replace\'s expect, and writes nothing without it', async () => {
  // The append must not ride through on its own: a batch is one thing, and the
  // replace in it is what expect exists for.
  const s = server();
  const { lines, record } = audit();

  await withFetch(s.fetchImpl, async () => {
    await assert.rejects(
      applyEdit(
        't',
        {
          page_id: 'p1',
          changes: [
            { action: 'append', text: 'Curfew 23:00' },
            { action: 'replace', element_id: para, text: 'Fee: 1400' },
          ],
        },
        record,
      ),
      /Change 2 \(replace\) needs expect/,
    );
  });

  assert.deepEqual(s.sent, []);
  assert.deepEqual(lines, []);
});

test('text going onto a page is escaped', async () => {
  const s = server();
  const { record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit(
      't',
      {
        page_id: 'p1',
        action: 'append',
        text: 'Fee & rider <b>',
      },
      record,
    ),
  );

  assert.equal(s.sent[0].body[0].content, '<p>Fee &amp; rider &lt;b&gt;</p>');
});

test('an append whose pending record fails sends nothing', async () => {
  const s = server();
  await withFetch(s.fetchImpl, () =>
    assert.rejects(
      applyEdit('t', { page_id: 'p1', action: 'append', text: 'x' }, async (entry) => {
        if (entry.status === 'pending') throw new Error('disk full');
      }),
      /disk full/,
    ),
  );
  assert.deepEqual(s.sent, []);
});

/**
 * 0019 step 1: a replace or insert is recorded before it writes. The pre-image
 * is the only copy of what a replace destroys, so a replace whose record cannot
 * be made must not happen at all — it used to land, with its pre-image nowhere.
 */
for (const change of [
  { action: 'replace', element_id: para, text: 'Fee: 1400' },
  { action: 'insert', element_id: para, position: 'after', html: '<p>Curfew 23:00</p>' },
]) {
  test(`${change.action === "insert" ? "an" : "a"} ${change.action} is recorded as pending before the PATCH, and done after`, async () => {
    const s = server();
      const order = [];
    const fetchImpl = async (url, init = {}) => {
      if ((init.method ?? 'GET') !== 'GET') order.push('PATCH');
      return s.fetchImpl(url, init);
    };
    const result = await withFetch(fetchImpl, () =>
      applyEdit('t', { page_id: 'p1', ...change, expect: 'Fee: 1200' }, async (entry) =>
        void order.push(entry.status),
      ),
    );
    assert.deepEqual(order, ['pending', 'PATCH', 'done']);
    assert.equal(result.write_ids.length, 1);
    assert.match(result.note, new RegExp(`Recorded as write ${result.write_ids[0]}`));
  });

  test(`${change.action === "insert" ? "an" : "a"} ${change.action} whose pending record fails sends nothing`, async () => {
    const s = server();
      await withFetch(s.fetchImpl, () =>
      assert.rejects(
        applyEdit('t', { page_id: 'p1', ...change, expect: 'Fee: 1200' }, async (entry) => {
          if (entry.status === 'pending') throw new Error('disk full');
        }),
        /disk full/,
      ),
    );
    assert.deepEqual(s.sent, []);
  });
}

test('an insert records what it wrote and no pre-image', async () => {
  const s = server();
  const change = { action: 'insert', element_id: para, position: 'after', html: '<p>Curfew 23:00</p>' };
  const { lines, record } = audit();
  await withFetch(s.fetchImpl, () =>
    applyEdit('t', { page_id: 'p1', ...change, expect: 'Fee: 1200' }, record),
  );
  assert.equal(lines[0].operation, 'insert_onenote_element');
  assert.equal(lines[0].pre_image, null);
  assert.equal(lines[0].wrote, '<p>Curfew 23:00</p>');
});
