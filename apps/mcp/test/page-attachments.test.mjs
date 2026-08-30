import assert from 'node:assert/strict';
import test from 'node:test';

import { mapAttachment } from '../dist/attachments.js';
import { minimalPdf, page } from './helpers/pdf.mjs';
import { oneNoteLoader, pageResources } from '../dist/page-attachments.js';

/**
 * The markup below is copied verbatim from a real OneNote page fetched through
 * Graph, not composed by hand. Everything awkward about it is real: the
 * self-closing <object> tags, the absolute URLs carrying the account address,
 * the duplicated id in data-fullres-src, and the image with no name.
 */
const FIXTURE = `<html lang="en-US">
	<head><title>ATTACHMENT FIXTURE</title></head>
	<body data-absolute-enabled="true">
		<div>
			<p>This is a test line￼this is a second test line</p>
			<img width="480" height="135" src="https://graph.microsoft.com/v1.0/users('someone@example.com')/onenote/resources/0-0be766674771d20a3c9707bc9a9bdf86!1-AE14106C4F7C7DCC!s1/$value" data-src-type="image/png" data-fullres-src="https://graph.microsoft.com/v1.0/users('someone@example.com')/onenote/resources/0-0be766674771d20a3c9707bc9a9bdf86!1-AE14106C4F7C7DCC!s1/$value" data-fullres-src-type="image/png" />
			<object data-attachment="TECH-RIDER-2023_the-bottomline_English.pdf" type="application/pdf" data="https://graph.microsoft.com/v1.0/users('someone@example.com')/onenote/resources/0-fefd6873d731460b10f0540f09016e9a!1-AE14106C4F7C7DCC!s1/$value" />
			<object data-attachment="SRS.docx" type="application/vnd.openxmlformats-officedocument.wordprocessingml.document" data="https://graph.microsoft.com/v1.0/users('someone@example.com')/onenote/resources/0-828f0582def8d2020ead5f66fa738548!1-AE14106C4F7C7DCC!s1/$value" />
			<object data-attachment="scara_kinematik.mw" type="application/octet-stream" data="https://graph.microsoft.com/v1.0/users('someone@example.com')/onenote/resources/0-8613202cc067e20312127f4ecee9e4ea!1-AE14106C4F7C7DCC!s1/$value" />
		</div>
	</body>
</html>`;

test('every resource on a real page is found, in document order', () => {
  const found = pageResources(FIXTURE);
  assert.equal(found.length, 4);
  assert.deepEqual(
    found.map((r) => r.filename),
    [
      'image 1 on the page',
      'TECH-RIDER-2023_the-bottomline_English.pdf',
      'SRS.docx',
      'scara_kinematik.mw',
    ],
  );
  assert.deepEqual(found.map((r) => r.position), [1, 2, 3, 4]);
});

test('an image is reported once, not twice for its full-resolution copy', () => {
  const images = pageResources(FIXTURE).filter((r) => r.kind === 'image');
  assert.equal(images.length, 1);
});

test('the type comes from the page, because the resource fetch says octet-stream for everything', () => {
  const [image, pdf, docx] = pageResources(FIXTURE);
  assert.equal(image.mime_type, 'image/png');
  assert.equal(pdf.mime_type, 'application/pdf');
  assert.equal(
    docx.mime_type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
});

test('the id is the bare resource id, so the account address never travels with it', () => {
  for (const resource of pageResources(FIXTURE)) {
    assert.doesNotMatch(resource.id, /@|graph\.microsoft\.com|\$value/);
  }
  assert.equal(
    pageResources(FIXTURE)[1].id,
    '0-fefd6873d731460b10f0540f09016e9a!1-AE14106C4F7C7DCC!s1',
  );
});

test('nothing invents a size, because Graph offers none before the fetch', () => {
  for (const resource of pageResources(FIXTURE)) {
    assert.equal(resource.size, null);
  }
});

test('a file nothing can read is still reported, not dropped', () => {
  const found = pageResources(FIXTURE);
  const mw = found.find((r) => r.filename === 'scara_kinematik.mw');
  assert.ok(mw, 'the unreadable attachment must survive parsing');
  assert.equal(mw.mime_type, 'application/octet-stream');
});

test('a page with no attachments yields none', () => {
  assert.deepEqual(pageResources('<html><body><p>Just prose.</p></body></html>'), []);
});

test('an image that is not a page resource is not a page attachment', () => {
  const html = '<html><body><img src="https://example.com/logo.png" /></body></html>';
  assert.deepEqual(pageResources(html), []);
});

/** Serves canned Graph responses by URL substring. */
const stubGraph = (routes) => {
  globalThis.fetch = async (url) => {
    const path = String(url);
    const match = Object.keys(routes).find((key) => path.includes(key));
    if (match === undefined) return new Response('{}', { status: 404 });
    const value = routes[match];
    return typeof value === 'string' || value instanceof Uint8Array
      ? new Response(value, { status: 200 })
      : new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
  };
};

const PDF_ID = '0-fefd6873d731460b10f0540f09016e9a!1-AE14106C4F7C7DCC!s1';

test('a resource is loaded with the type the page gave it, not the one the fetch did', async () => {
  // Graph answers octet-stream for every resource; the loader must ignore that.
  stubGraph({ '/content': FIXTURE, '/resources/': new Uint8Array([1, 2, 3, 4]) });
  const loaded = await oneNoteLoader('token', 'p1', PDF_ID)();
  assert.equal(loaded.oversized, false);
  assert.equal(loaded.meta.mime_type, 'application/pdf');
  assert.equal(loaded.meta.filename, 'TECH-RIDER-2023_the-bottomline_English.pdf');
  assert.equal(loaded.bytes.byteLength, 4);
});

test('a size is reported only once the bytes have actually been counted', async () => {
  stubGraph({ '/content': FIXTURE, '/resources/': new Uint8Array(2048) });
  const loaded = await oneNoteLoader('token', 'p1', PDF_ID)();
  assert.equal(loaded.meta.size, 2048);
});

test('an oversized resource is refused, and the download is stopped, not drained', async () => {
  // Twenty 1 MB chunks against a 10 MB cap. What is asserted is that the
  // loader cancels the body: it stops the transfer rather than reading to the
  // end and discarding. The chunk count pulled is deliberately not asserted --
  // that measures the runtime's buffering of a hand-built Response, not this.
  let cancelled = false;
  let enqueued = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/content')) return new Response(FIXTURE, { status: 200 });
    return new Response(
      new ReadableStream({
        pull(controller) {
          enqueued += 1;
          if (enqueued > 20) return controller.close();
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    );
  };
  const loaded = await oneNoteLoader('token', 'p1', PDF_ID)();
  assert.equal(loaded.oversized, true);
  assert.ok(cancelled, 'the body must be cancelled once the cap is passed');
  // No bytes come back at all, so nothing oversized reaches the reading path.
  assert.equal(loaded.bytes, undefined);
  // Never guessed: the read stopped early, so the true size is unknown.
  assert.equal(loaded.meta.size, null);
});

test('asking for a resource the page does not have names the ones it does', async () => {
  stubGraph({ '/content': FIXTURE });
  await assert.rejects(
    oneNoteLoader('token', 'p1', '0-nosuchresource!1-AE14106C4F7C7DCC!s1')(),
    (err) => /SRS\.docx/.test(err.message) && /has no attachment/.test(err.message),
  );
});

test('a malformed id is refused before anything is fetched', () => {
  globalThis.fetch = async () => assert.fail('nothing should be fetched');
  assert.throws(() => oneNoteLoader('token', 'p1', 'not a valid id'), /attachment_id/);
  assert.throws(() => oneNoteLoader('token', '', PDF_ID), /note_id/);
});

test('a page map points at the page read tool, not the mail one', async () => {
  // The map text is shared between sources. Naming the Gmail tool while
  // mapping a page attachment sends the model to a tool that cannot open it.
  stubGraph({ '/content': FIXTURE, '/resources/': minimalPdf([page('Fee: EUR 2400 net')]) });
  const map = await mapAttachment(
    oneNoteLoader('token', 'p1', PDF_ID),
    'read_page_attachment',
  );
  assert.match(map.note, /read_page_attachment/);
  assert.doesNotMatch(map.note, /read_gmail_attachment/);
});
