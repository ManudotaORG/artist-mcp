import assert from 'node:assert/strict';
import test from 'node:test';

import { pageResources } from '../dist/page-attachments.js';

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
