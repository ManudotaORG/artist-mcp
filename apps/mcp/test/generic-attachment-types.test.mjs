import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPageImage, mapAttachment, readAttachment, realType, sniffType } from '../dist/attachments.js';
import { renderAttachment } from '../dist/server.js';
import { minimalPdf, page } from './helpers/pdf.mjs';

/**
 * Outlook for Android, among others, labels every attachment
 * application/octet-stream. A reader trusting the label turned away real PDFs;
 * the file's own bytes decide now when the label says nothing.
 */

const PDF = minimalPdf([page('Tagesplan Montag, 14. September 2026: Probe 10:00 Saal 2')]);
const meta = (over = {}) => ({ id: '2', filename: 'Plan.pdf', mime_type: 'application/octet-stream', size: PDF.length, ...over });
const loader = (m, bytes = PDF) => async () => ({ oversized: false, meta: m, bytes });

test('the first bytes say what a file is', () => {
  assert.equal(sniffType(PDF), 'application/pdf');
  assert.equal(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0])), 'image/png');
  assert.equal(sniffType(new TextEncoder().encode('PK\x03\x04 ... xl/workbook.xml ...')), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(sniffType(new TextEncoder().encode('PK\x03\x04 ... word/document.xml ...')), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(sniffType(new TextEncoder().encode('just some text')), null);
});

test('a generic label is replaced, and the sender’s label is kept', () => {
  const fixed = realType(meta(), PDF);
  assert.equal(fixed.mime_type, 'application/pdf');
  assert.equal(fixed.sent_as, 'application/octet-stream');
});

test('the bytes win over a misleading extension', () => {
  assert.equal(realType(meta({ filename: 'scan.jpg' }), PDF).mime_type, 'application/pdf');
});

test('the extension is the fallback when the bytes say nothing', () => {
  assert.equal(realType(meta({ filename: 'rider.docx' }), new Uint8Array(16)).mime_type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  // An oversized file has no bytes to look at, only a name.
  assert.equal(realType(meta(), null).mime_type, 'application/pdf');
});

test('a specific label is trusted as given', () => {
  const m = meta({ mime_type: 'text/calendar', filename: 'invite.pdf' });
  assert.equal(realType(m, PDF), m);
});

test('a file nothing can identify keeps its generic label', () => {
  const m = meta({ filename: 'data.bin' });
  assert.equal(realType(m, new Uint8Array(16)).mime_type, 'application/octet-stream');
});

test('an octet-stream PDF is read, and the answer says how', async () => {
  const result = await readAttachment(loader(meta()));
  assert.equal(result.kind, 'text');
  assert.match(result.text, /Probe 10:00 Saal 2/);
  const text = renderAttachment(result).content[0].text;
  assert.match(text, /Type: application\/pdf \(sent as application\/octet-stream, read by its contents\)/);
});

test('mapping goes by the contents too', async () => {
  const map = await mapAttachment(loader(meta()), 'read_gmail_attachment');
  assert.equal(map.kind, 'text');
  assert.equal(map.pages_total, 1);
});

test('a picture for a page can come from an octet-stream PDF', async () => {
  const pdf = minimalPdf([{ text: null, image: { width: 500, height: 450 } }]);
  const image = await loadPageImage(loader(meta({ size: pdf.length }), pdf), { page: 1 });
  assert.equal(image.media_type, 'image/png');
});
