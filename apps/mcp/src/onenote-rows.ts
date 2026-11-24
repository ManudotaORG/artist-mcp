/**
 * Task rows on a page this tool created: added by the server (0017), changed
 * one row at a time (0018). Split out of `onenote-patch.ts` (0019 step 0),
 * whose element-editing core every function here builds on; nothing in that
 * file's reasoning about pre-images and generated ids is repeated here, and all
 * of it applies.
 */

import { createHash, randomUUID } from 'node:crypto';
import { onenotePageContent, onenotePatchPage } from './api.js';
import { type RecordWrite, type WriteRecord } from './audit.js';
import {
  asText,
  childElements,
  escapeXml,
  failure,
  isGeneratedId,
  isTableId,
  MAX_TEXT_CHARS,
  ONENOTE_ID,
  preImage,
  replaceCommand,
  TASK_TAGS,
} from './onenote-patch.js';

// ---------------------------------------------------------------------------
// append_row: one or more task rows added to the end of a table, built by the
// server, committed in one call. See docs/decisions/0017-appending-a-table-row.md.

/** The most rows one call may add. A digest adds a handful; more is a sign something is wrong. */
const MAX_NEW_ROWS = 12;

/** A header cell naming the task column, matched on the whole cell, as tasks mode does. */
const TASK_COLUMN = /^(aufgaben?|tasks?|to-?dos?)$/i;

/**
 * What a task table may hold for the server to carry it: text and tags, the
 * owner's rule for CL Aufgaben tables, and exactly what the round trip tested.
 * An allowlist rather than a list of dangers, because a list of dangers can only
 * name what is already known to break.
 */
const CARRIED_TAGS = new Set(['table', 'tbody', 'tr', 'td', 'th', 'p', 'span', 'br', 'a', 'b', 'i', 'u', 'strong', 'em']);
const CARRIED_ATTRIBUTES = new Set(['id', 'data-id', 'style', 'href', 'data-tag', 'lang', 'border']);

/** Why a table cannot be carried, or null when it can. */
export const uncarried = (table: string): string | null => {
  if ((table.match(/<table\b/gi) ?? []).length > 1) return 'it holds a table inside a cell';
  for (const tag of table.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const name = tag[1].toLowerCase();
    if (!CARRIED_TAGS.has(name)) return `it holds a <${name}>, and a task table carries text and tags only`;
    for (const attr of tag[2].matchAll(/\s([a-z-]+)\s*=/gi)) {
      const attrName = attr[1].toLowerCase();
      if (!CARRIED_ATTRIBUTES.has(attrName)) {
        return attrName === 'colspan' || attrName === 'rowspan'
          ? 'it has merged cells'
          : `a <${name}> in it carries ${attrName}, which this does not carry`;
      }
    }
    const tagValue = tag[2].match(/\sdata-tag="([^"]*)"/i)?.[1];
    if (tagValue !== undefined && !TASK_TAGS.has(tagValue)) {
      return `it carries the OneNote tag "${tagValue}", and only the two to-do tags are carried`;
    }
  }
  return null;
};

/**
 * The table as read, put back into the form OneNote accepts.
 *
 * Found by the round trip in 0017, every one of these silently: OneNote returns
 * a to-do tag on a <span> in the cell and accepts one only on a <p> — sent back
 * as read, every tag in the table is dropped, the ticks included; it returns a
 * CSS border and honours only the attribute; and it keeps a sent id as a
 * data-id, so ids sent back pile up with every append.
 */
export const asWritten = (table: string): string => {
  let out = '';
  let at = 0;
  const tagged = /<span\b([^>]*?)\sdata-tag="([^"]*)"([^>]*)>/gi;
  let open: RegExpExecArray | null;
  while ((open = tagged.exec(table)) !== null) {
    // Depth-counted to this span's own close: a bold run inside a task would
    // otherwise end the paragraph halfway through the task.
    const step = /<(\/?)span\b[^>]*?(\/?)>/gi;
    step.lastIndex = open.index;
    let depth = 0;
    let match: RegExpExecArray | null;
    let close = -1;
    while ((match = step.exec(table)) !== null) {
      if (match[2] === '/') continue;
      depth += match[1] === '/' ? -1 : 1;
      if (depth === 0) {
        close = match.index;
        break;
      }
    }
    if (close < 0) throw failure('The table could not be read whole, so it cannot be carried. Nothing was changed.');
    const inner = table.slice(open.index + open[0].length, close);
    out += `${table.slice(at, open.index)}<p data-tag="${open[2]}">${inner}</p>`;
    at = close + '</span>'.length;
    tagged.lastIndex = at;
  }
  out += table.slice(at);

  return out
    .replace(/\s(?:data-id|id)="[^"]*"/g, '')
    .replace(/<table\b(?![^>]*\bborder=)/i, '<table border="1"');
};

export const rowFacts = (row: string): { text: string; tags: string } => ({
  text: asText(row).replace(/\s+/g, ' ').trim(),
  tags: [...row.matchAll(/data-tag="([^"]*)"/g)].map((m) => m[1]).join(','),
});

/** The outermost tables of a page, in order. */
export const pageTables = (html: string): string[] => childElements(html, 'table');

type NewRow = Record<string, string>;

const newRowsFrom = (params: Record<string, unknown>): NewRow[] => {
  const rows = params.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw failure('append_row needs rows: the new rows, each as its cells by header name.');
  }
  if (rows.length > MAX_NEW_ROWS) {
    throw failure(`That is ${rows.length} rows in one call; ${MAX_NEW_ROWS} is the most.`);
  }
  return rows.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw failure(`Row ${index + 1} is not a set of cells by header name.`);
    }
    const cells: NewRow = {};
    for (const [name, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value !== 'string') throw failure(`Row ${index + 1}: the cell "${name}" is not text.`);
      if (value.length > MAX_TEXT_CHARS) {
        throw failure(`Row ${index + 1}: the cell "${name}" is ${value.length} characters; ${MAX_TEXT_CHARS} is the most.`);
      }
      cells[name] = value;
    }
    return cells;
  });
};

/** A cell in the house shape, its text escaped. */
const houseCell = (text: string, task: boolean): string =>
  `<td style="border:1px solid #A3A3A3;padding:4px"><p${task ? ' data-tag="to-do"' : ''}>${escapeXml(text.trim()).replace(/\n/g, '<br/>')}</p></td>`;

/**
 * A task table read for a server-built change: the page as it stands (its ETag
 * goes out as If-Match), the table, its rows and header, and its task column —
 * or a refusal, writing nothing, where the table is not one the server can
 * carry. Shared by append_row and update_row, so both refuse the same tables
 * for the same reasons.
 */
const readTaskTable = async (token: string, pageId: string, tableId: string, otherwise: string) => {
  const before = await onenotePageContent(pageId, token);
  const table = preImage(before.html, tableId);
  const ordinal = pageTables(before.html).findIndex((t) => t.includes(`id="${tableId}"`));

  const reason = uncarried(table);
  if (reason !== null) {
    throw failure(`This table cannot be changed by this tool: ${reason}. Nothing was changed. ${otherwise}`);
  }
  const rows = childElements(table, 'tr');
  const header = rows.length === 0 ? [] : childElements(rows[0], 'td|th').map((cell) => asText(cell).replace(/\s+/g, ' ').trim());
  if (rows.length === 0 || /data-tag=/.test(rows[0]) || header.length < 2) {
    throw failure(`This table has no header row, so its columns cannot be named. Nothing was changed. ${otherwise}`);
  }
  const taskAt = header.findIndex((cell) => TASK_COLUMN.test(cell));
  if (taskAt < 0) {
    throw failure(
      `This table (headed "${header.join(' · ')}") has no task column, so it is not a task ` +
        `table. Nothing was changed. ${otherwise}`,
    );
  }
  return { before, table, ordinal, rows, header, taskAt };
};

/**
 * Add rows to the end of a task table: the server reads the table, carries every
 * existing row across as OneNote returned it, adds the new ones, writes with
 * If-Match, and reads the page back to check every existing row survived.
 *
 * The model writes no existing cell, which is what puts this on the one-call
 * side of 0009's rule, and the read-back proves it on every write rather than
 * once on a scratch page.
 */
export async function appendRows(token: string, params: Record<string, unknown>, record: RecordWrite) {
  const pageId = params.page_id;
  if (typeof pageId !== 'string' || !ONENOTE_ID.test(pageId)) {
    throw failure('page_id is required, and must name the page to change.');
  }
  const tableId = params.element_id;
  if (typeof tableId !== 'string' || !isGeneratedId(tableId) || !isTableId(tableId)) {
    throw failure(
      'append_row needs element_id: the generated id of the table, as read_note lists it. ' +
        'Read the page again if you do not have one.',
    );
  }
  for (const other of ['text', 'html', 'changes', 'position']) {
    if (params[other] !== undefined && params[other] !== null && params[other] !== '') {
      throw failure(`append_row takes rows, not ${other}. Send any other change in its own call.`);
    }
  }
  const source = params.source_page;
  if (source !== undefined && source !== null && source !== '' && (typeof source !== 'string' || !ONENOTE_ID.test(source))) {
    throw failure('source_page is malformed.');
  }
  const wanted = newRowsFrom(params);

  // 1–2. Read immediately before, and refuse what cannot be carried.
  const { before, table, ordinal, rows, header, taskAt } = await readTaskTable(
    token,
    pageId,
    tableId,
    'Add the task below the table instead, as an append.',
  );

  const byName = new Map(header.map((name, index) => [name.toLowerCase(), index]));
  const built = wanted.map((cells, index) => {
    const values = header.map(() => 'UNKNOWN');
    for (const [name, value] of Object.entries(cells)) {
      const at = byName.get(name.trim().toLowerCase());
      if (at === undefined) {
        throw failure(
          `Row ${index + 1}: "${name}" is not a column of this table. Its columns are ` +
            `${header.map((h) => `"${h}"`).join(', ')}. Nothing was changed.`,
        );
      }
      values[at] = value.trim() === '' ? 'UNKNOWN' : value;
    }
    if (values[taskAt] === 'UNKNOWN') {
      throw failure(`Row ${index + 1} has no task: give the "${header[taskAt]}" cell. Nothing was changed.`);
    }
    return values;
  });
  const newRowsHtml = built
    .map((values) => `<tr>${values.map((value, at) => houseCell(value, at === taskAt)).join('')}</tr>`)
    .join('');

  // 3. The table put back into what OneNote accepts, with the new rows at the end.
  const content = asWritten(table).replace(/<\/table>\s*$/i, `${newRowsHtml}</table>`);

  // 4. Recorded before the write, with the table as it was and the row as it
  // will be written, and the write refused if that fails (0018). The row is
  // what an undo looks for; the table is the only copy of what stood before.
  const entries: WriteRecord[] = built.map((values) => ({
    operation: 'append_table_row',
    summary: `Added a row to the table headed "${header.join(' · ')}": ${values.join(' · ')}`,
    target: pageId,
    source_page: typeof source === 'string' && source !== '' ? source : null,
    pre_image: table,
    write_id: randomUUID(),
    wrote: JSON.stringify({ table: tableId, header, cells: values }),
  }));
  for (const entry of entries) await record({ ...entry, status: 'pending' });

  // 5. Written whole, If-Match on the read just made.
  await onenotePatchPage(pageId, [replaceCommand(tableId, content)], token, before.etag);
  for (const entry of entries) await record({ ...entry, status: 'done' });

  // 6. Read back, and every existing row checked.
  const oldRows = rows.map(rowFacts);
  let changed: number[] = [];
  let unread = false;
  try {
    const after = await onenotePageContent(pageId, token);
    const written = ordinal < 0 ? undefined : pageTables(after.html)[ordinal];
    const newRows = written === undefined ? [] : childElements(written, 'tr').map(rowFacts);
    if (newRows.length !== oldRows.length + built.length) unread = true;
    changed = oldRows
      .map((old, index) => ({ old, now: newRows[index], index }))
      .filter(({ old, now }) => now === undefined || now.text !== old.text || now.tags !== old.tags)
      .map(({ index }) => index);
  } catch {
    unread = true;
  }

  const added = built.map((values) => `[ ] ${values[taskAt]}`).join('\n');
  const note =
    changed.length === 0 && !unread
      ? `Added to the table headed "${header.join(' · ')}":\n\n${added}\n\n` +
        `The ${oldRows.length - 1} rows already in it were read back unchanged. To take this ` +
        'back, call undo_write with its write id, below.'
      : `Added to the table headed "${header.join(' · ')}":\n\n${added}\n\n` +
        'WARNING: ' +
        (unread
          ? 'the table could not be read back whole after the write, so it is NOT confirmed that the rows already in it survived. '
          : `row${changed.length === 1 ? '' : 's'} ${changed.join(', ')} of the table read back differently after the write. `) +
        "Tell the musician now. The table as it was before is in this install's write log, " +
        'and nothing here can put it back.';

  return {
    changed: true,
    page_id: pageId,
    verified: changed.length === 0 && !unread,
    write_ids: entries.map((entry) => entry.write_id as string),
    note: `${note}\n\nRecorded as write ${entries.map((entry) => entry.write_id).join(', ')}.`,
  };
}

// ---------------------------------------------------------------------------
// update_row: one task row changed by the server — its tick, its cells — with
// every other row carried across and checked afterwards. 0018 step 2.

/** The task text of a row, as tasks mode and read_note show it: one line, checkbox markers gone. */
const taskTextOf = (row: string, taskAt: number): string => {
  const cells = childElements(row, 'td|th');
  return cells[taskAt] === undefined
    ? ''
    : asText(cells[taskAt]).replace(/^(?:- )?\[[ x]\]\s*/gm, '').replace(/\s+/g, ' ').trim();
};

type RowChange = { match: string; done: boolean | null; set: Record<string, string> };

const rowChangeFrom = (params: Record<string, unknown>): RowChange => {
  const match = params.row;
  if (typeof match !== 'string' || match.trim() === '') {
    throw failure(
      'update_row needs row: the task text of the row to change, exactly as map_notes or ' +
        'read_note shows it.',
    );
  }
  const done = params.done;
  if (done !== undefined && done !== null && typeof done !== 'boolean') {
    throw failure('done is true to tick the task, false to reopen it, or left out.');
  }
  const rawSet = params.set ?? {};
  if (rawSet === null || typeof rawSet !== 'object' || Array.isArray(rawSet)) {
    throw failure('set is the cells to change, by header name, as text.');
  }
  const set: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawSet as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw failure(`The cell "${name}" needs text. A cell is never emptied by this.`);
    }
    if (value.length > MAX_TEXT_CHARS) throw failure(`The cell "${name}" is ${value.length} characters; ${MAX_TEXT_CHARS} is the most.`);
    set[name] = value;
  }
  if ((done === undefined || done === null) && Object.keys(set).length === 0) {
    throw failure('update_row needs something to change: done, or cells in set.');
  }
  return { match: match.replace(/\s+/g, ' ').trim(), done: typeof done === 'boolean' ? done : null, set };
};

/**
 * The change resolved against the table as it is now: which row, what it says,
 * and the row as it will be written. Shared by the preview and the write, so
 * the two cannot drift, and the token is bound to what this returns.
 */
const resolveRowChange = (
  table: string,
  rows: string[],
  header: string[],
  taskAt: number,
  change: RowChange,
) => {
  const matches = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index > 0 && taskTextOf(row, taskAt) === change.match);
  if (matches.length !== 1) {
    throw failure(
      matches.length === 0
        ? `No row of this table has the task "${change.match}". Nothing was changed. Read the ` +
            'page again and give the task exactly as it reads now.'
        : `${matches.length} rows of this table have the task "${change.match}", so which one ` +
            'to change is not clear. Nothing was changed.',
    );
  }
  const [{ row, index }] = matches;
  if (!/data-tag="to-do(?::completed)?"/.test(childElements(row, 'td|th')[taskAt] ?? '')) {
    throw failure(`The row "${change.match}" carries no to-do tag, so it is not a task row. Nothing was changed.`);
  }

  const byName = new Map(header.map((name, at) => [name.toLowerCase(), at]));

  // policy:tasks: the status cell follows the tag, in the same change — never
  // a tick beside a cell still saying OFFEN. Applied here rather than only
  // stated there, because an unattended tick (0018 step 4) has nobody to
  // notice, and this fires only on the calls it is about.
  const statusAt = header.findIndex((name) => /^status$/i.test(name.trim()));
  if (change.done !== null && statusAt >= 0) {
    const given = Object.keys(change.set).some((name) => name.trim().toLowerCase() === header[statusAt].toLowerCase());
    if (!given) {
      throw failure(
        `This table has a ${header[statusAt]} column, and it changes with the tick: give ` +
          `${header[statusAt]} in set — the page's own word for ${change.done ? 'done (ERLEDIGT where the page uses it)' : 'open (OFFEN where the page uses it)'}. ` +
          'Nothing was changed.',
      );
    }
  }
  const setAt = new Map<number, string>();
  for (const [name, value] of Object.entries(change.set)) {
    const at = byName.get(name.trim().toLowerCase());
    if (at === undefined) {
      throw failure(
        `"${name}" is not a column of this table. Its columns are ` +
          `${header.map((h) => `"${h}"`).join(', ')}. Nothing was changed.`,
      );
    }
    if (at === taskAt) {
      throw failure(
        `The task text itself is not changed by this — only its tick and the other cells. ` +
          'Nothing was changed.',
      );
    }
    setAt.set(at, value);
  }

  // The row as OneNote accepts it, then the change applied to it alone.
  const written = asWritten(`<table>${row}</table>`).replace(/^<table border="1">|<\/table>$/g, '');
  const cells = childElements(written, 'td|th');
  const changedCells = cells.map((cell, at) => {
    if (at === taskAt && change.done !== null) {
      return cell.replace(/data-tag="to-do(?::completed)?"/, `data-tag="${change.done ? 'to-do:completed' : 'to-do'}"`);
    }
    const value = setAt.get(at);
    if (value === undefined) return cell;
    const open = cell.match(/^<t[dh]\b[^>]*>/)?.[0] ?? '<td>';
    const close = cell.match(/<\/t[dh]>\s*$/)?.[0] ?? '</td>';
    return `${open}<p>${escapeXml(value.trim()).replace(/\n/g, '<br/>')}</p>${close}`;
  });
  // Rebuilt from its cells in order, never by replacing one cell's markup in
  // the row: two cells reading UNKNOWN have identical markup, and a string
  // replace would change the first of them, not the one asked for.
  const rowOpen = written.match(/^\s*<tr\b[^>]*>/)?.[0].trim() ?? '<tr>';
  const rebuilt = `${rowOpen}${changedCells.join('')}</tr>`;

  const cellTexts = (r: string) => childElements(r, 'td|th').map((c) => asText(c).replace(/\s+/g, ' ').trim());
  return {
    index,
    row,
    rebuilt,
    before: { cells: cellTexts(row), done: /data-tag="to-do:completed"/.test(row) },
    after: { cells: cellTexts(rebuilt), done: /data-tag="to-do:completed"/.test(rebuilt) },
  };
};

const rowToken = (pageId: string, tableId: string, change: RowChange, rowBefore: string): string =>
  createHash('sha256')
    .update(JSON.stringify({ pageId, tableId, change, row: rowFacts(rowBefore) }))
    .digest('hex')
    .slice(0, 32);

const describeRow = (header: string[], cells: string[], done: boolean): string =>
  `${done ? '[x]' : '[ ]'} ${header.map((name, at) => `${name}: ${cells[at] ?? ''}`).join(' · ')}`;

const rowCallFrom = (params: Record<string, unknown>) => {
  const pageId = params.page_id;
  if (typeof pageId !== 'string' || !ONENOTE_ID.test(pageId)) {
    throw failure('page_id is required, and must name the page to change.');
  }
  const tableId = params.element_id;
  if (typeof tableId !== 'string' || !isGeneratedId(tableId) || !isTableId(tableId)) {
    throw failure(
      'update_row needs element_id: the generated id of the table, as read_note lists it.',
    );
  }
  for (const other of ['text', 'html', 'changes', 'position', 'rows']) {
    if (params[other] !== undefined && params[other] !== null && params[other] !== '') {
      throw failure(`update_row takes row, done and set, not ${other}. Send any other change in its own call.`);
    }
  }
  return { pageId, tableId, change: rowChangeFrom(params) };
};

/** Show a row change and hand back the token that makes it — until undo exists, 0018 step 3. */
export async function previewRowUpdate(token: string, params: Record<string, unknown>) {
  const { pageId, tableId, change } = rowCallFrom(params);
  const { table, rows, header, taskAt } = await readTaskTable(token, pageId, tableId, '');
  const resolved = resolveRowChange(table, rows, header, taskAt, change);
  return {
    preview:
      `Change this row:\n\n  ${describeRow(header, resolved.before.cells, resolved.before.done)}\n\n` +
      `to:\n\n  ${describeRow(header, resolved.after.cells, resolved.after.done)}\n\n` +
      'Every other row of the table is carried across unchanged by this tool and checked afterwards.',
    page_id: pageId,
    parts: [],
    abbreviated: false,
    confirmation_token: rowToken(pageId, tableId, change, resolved.row),
    note: 'Show this to the musician and wait for their yes.',
  };
}

/**
 * Change one task row: read the table, find the row by its task text, apply
 * the tick or the cells to that row alone, record the table and the row as
 * they were before writing, write with If-Match, and read back to check that
 * every other row is unchanged and this one says what was set.
 */
export async function updateRow(token: string, params: Record<string, unknown>, record: RecordWrite) {
  const { pageId, tableId, change } = rowCallFrom(params);
  const source = params.source_page;
  if (source !== undefined && source !== null && source !== '' && (typeof source !== 'string' || !ONENOTE_ID.test(source))) {
    throw failure('source_page is malformed.');
  }

  const { before, table, ordinal, rows, header, taskAt } = await readTaskTable(token, pageId, tableId, '');
  const resolved = resolveRowChange(table, rows, header, taskAt, change);

  // No token since undo_write was verified on hosted (0018): a wrong tick or
  // date is reversed by its write id, so 0009's rule puts this on the one-call
  // side. What stands between a change and Ruben's edits is If-Match on the
  // read just made, and the read-back below. A preview is still available, and
  // in a conversation policy:patch still has the change shown first; in an
  // automation it is not allowed at all until 0018's step 4.
  // The table as OneNote accepts it, with this one row replaced.
  // Swapped by position, not by searching for its markup, so the row changed
  // is the row resolved — and refused outright if the table does not split
  // into the rows it was read as.
  const translated = asWritten(table);
  const translatedRows = childElements(translated, 'tr');
  if (translatedRows.length !== rows.length) {
    throw failure('The table could not be read row by row, so it cannot be changed safely. Nothing was changed.');
  }
  let at = -1;
  for (let i = 0, from = 0; i <= resolved.index; i++) {
    at = translated.indexOf(translatedRows[i], from);
    from = at + translatedRows[i].length;
  }
  const content =
    translated.slice(0, at) + resolved.rebuilt + translated.slice(at + translatedRows[resolved.index].length);

  const entry: WriteRecord = {
    operation: 'update_table_row',
    summary:
      `Changed a row of the table headed "${header.join(' · ')}": ` +
      `${describeRow(header, resolved.before.cells, resolved.before.done)} → ` +
      `${describeRow(header, resolved.after.cells, resolved.after.done)}`,
    target: pageId,
    source_page: typeof source === 'string' && source !== '' ? source : null,
    pre_image: table,
    write_id: randomUUID(),
    wrote: JSON.stringify({ table: tableId, header, before: resolved.before, after: resolved.after }),
  };
  await record({ ...entry, status: 'pending' });
  await onenotePatchPage(pageId, [replaceCommand(tableId, content)], token, before.etag);
  await record({ ...entry, status: 'done' });

  // Read back: every other row unchanged, and this one as set.
  // Other rows are compared read against read. The changed row is compared
  // cell by cell, because what was written and what OneNote reads back differ
  // in shape — a <p> in the cell as written, a run of text as read — and run
  // together as one string they never match.
  const oldRows = rows.map(rowFacts);
  const cellsOf = (r: string) => childElements(r, 'td|th').map((c) => asText(c).replace(/\s+/g, ' ').trim());
  const expectedCells = JSON.stringify(cellsOf(resolved.rebuilt));
  const expectedTags = rowFacts(resolved.rebuilt).tags;
  let problems: string[] = [];
  try {
    const after = await onenotePageContent(pageId, token);
    const written = ordinal < 0 ? undefined : pageTables(after.html)[ordinal];
    const nowRows = written === undefined ? [] : childElements(written, 'tr');
    if (nowRows.length !== oldRows.length) problems.push('the table read back with a different number of rows');
    oldRows.forEach((old, at) => {
      const got = nowRows[at];
      const same =
        got !== undefined &&
        (at === resolved.index
          ? JSON.stringify(cellsOf(got)) === expectedCells && rowFacts(got).tags === expectedTags
          : rowFacts(got).text === old.text && rowFacts(got).tags === old.tags);
      if (!same) problems.push(`row ${at}`);
    });
  } catch {
    problems = ['the table could not be read back'];
  }

  const shown = describeRow(header, resolved.after.cells, resolved.after.done);
  return {
    changed: true,
    page_id: pageId,
    verified: problems.length === 0,
    write_ids: [entry.write_id as string],
    note:
      (problems.length === 0
        ? `Changed the row to:\n\n  ${shown}\n\nEvery other row was read back unchanged.`
        : `Changed the row to:\n\n  ${shown}\n\nWARNING: after the write, ${problems.join(', ')} ` +
          "did not read back as expected. Tell the musician now. The table as it was before is in this install's write log.") +
      `\n\nRecorded as write ${entry.write_id}.`,
  };
}

