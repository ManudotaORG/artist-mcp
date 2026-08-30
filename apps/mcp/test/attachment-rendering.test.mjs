import assert from 'node:assert/strict';
import test from 'node:test';

import { renderAttachment, renderAttachmentMap } from '../dist/server.js';

/**
 * What a model is finally shown.
 *
 * The extractors are well covered and the tool descriptions are pinned, but
 * the layer between them -- the gap note placed above the text, the fence that
 * marks quoted material as evidence, the per-page image announcements -- was
 * covered by nothing at all. It moved out of the two tool handlers into shared
 * functions during #70, and a mechanical move is exactly the kind that passes a
 * typecheck while losing a line.
 */

const base = {
  filename: 'rider.pdf',
  mime_type: 'application/pdf',
  size: 601599,
  kind: 'text',
  text: 'Fee: EUR 2400 net',
  note: null,
};

const textOf = (result) =>
  result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

test('a read file leads with its name, type and size', () => {
  const text = textOf(renderAttachment(base));
  assert.match(text, /^# rider\.pdf/);
  assert.match(text, /Type: application\/pdf/);
  assert.match(text, /Size: 587 KB/);
});

test('extracted text is fenced and attributed, so it reads as evidence', () => {
  const text = textOf(renderAttachment(base));
  assert.match(text, /Quoted from rider\.pdf:/);
  assert.match(text, /```text\n[\s\S]*Fee: EUR 2400 net[\s\S]*\n```/);
});

test('a fence inside the document cannot break out of the quoting', () => {
  // A file that contains ``` would otherwise close the block early and the
  // rest would read as the model's own words rather than the document's.
  const text = textOf(renderAttachment({ ...base, text: 'before ``` after' }));
  assert.doesNotMatch(text.split('```text')[1].split('\n```')[0], /```/);
  assert.match(text, /'''/);
});

test('the gap note sits above the text, not below it', () => {
  const text = textOf(
    renderAttachment({ ...base, note: 'Page 3 is a picture and was not read.' }),
  );
  // A caveat under a wall of extracted prose is a caveat nobody reads.
  assert.ok(
    text.indexOf('Page 3 is a picture') < text.indexOf('## Extracted text'),
    'the note must precede the extracted text',
  );
  assert.match(text, /\*\*Page 3 is a picture and was not read\.\*\*/);
});

test('a partly read PDF says which pages it covered and how to continue', () => {
  const text = textOf(
    renderAttachment({
      ...base,
      unit: 'page',
      first_page: 10,
      pages_read: 18,
      pages_total: 40,
      next_from_page: 19,
    }),
  );
  // "only the first N" was wrong the moment reading could start partway.
  assert.match(text, /Pages: 10-18 of 40/);
  assert.match(text, /continue from page 19/);
});

test('a Word document is measured in parts, never in pages', () => {
  const text = textOf(
    renderAttachment({
      ...base,
      filename: 'contract.docx',
      unit: 'part',
      chars_total: 14682,
      parts_total: 2,
      first_page: 1,
    }),
  );
  assert.match(text, /Length: 14,682 characters, part 1 of 2/);
  assert.doesNotMatch(text, /Pages:/);
});

test('a diagram is announced by page and returned as an image', () => {
  const result = renderAttachment({
    ...base,
    images: [{ page: 3, width: 800, height: 600, media_type: 'image/png', data: 'AAAA' }],
  });
  const picture = result.content.find((c) => c.type === 'image');
  assert.ok(picture, 'the image must reach the model as an image');
  assert.equal(picture.mimeType, 'image/png');
  assert.equal(picture.data, 'AAAA');
  assert.match(textOf(result), /### Page 3, as an image \(800x600\)/);
});

test('an image attachment is not called page 1, because it has no pages', () => {
  const result = renderAttachment({
    ...base,
    filename: 'stage-plan.png',
    mime_type: 'image/png',
    kind: 'image',
    text: '',
    images: [{ width: 1800, height: 506, media_type: 'image/png', data: 'AAAA' }],
  });
  const text = textOf(result);
  assert.match(text, /### stage-plan\.png \(1800x506\)/);
  assert.doesNotMatch(text, /Page 1/);
  // Nothing was extracted, so there is no fenced block claiming otherwise.
  assert.doesNotMatch(text, /## Extracted text/);
});

test('a refused file says so and quotes nothing', () => {
  const text = textOf(
    renderAttachment({
      filename: 'huge.pdf',
      mime_type: 'application/pdf',
      size: 0,
      kind: 'too_large',
      text: '',
      note: 'This file is at least the 10 MB limit for reading in chat.',
    }),
  );
  assert.match(text, /\*\*This file is at least the 10 MB limit/);
  assert.doesNotMatch(text, /## Extracted text/);
});

test('a map is a table, so pages can be compared and one picked', () => {
  const text = textOf(
    renderAttachmentMap({
      filename: 'rider.pdf',
      mime_type: 'application/pdf',
      size: 601599,
      kind: 'text',
      pages: [
        { page: 1, chars: 2048, heading: 'TECHNICAL RIDER', image_only: false },
        { page: 2, chars: 0, heading: null, image_only: true },
      ],
      note: '7 pages. Use read_page_attachment with from_page and page_count.',
    }),
  );
  assert.match(text, /\| Page \| Characters \| What is on it \|/);
  assert.match(text, /\| 1 \| 2048 \| TECHNICAL RIDER \|/);
  // A picture reports as one rather than as zero characters of text.
  assert.match(text, /\| 2 \| — \| a picture, not text \|/);
  assert.match(text, /\*\*7 pages\. Use read_page_attachment/);
});

test('a map with no pages is note only, not an empty table', () => {
  const text = textOf(
    renderAttachmentMap({
      filename: 'notes.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1024,
      kind: 'text',
      pages: [],
      note: 'There is no page map to give: a .docx records no pages.',
    }),
  );
  assert.doesNotMatch(text, /\| Page \|/);
  assert.match(text, /no page map to give/);
});
