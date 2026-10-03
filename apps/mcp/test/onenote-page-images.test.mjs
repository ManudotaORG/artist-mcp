import assert from 'node:assert/strict';
import test from 'node:test';

import { extractPdfContent, extractPdfImage, loadPageImage } from '../dist/attachments.js';
import { createPage, imagesFrom, pageXhtml } from '../dist/onenote-write.js';
import { createServer } from '../dist/server.js';
import { minimalPdf, page } from './helpers/pdf.mjs';

/**
 * Pictures on a new page. See docs/decisions/0012-images-on-a-new-page.md.
 *
 * Every test here stubs Gmail and Graph. What they cannot show is whether
 * OneNote accepts the multipart POST and displays the picture; that needs a
 * live run, and 0012 says so.
 */

// Above the 200,000-pixel floor that separates a diagram from letterhead.
const PLOT = { width: 500, height: 450 };

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47];

const pngSize = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const loaderFor = (meta, bytes) => async () =>
  meta.size !== null && meta.size > 10 * 1024 * 1024
    ? { oversized: true, meta }
    : { oversized: false, meta, bytes };

const pdfMeta = { id: '2', filename: 'rider.pdf', mime_type: 'application/pdf', size: 1000 };

const draft = {
  section_id: '0-AE14106C4F7C7DCC!sedce32b208ec46618fd34301f03b8cba',
  title: 'Stage plot — Reiter wedding',
  body: 'From the rider.',
  source_page: null,
};

const picture = (over = {}) => ({
  media_type: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
  width: 1200,
  height: 900,
  source: 'rider.pdf, page 2',
  caption: null,
  ...over,
});

// ------------------------------------------------------------ the PDF side

test('the read numbers each picture on its page, so it can be named back', async () => {
  const result = await extractPdfContent(minimalPdf([page('Intro'), { text: null, image: PLOT }]));
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].page, 2);
  assert.equal(result.images[0].index, 1);
});

test('a PDF picture comes out as a PNG at its own size', async () => {
  const out = await extractPdfImage(minimalPdf([{ text: null, image: PLOT }]), 1, 1, null);
  assert.deepEqual([...out.png.subarray(0, 4)], PNG_HEADER);
  assert.deepEqual({ width: out.width, height: out.height }, PLOT);
  assert.deepEqual(pngSize(out.png), PLOT);
});

test('a crop keeps the fraction of the picture it names', async () => {
  const out = await extractPdfImage(
    minimalPdf([{ text: null, image: PLOT }]),
    1,
    1,
    { left: 0.5, top: 0, right: 1, bottom: 0.5 },
  );
  assert.deepEqual({ width: out.width, height: out.height }, { width: 250, height: 225 });
  assert.deepEqual(pngSize(out.png), { width: 250, height: 225 });
});

test('a crop too small to be a picture is refused', async () => {
  await assert.rejects(
    extractPdfImage(minimalPdf([{ text: null, image: PLOT }]), 1, 1, {
      left: 0,
      top: 0,
      right: 0.01,
      bottom: 0.5,
    }),
    /too small/,
  );
});

test('asking for a picture that is not there says what is', async () => {
  const pdf = minimalPdf([page('Prose only'), { text: null, image: PLOT }]);
  await assert.rejects(extractPdfImage(pdf, 2, 2, null), /has 1 picture, so there is no image 2/);
  await assert.rejects(extractPdfImage(pdf, 1, 1, null), /no picture to take/);
  await assert.rejects(extractPdfImage(pdf, 5, 1, null), /has 2 pages/);
});

// ------------------------------------------------------- choosing a source

test('an image file goes onto the page as it arrived', async () => {
  const bytes = new Uint8Array(32);
  bytes.set(PNG_HEADER);
  const image = await loadPageImage(
    loaderFor({ id: '3', filename: 'plot.png', mime_type: 'image/png', size: 32 }, bytes),
    {},
  );
  assert.equal(image.bytes, bytes, 'an image file must not be re-encoded');
  assert.equal(image.media_type, 'image/png');
  assert.equal(image.source, 'plot.png');
});

test('an image file cannot be cropped, because it is never decoded here', async () => {
  await assert.rejects(
    loadPageImage(
      loaderFor({ id: '3', filename: 'plot.jpg', mime_type: 'image/jpeg', size: 32 }, new Uint8Array(32)),
      { crop: { left: 0, top: 0, right: 0.5, bottom: 0.5 } },
    ),
    /never decoded/,
  );
});

test('only formats OneNote renders are accepted', async () => {
  await assert.rejects(
    loadPageImage(
      loaderFor({ id: '3', filename: 'plot.webp', mime_type: 'image/webp', size: 32 }, new Uint8Array(32)),
      {},
    ),
    /JPEG, PNG and GIF/,
  );
});

test('a picture inside a Word document is refused, since none can be chosen', async () => {
  await assert.rejects(
    loadPageImage(
      loaderFor(
        {
          id: '4',
          filename: 'rider.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 32,
        },
        new Uint8Array(32),
      ),
      {},
    ),
    /Word document/,
  );
});

test('a PDF needs the page named, and its source says which page', async () => {
  const pdf = minimalPdf([page('Intro'), { text: null, image: PLOT }]);
  await assert.rejects(loadPageImage(loaderFor(pdfMeta, pdf), {}), /name the page/);
  const image = await loadPageImage(loaderFor(pdfMeta, pdf), { page: 2 });
  assert.equal(image.media_type, 'image/png');
  assert.equal(image.source, 'rider.pdf, page 2');
});

test('a malformed crop is refused before anything is fetched', async () => {
  let fetched = false;
  const load = async () => {
    fetched = true;
    throw new Error('should not be reached');
  };
  await assert.rejects(
    loadPageImage(load, { page: 1, crop: { left: 0.6, top: 0, right: 0.4, bottom: 1 } }),
    /right greater than left/,
  );
  await assert.rejects(loadPageImage(load, { page: 1, crop: { left: -1, top: 0, right: 1, bottom: 1 } }), /fraction/);
  assert.equal(fetched, false);
});

test('an oversized attachment is refused, not fetched', async () => {
  await assert.rejects(
    loadPageImage(loaderFor({ ...pdfMeta, size: 20 * 1024 * 1024 }, null), { page: 1 }),
    /limit/,
  );
});

// ---------------------------------------------------------------- the page

test('a picture is cited by part name, with its caption and source escaped', () => {
  const html = pageXhtml(draft, [picture({ caption: 'Plot <v2> & monitors' })]);
  assert.match(html, /<p>Plot &lt;v2&gt; &amp; monitors<\/p><img src="name:image1"/);
  assert.match(html, /alt="Plot &lt;v2&gt; &amp; monitors"/);
  assert.match(html, /From rider\.pdf, page 2<\/p>/);
  // After the body, never inside it.
  assert.ok(html.indexOf('From the rider.') < html.indexOf('<img'));
});

test('a wide picture is shown at a readable width and stored at its own', () => {
  assert.match(pageXhtml(draft, [picture({ width: 1200 })]), /width="800"/);
  assert.doesNotMatch(pageXhtml(draft, [picture({ width: 600 })]), /width=/);
});

test('the handler-supplied images are shape-checked on the write path', () => {
  assert.deepEqual(imagesFrom(undefined), []);
  assert.throws(() => imagesFrom([picture(), picture(), picture(), picture()]), /at most 3/);
  assert.throws(() => imagesFrom([picture({ bytes: 'AAAA' })]), /not a picture/);
  assert.throws(() => imagesFrom([picture({ media_type: 'image/svg+xml' })]), /not a picture/);
  assert.throws(() => imagesFrom([picture({ caption: 'x'.repeat(301) })]), /caption/);
});

test('a page with pictures is one multipart POST naming each part', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if ((init.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ id: draft.section_id, displayName: 'Gigs' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: 'page-1', title: draft.title }), { status: 201 });
  };
  const audit = [];
  try {
    const result = await createPage(
      'token',
      { ...draft, image_parts: [picture()] },
      async (entry) => audit.push(entry),
    );
    assert.equal(result.created, true);
    assert.match(result.written, /\[Image: rider\.pdf, page 2, 1200x900\]/);
  } finally {
    globalThis.fetch = original;
  }

  const posts = requests.filter((r) => r.init.method === 'POST');
  assert.equal(posts.length, 1);
  const { body, headers } = posts[0].init;
  assert.ok(body instanceof FormData, 'with pictures the page must go as multipart');
  // fetch writes the boundary; a content-type set by hand would lose it.
  assert.equal(headers['content-type'], undefined);
  assert.match(await body.get('Presentation').text(), /<img src="name:image1"/);
  assert.equal(body.get('image1').type, 'image/png');
  assert.match(audit[0].summary, /with images from rider\.pdf, page 2/);
});

test('a page without pictures is still the plain XHTML POST', async () => {
  const original = globalThis.fetch;
  let post;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      post = init;
      return new Response(JSON.stringify({ id: 'page-1' }), { status: 201 });
    }
    return new Response(JSON.stringify({ id: draft.section_id, displayName: 'Gigs' }), { status: 200 });
  };
  try {
    await createPage('token', draft, async () => {});
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(typeof post.body, 'string');
  assert.equal(post.headers['content-type'], 'application/xhtml+xml');
});

// -------------------------------------------------------------- the handler

/**
 * The tool spans two providers without any one operation doing so: each
 * picture is fetched on the Google token, then the page is created on the
 * Microsoft one. A picture that cannot be had means no page.
 */
test('every picture is fetched on its own operation before the page is created', async () => {
  const calls = [];
  const dispatch = async (op, params) => {
    calls.push({ op, params });
    if (op === 'load_gmail_image') {
      return { media_type: 'image/png', bytes: new Uint8Array([1]), width: 10, height: 10, source: 'plot.png' };
    }
    return { title: 'T', page_id: 'p', web_url: null, section_name: 'Gigs', written: '' };
  };
  const server = await createServer(dispatch, ['onenote-create']);
  await server._registeredTools.create_onenote_page.handler({
    title: 'T',
    body: 'B',
    images: [
      { email_id: 'm1', attachment_id: '2', page: 3, caption: 'Plot' },
      { email_id: 'm1', attachment_id: '3' },
    ],
  });

  assert.deepEqual(
    calls.map((c) => c.op),
    ['load_gmail_image', 'load_gmail_image', 'create_onenote_page'],
  );
  assert.deepEqual(calls[0].params, { email_id: 'm1', attachment_id: '2', page: 3 });
  const create = calls[2].params;
  assert.equal(create.images, undefined, 'the model’s references must not reach the write');
  assert.equal(create.image_parts.length, 2);
  assert.equal(create.image_parts[0].caption, 'Plot');
  assert.equal(create.image_parts[1].caption, null);
});

test('a picture that cannot be fetched means no page at all', async () => {
  const calls = [];
  const dispatch = async (op) => {
    calls.push(op);
    if (op === 'load_gmail_image') throw new Error('That message has no attachment 9.');
    return {};
  };
  const server = await createServer(dispatch, ['onenote-create']);
  const result = await server._registeredTools.create_onenote_page.handler({
    title: 'T',
    body: 'B',
    images: [{ email_id: 'm1', attachment_id: '9' }],
  });
  assert.ok(result.isError);
  assert.ok(!calls.includes('create_onenote_page'));
});

test('the schema accepts pictures and keeps them optional', async () => {
  const server = await createServer(async () => ({}), ['onenote-create']);
  const schema = server._registeredTools.create_onenote_page.inputSchema;
  assert.ok(schema.safeParse({ title: 'T', body: 'B' }).success);
  assert.ok(
    schema.safeParse({
      title: 'T',
      body: 'B',
      images: [{ email_id: 'm', attachment_id: '2', page: 1, crop: { left: 0, top: 0, right: 1, bottom: 1 } }],
    }).success,
  );
  assert.ok(!schema.safeParse({ title: 'T', body: 'B', images: Array(4).fill({ email_id: 'm', attachment_id: '2' }) }).success);
});
