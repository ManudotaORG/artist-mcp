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
  renderTable,
  replaceCommand,
  rootTag,
  tableRows,
  validateFragment,
} from './onenote-patch.js';
import { asWritten, pageTables, rowFacts, uncarried } from './onenote-rows.js';

// ---------------------------------------------------------------------------
// undo_write: one write this tool made to a OneNote page, reversed at the
// smallest unit — a row, a line, an element — and only while what it wrote
// still reads exactly as written. 0018 step 3, and 0019 step 3 for inserts and
// replaces.

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

/** Text as an undo compares it: tags gone, whitespace collapsed. */
const plain = (html: string): string => asText(html).replace(/\s+/g, ' ').trim();

/** A table's rows as an undo compares them, a line break in a cell read as a space. */
const rowsOf = (table: string): string[][] =>
  tableRows(table).map((row) => row.map((cell) => cell.replace(/\s+\/\s+/g, ' ').replace(/\s+/g, ' ').trim()));

/** How many paragraphs and headings outside tables read exactly as `text`. */
const reading = (html: string, text: string): number => {
  const inTables = pageTables(html).map((t) => {
    const at = html.indexOf(t);
    return [at, at + t.length] as const;
  });
  return [...html.matchAll(/<(p|h[1-6])\b[^>]*\sid="([^"]+)"/gi)]
    .filter((m) => !inTables.some(([from, to]) => (m.index ?? 0) > from && (m.index ?? 0) < to))
    .filter((m) => plain(extractElement(html, 'id', m[2]) ?? '') === text).length;
};

type Placed = { id: string; element: string; shown: string };

/**
 * The one element on the page that still reads as `written`, found by content:
 * generated ids move after any page update, so the id a write targeted cannot
 * be what an undo looks for (0015). A paragraph or heading outside any table is
 * matched by its text and its to-do tag; a table by its rows, cell by cell.
 * None and several are both refusals, for the reasons `findRow` gives.
 */
const findWritten = (html: string, written: string, what: string): Placed => {
  const tag = rootTag(written) ?? '';
  if (tag === 'table') {
    const rows = rowsOf(written);
    const shown = renderTable(written);
    const found = pageTables(html)
      .filter((table) => JSON.stringify(rowsOf(table)) === JSON.stringify(rows))
      .map((table) => ({ id: table.match(/<table\b[^>]*?\sid="([^"]+)"/)?.[1] ?? '', element: table, shown }))
      .filter(({ id }) => id !== '');
    if (found.length === 1) return found[0];
    throw failure(
      found.length === 0
        ? `${what} no longer reads as this tool left it — a cell was edited, a row added or removed, ` +
            `or the write never landed — so nothing was undone. It read:\n\n${shown}`
        : `${what} appears ${found.length} times, so which one this tool wrote is not clear. Nothing was undone.`,
    );
  }
  if (!/^(p|h[1-6])$/.test(tag)) {
    throw failure(`${what} was not a single paragraph, heading or table, so it is changed back by hand. Nothing was changed.`);
  }
  const text = plain(written);
  const tagValue = written.match(/data-tag="([^"]*)"/)?.[1] ?? null;
  const inTables = pageTables(html).map((t) => {
    const at = html.indexOf(t);
    return [at, at + t.length] as const;
  });
  const found = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\sid="([^"]+)"`, 'gi'))]
    .filter((m) => !inTables.some(([from, to]) => (m.index ?? 0) > from && (m.index ?? 0) < to))
    .map((m) => ({ id: m[1], element: extractElement(html, 'id', m[1]) ?? '', shown: text }))
    .filter(
      ({ element }) =>
        plain(element) === text && (element.match(/data-tag="([^"]*)"/)?.[1] ?? null) === tagValue,
    );
  if (found.length === 1) return found[0];
  throw failure(
    found.length === 0
      ? `${what} no longer reads as written — it was edited, ticked, removed, ` +
          `or the write never landed — so nothing was undone. It read: ${text}`
      : `${what} appears ${found.length} times, so which one it wrote is not clear. Nothing was undone.`,
  );
};

/**
 * A pre-image put back into markup OneNote accepts: generated ids and
 * `data-id`s stripped, since they name the element as it was and not as it will
 * be, and a table normalised as `append_row` writes one. Null when what remains
 * is something this tool would refuse to write — then the undo refuses too and
 * shows what stood there, for a person to put back.
 */
const restorable = (preImage: string): string | null => {
  try {
    if (rootTag(preImage) === 'table') return uncarried(preImage) === null ? asWritten(preImage) : null;
    return validateFragment(preImage.replace(/\s(?:id|data-id)="[^"]*"/g, ''));
  } catch {
    return null;
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
  const undoable = [
    'append_table_row',
    'update_table_row',
    'append_onenote_page',
    'insert_onenote_element',
    'replace_onenote_element',
  ];
  if (!undoable.includes(original.operation)) {
    throw failure(
      `A ${original.operation.replace(/_/g, ' ')} cannot be undone by this tool yet. Nothing was changed.`,
    );
  }

  const pageId = original.target;
  let wrote: Record<string, unknown> = {};
  if (original.operation === 'append_table_row' || original.operation === 'update_table_row') {
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

  if (original.operation === 'append_onenote_page' || original.operation === 'insert_onenote_element') {
    // A single paragraph or heading: an appended or inserted table, a list, or a
    // run of several elements is removed by hand. Removing a table this way, or
    // a list item, is refused until it has been tried on a real page (0019).
    const written = original.wrote ?? '';
    const added = original.operation === 'append_onenote_page' ? 'appended' : 'inserted';
    if (!/^(p|h[1-6])$/.test(rootTag(written) ?? '')) {
      throw failure(`That ${added === 'appended' ? 'append' : 'insert'} was not a single paragraph or heading, so it is removed by hand. Nothing was changed.`);
    }
    const found = findWritten(before.html, written, `The line this tool ${added}`);
    const entry = undoEntry(`Removed the line this tool ${added}: ${found.shown}`, found.element);
    await record({ ...entry, status: 'pending' });
    // Replacing with an empty paragraph removes the element entirely: verified
    // live in 0015, with no empty line left where it stood.
    await onenotePatchPage(pageId, [replaceCommand(found.id, '<p></p>')], token, before.etag);
    await record({ ...entry, status: 'done' });
    let ok = false;
    try {
      const after = await onenotePageContent(pageId, token);
      ok = extractElement(after.html, 'id', found.id) === undefined || !asText(after.html).includes(found.shown);
    } catch {
      ok = false;
    }
    return undoResult(ok, `Removed the line this tool ${added}:\n\n  ${found.shown}`, entry, 'line');
  }

  if (original.operation === 'replace_onenote_element') {
    // Found by what the replace wrote, and put back from the pre-image recorded
    // before it. A table goes back whole, only while every row still reads as
    // the replace left it: an edit the musician made anywhere in it since makes
    // the undo refuse, which is coarser than a row undo and the reason task
    // tables are changed with append_row and update_row instead.
    const written = original.wrote ?? '';
    const was = original.pre_image ?? '';
    if (written === '' || was === '') {
      throw failure('The record of that replace has no copy of what it wrote or what it replaced, so it cannot be undone. Nothing was changed.');
    }
    const table = rootTag(written) === 'table';
    const shownWas = table ? renderTable(was) : plain(was);
    const content = restorable(was);
    if (content === null) {
      throw failure(
        'What that replace overwrote holds something this tool does not write, so it cannot be put back ' +
          `automatically. Nothing was changed. It read:\n\n${shownWas}`,
      );
    }
    const found = findWritten(before.html, written, table ? 'The table this tool wrote' : 'The text this tool wrote');
    const entry = undoEntry(`Put back what this tool replaced: ${table ? 'a table' : shownWas}`, found.element);
    await record({ ...entry, status: 'pending' });
    await onenotePatchPage(pageId, [replaceCommand(found.id, content)], token, before.etag);
    await record({ ...entry, status: 'done' });
    // Read back by content, as everything here is: the restored element has a
    // new id, and what counts is that the page says again what it said.
    let ok = false;
    try {
      const after = await onenotePageContent(pageId, token);
      ok = table
        ? pageTables(after.html).some((t) => JSON.stringify(rowsOf(t)) === JSON.stringify(rowsOf(was)))
        : reading(after.html, shownWas) === reading(before.html, shownWas) + 1 &&
          reading(after.html, found.shown) === reading(before.html, found.shown) - 1;
    } catch {
      ok = false;
    }
    return undoResult(ok, `Put back what this tool replaced:\n\n${table ? shownWas : `  ${shownWas}`}`, entry, table ? 'table' : 'element');
  }

  throw failure(
    `A ${original.operation.replace(/_/g, ' ')} cannot be undone by this tool yet. Nothing was changed.`,
  );
}

const undoResult = (ok: boolean, what: string, entry: WriteRecord, unit: 'row' | 'line' | 'table' | 'element') => ({
  changed: true,
  verified: ok,
  write_ids: [entry.write_id as string],
  note:
    `${what}\n\n` +
    (ok
      ? unit === 'row'
        ? 'Every other row of the table was read back unchanged.'
        : unit === 'table'
          ? 'Read back: the table reads as it did before.'
          : unit === 'element'
            ? 'Read back: it reads as it did before.'
            : 'Read back: it is gone, and nothing else was touched.'
      : 'WARNING: the page did not read back as expected after the undo. Tell the musician now; ' +
        "what stood before is in this install's write log.") +
    `\n\nRecorded as write ${entry.write_id}.`,
});

