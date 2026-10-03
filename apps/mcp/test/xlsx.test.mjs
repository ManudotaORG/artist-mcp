import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32 } from 'node:zlib';

import { extractXlsxContent, mapAttachment, readAttachment, unsupportedNote } from '../dist/attachments.js';

/**
 * Reading Excel workbooks. An .xlsx is a ZIP of XML, read with the same
 * central-directory walk as a .docx; no dependency parses it.
 */

/** A stored (uncompressed) ZIP, enough to be a real .xlsx to the reader. */
const zip = (files) => {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = enc.encode(content);
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
};

const workbook = ({ sheets, shared = [], styles, extra = {} }) =>
  zip({
    'xl/workbook.xml':
      `<workbook xmlns:r="r"><sheets>` +
      sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="hidden"' : ''}/>`).join('') +
      `</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<Relationships>` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `</Relationships>`,
    'xl/sharedStrings.xml': `<sst>${shared.map((t) => `<si>${t}</si>`).join('')}</sst>`,
    ...(styles ? { 'xl/styles.xml': styles } : {}),
    ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${s.xml}</sheetData></worksheet>`])),
    ...extra,
  });

// Style 1 is a built-in date (14), style 2 a custom "dd.mm.yyyy hh:mm".
const STYLES =
  '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/></numFmts>' +
  '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>';

const SCHEDULE = workbook({
  shared: ['<t>Date</t>', '<t>What</t>', '<r><t>Probe </t></r><r><t>Saal 2</t></r>', '<t>Fee &amp; travel</t>'],
  styles: STYLES,
  sheets: [
    {
      name: 'Schedule',
      xml:
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>46340</v></c><c r="B2" t="s"><v>2</v></c></row>' +
        '<row r="3"><c r="A3" s="2"><v>46340.8125</v></c><c r="C3" t="inlineStr"><is><t>Konzert</t></is></c></row>' +
        '<row r="4"></row>' +
        '<row r="5"><c r="A5" t="s"><v>3</v></c><c r="B5"><v>2400</v></c><c r="C5" t="b"><v>1</v></c></row>',
    },
    { name: 'Notes', hidden: true, xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>internal</t></is></c></row>' },
  ],
});

test('a workbook is read sheet by sheet, row by row', async () => {
  const book = await extractXlsxContent(SCHEDULE);
  assert.match(book.text, /^## Sheet: Schedule\nDate \| What\n/);
  // Rich text is several runs; they are joined, not reduced to the first.
  assert.match(book.text, /\| Probe Saal 2\n/);
  // A skipped column keeps its place, so C3 does not slide into B.
  assert.match(book.text, /19:30 \|  \| Konzert\n/);
  assert.match(book.text, /Fee & travel \| 2400 \| TRUE/);
  // An empty row is not a line.
  assert.doesNotMatch(book.text, /\n\n## Sheet: Schedule/);
});

test('a date is read as a date, not as Excel’s serial number', async () => {
  const { text } = await extractXlsxContent(SCHEDULE);
  assert.match(text, /\n2026-11-14 \| Probe/);
  assert.match(text, /\n2026-11-14 19:30 \|/);
  assert.doesNotMatch(text, /46340/);
  // A plain number stays a number.
  assert.match(text, /\| 2400 \|/);
});

test('a hidden sheet is read and marked as hidden', async () => {
  const book = await extractXlsxContent(SCHEDULE);
  assert.match(book.text, /## Sheet: Notes \(hidden\)\ninternal/);
  assert.deepEqual(book.sheets, [
    { name: 'Schedule', hidden: false, rows: 4 },
    { name: 'Notes', hidden: true, rows: 1 },
  ]);
});

test('a long workbook comes in parts, and says how to continue', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) =>
    `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Row ${i + 1} ${'x'.repeat(20)}</t></is></c></row>`,
  ).join('');
  const big = workbook({ sheets: [{ name: 'Big', xml: rows }] });
  const first = await extractXlsxContent(big);
  assert.equal(first.parts_total, 2);
  assert.equal(first.next_from_page, 2);
  const second = await extractXlsxContent(big, 2);
  assert.equal(second.next_from_page, null);
  assert.match(second.text, /Row 2500/);
});

const loader = (bytes, filename = 'schedule.xlsx') => async () => ({
  oversized: false,
  meta: { id: '2', filename, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: bytes.length },
  bytes,
});

test('the read tool reads a workbook and says what it leaves out', async () => {
  const result = await readAttachment(loader(SCHEDULE));
  assert.equal(result.kind, 'text');
  assert.equal(result.unit, 'part');
  assert.match(result.text, /Probe Saal 2/);
  assert.match(result.note, /charts and pictures are not read/);
});

test('the map lists the sheets and their rows', async () => {
  const map = await mapAttachment(loader(SCHEDULE), 'read_gmail_attachment');
  assert.match(map.note, /"Schedule", 4 rows; "Notes" \(hidden\), 1 row/);
});

test('a file that is not a workbook is unreadable, not a crash', async () => {
  const result = await readAttachment(loader(new Uint8Array([1, 2, 3, 4])));
  assert.equal(result.kind, 'unreadable');
});

test('a legacy .xls is named as such, with what to ask for', () => {
  assert.match(unsupportedNote('application/vnd.ms-excel', 'fees.xls'), /legacy Excel workbook.*\.xlsx/);
});
