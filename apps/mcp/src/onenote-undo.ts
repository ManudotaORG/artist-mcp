/**
 * Reversing one write this tool made to a OneNote page (0018 step 3). Split out
 * of `onenote-patch.ts` (0019 step 0); it reads with the editing core and the
 * task-row module beside it, and changes nothing either of them guarantees.
 */

import { randomUUID } from 'node:crypto';
import { onenotePageContent, onenotePatchPage } from './api.js';
import { type RecordWrite, type WriteRecord, type WrittenRecord } from './audit.js';
import {
  asText,
  cellsOf,
  childElements,
  extractElement,
  failure,
  replaceCommand,
  rootTag,
} from './onenote-patch.js';
import { asWritten, pageTables, rowFacts, uncarried } from './onenote-rows.js';

// ---------------------------------------------------------------------------
// undo_write: one write this tool made to a OneNote page, reversed at the
// smallest unit — a row, or a line — and only while what it wrote still reads
// exactly as written. 0018 step 3.

/** Reads this install's own write log: the file locally, the user's rows hosted. */
export type ReadWriteLog = (query: { writeId?: string; since?: string; limit?: number }) => Promise<WrittenRecord[]>;

const WRITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isTicked = (row: string): boolean => /data-tag="to-do:completed"/.test(row);
const sameCells = (a: string[], b: string[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A row put back into what OneNote accepts, on its own. */
const rowAsWritten = (row: string): string =>
  asWritten(`<table>${row}</table>`).replace(/^<table border="1">|<\/table>$/g, '');

/** The page's tables headed exactly as `header`, each with its rows. */
const tablesHeaded = (html: string, header: string[]) =>
  pageTables(html)
    .map((table, ordinal) => ({ table, ordinal, rows: childElements(table, 'tr') }))
    .filter(({ rows }) => rows.length > 0 && sameCells(cellsOf(rows[0]), header));

/** Replace the row at `index` of a translated table, found by walking the rows in order. */
const swapRow = (translated: string, index: number, replacement: string): string => {
  const rows = childElements(translated, 'tr');
  let at = -1;
  for (let i = 0, from = 0; i <= index; i++) {
    at = translated.indexOf(rows[i], from);
    from = at + rows[i].length;
  }
  return translated.slice(0, at) + replacement + translated.slice(at + rows[index].length);
};

type Found = { table: string; ordinal: number; rows: string[]; index: number };

/**
 * The one row that still reads as `cells`, ticked or not as `done` says. None
 * and several are both refusals: none means it was edited, removed, or never
 * landed, and several means the tool cannot tell which one it wrote.
 */
const findRow = (html: string, header: string[], cells: string[], done: boolean, what: string): Found => {
  const found: Found[] = [];
  for (const { table, ordinal, rows } of tablesHeaded(html, header)) {
    rows.forEach((row, index) => {
      if (index > 0 && sameCells(cellsOf(row), cells) && isTicked(row) === done) found.push({ table, ordinal, rows, index });
    });
  }
  if (found.length === 1) return found[0];
  throw failure(
    found.length === 0
      ? `${what} no longer reads as this tool left it — it was edited, ticked, removed, or the ` +
          `write never landed — so nothing was undone. It read: ${cells.join(' · ')}`
      : `${what} appears ${found.length} times, so which one this tool wrote is not clear. Nothing was undone.`,
  );
};

/** Write a table back, checked afterwards: the rows `expect` lists, in order, by text and tags. */
const writeTableChecked = async (
  token: string,
  pageId: string,
  found: Found,
  content: string,
  etag: string | null,
  expect: { cells: string[]; tags: string }[],
) => {
  const tableId = found.table.match(/<table\b[^>]*?\sid="([^"]+)"/)?.[1];
  if (tableId === undefined) throw failure('The table has no id to write to. Nothing was undone.');
  await onenotePatchPage(pageId, [replaceCommand(tableId, content)], token, etag);
  try {
    const after = await onenotePageContent(pageId, token);
    const written = pageTables(after.html)[found.ordinal];
    const rows = written === undefined ? [] : childElements(written, 'tr');
    if (rows.length !== expect.length) return false;
    return rows.every((row, i) => sameCells(cellsOf(row), expect[i].cells) && rowFacts(row).tags === expect[i].tags);
  } catch {
    return false;
  }
};

/**
 * Reverse one write this tool made, by its write_id. A row it added is
 * removed, a row it changed is put back, a line it appended is removed — each
 * only while it still reads exactly as written, which is what keeps an edit
 * Ruben made in between from being destroyed by an undo.
 */
export async function undoWrite(
  token: string,
  params: Record<string, unknown>,
  record: RecordWrite,
  readLog: ReadWriteLog,
) {
  const writeId = params.write_id;
  if (typeof writeId !== 'string' || !WRITE_ID.test(writeId)) {
    throw failure('write_id is required: the id a write result named, as "Recorded as write …".');
  }

  const lines = await readLog({ writeId });
  if (lines.length === 0) {
    throw failure(
      `There is no write ${writeId} in this install's write log. Only writes recorded since ` +
        'two-phase recording began can be undone; older ones are removed by hand.',
    );
  }
  const original = lines.find((line) => line.status === 'pending') ?? lines[lines.length - 1];
  if (original.operation.startsWith('undo_')) {
    throw failure('That write is itself an undo, and undoing an undo is not offered. Nothing was changed.');
  }
  const undoneBy = (await readLog({ since: original.at, limit: 500 })).find((line) => {
    if (!line.operation.startsWith('undo_') || line.status !== 'done' || !line.wrote) return false;
    try {
      return (JSON.parse(line.wrote) as { undoes?: string }).undoes === writeId;
    } catch {
      return false;
    }
  });
  if (undoneBy !== undefined) {
    throw failure(`Write ${writeId} was already undone, by write ${undoneBy.write_id}. Nothing was changed.`);
  }

  // Decided before anything is read or parsed, so a write this cannot reverse
  // — a calendar change, a created page, an element replaced — is named as
  // such rather than failing on a record shaped for something else.
  const undoable = ['append_table_row', 'update_table_row', 'append_onenote_page'];
  if (!undoable.includes(original.operation)) {
    throw failure(
      `A ${original.operation.replace(/_/g, ' ')} cannot be undone by this tool yet. Nothing was changed.`,
    );
  }

  const pageId = original.target;
  let wrote: Record<string, unknown> = {};
  if (original.operation !== 'append_onenote_page') {
    try {
      wrote = JSON.parse(original.wrote ?? '') as Record<string, unknown>;
    } catch {
      throw failure('The record of that write cannot be read, so it cannot be undone. Nothing was changed.');
    }
  }
  const before = await onenotePageContent(pageId, token);
  const undoEntry = (summary: string, preImage: string): WriteRecord => ({
    operation: `undo_${original.operation}`,
    summary,
    target: pageId,
    source_page: null,
    pre_image: preImage,
    write_id: randomUUID(),
    wrote: JSON.stringify({ undoes: writeId }),
  });

  if (original.operation === 'append_table_row') {
    const header = wrote.header as string[];
    const cells = wrote.cells as string[];
    const found = findRow(before.html, header, cells, false, 'The row this tool added');
    if (uncarried(found.table) !== null) {
      throw failure('That table now holds something this tool does not carry, so it cannot be rewritten. Nothing was undone.');
    }
    const content = swapRow(asWritten(found.table), found.index, '');
    const expect = found.rows.filter((_, i) => i !== found.index).map((row) => ({ cells: cellsOf(row), tags: rowFacts(row).tags }));
    const entry = undoEntry(`Removed the row this tool added: ${cells.join(' · ')}`, found.table);
    await record({ ...entry, status: 'pending' });
    const ok = await writeTableChecked(token, pageId, found, content, before.etag, expect);
    await record({ ...entry, status: 'done' });
    return undoResult(ok, `Removed the row this tool added:\n\n  ${cells.join(' · ')}`, entry, 'row');
  }

  if (original.operation === 'update_table_row') {
    const header = wrote.header as string[];
    const was = wrote.before as { cells: string[]; done: boolean };
    const now = wrote.after as { cells: string[]; done: boolean };
    const found = findRow(before.html, header, now.cells, now.done, 'The row this tool changed');
    if (uncarried(found.table) !== null) {
      throw failure('That table now holds something this tool does not carry, so it cannot be rewritten. Nothing was undone.');
    }
    // The row exactly as it stood, from the table captured before the change.
    const previous = childElements(original.pre_image ?? '', 'tr').filter(
      (row, i) => i > 0 && sameCells(cellsOf(row), was.cells) && isTicked(row) === was.done,
    );
    if (previous.length !== 1) {
      throw failure('The row as it was before cannot be found in the record of that write. Nothing was undone.');
    }
    const restored = rowAsWritten(previous[0]);
    const content = swapRow(asWritten(found.table), found.index, restored);
    const expect = found.rows.map((row, i) =>
      i === found.index
        ? { cells: was.cells, tags: rowFacts(previous[0]).tags }
        : { cells: cellsOf(row), tags: rowFacts(row).tags },
    );
    const entry = undoEntry(`Put back the row this tool changed: ${was.cells.join(' · ')}`, found.table);
    await record({ ...entry, status: 'pending' });
    const ok = await writeTableChecked(token, pageId, found, content, before.etag, expect);
    await record({ ...entry, status: 'done' });
    return undoResult(ok, `Put the row back as it was:\n\n  ${was.done ? '[x]' : '[ ]'} ${was.cells.join(' · ')}`, entry, 'row');
  }

  if (original.operation === 'append_onenote_page') {
    // A single paragraph or heading, which is what the digest appends: an
    // appended table or a run of several elements is removed by hand.
    const written = original.wrote ?? '';
    // rootTag is undefined unless the fragment is exactly one element.
    const tag = rootTag(written) ?? '';
    if (!/^(p|h[1-6])$/.test(tag)) {
      throw failure('That append was not a single paragraph or heading, so it is removed by hand. Nothing was changed.');
    }
    const text = asText(written).replace(/\s+/g, ' ').trim();
    const tagValue = written.match(/data-tag="([^"]*)"/)?.[1] ?? null;
    const inTables = pageTables(before.html).map((t) => {
      const at = before.html.indexOf(t);
      return [at, at + t.length] as const;
    });
    const candidates = [...before.html.matchAll(new RegExp(`<${tag}\\b[^>]*\\sid="([^"]+)"`, 'gi'))]
      .filter((m) => !inTables.some(([from, to]) => (m.index ?? 0) > from && (m.index ?? 0) < to))
      .map((m) => ({ id: m[1], element: extractElement(before.html, 'id', m[1]) ?? '' }))
      .filter(({ element }) =>
        asText(element).replace(/\s+/g, ' ').trim() === text &&
        (element.match(/data-tag="([^"]*)"/)?.[1] ?? null) === tagValue,
      );
    if (candidates.length !== 1) {
      throw failure(
        candidates.length === 0
          ? 'The line this tool appended no longer reads as written — it was edited, ticked, removed, ' +
              `or the write never landed — so nothing was undone. It read: ${text}`
          : `The line this tool appended appears ${candidates.length} times, so which one it wrote is not clear. Nothing was undone.`,
      );
    }
    const entry = undoEntry(`Removed the line this tool appended: ${text}`, candidates[0].element);
    await record({ ...entry, status: 'pending' });
    // Replacing with an empty paragraph removes the element entirely: verified
    // live in 0015, with no empty line left where it stood.
    await onenotePatchPage(pageId, [replaceCommand(candidates[0].id, '<p></p>')], token, before.etag);
    await record({ ...entry, status: 'done' });
    let ok = false;
    try {
      const after = await onenotePageContent(pageId, token);
      ok = extractElement(after.html, 'id', candidates[0].id) === undefined || !asText(after.html).includes(text);
    } catch {
      ok = false;
    }
    return undoResult(ok, `Removed the line this tool appended:\n\n  ${text}`, entry, 'line');
  }

  throw failure(
    `A ${original.operation.replace(/_/g, ' ')} cannot be undone by this tool yet. Nothing was changed.`,
  );
}

const undoResult = (ok: boolean, what: string, entry: WriteRecord, unit: 'row' | 'line') => ({
  changed: true,
  verified: ok,
  write_ids: [entry.write_id as string],
  note:
    `${what}\n\n` +
    (ok
      ? unit === 'row'
        ? 'Every other row of the table was read back unchanged.'
        : 'Read back: it is gone, and nothing else was touched.'
      : 'WARNING: the page did not read back as expected after the undo. Tell the musician now; ' +
        "what stood before is in this install's write log.") +
    `\n\nRecorded as write ${entry.write_id}.`,
});

