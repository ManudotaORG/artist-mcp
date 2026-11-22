import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { UnrecordedWriteError, readWriteLog, recordWrite } from '../dist/audit.js';

/**
 * Two-phase recording (0018). The write log is about to become the undo, so a
 * record that could not be made before a write has to stop the write, while a
 * record that could not be made after one must still not report a completed
 * write as failed.
 */

const withLog = async (path, run) => {
  const previous = process.env.ARTIST_MCP_AUDIT;
  process.env.ARTIST_MCP_AUDIT = path;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ARTIST_MCP_AUDIT;
    else process.env.ARTIST_MCP_AUDIT = previous;
  }
};

/** A file standing where the log's directory would have to be: ENOTDIR on every platform. */
const unwritable = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-log-'));
  const blocker = join(dir, 'in-the-way');
  await writeFile(blocker, 'not a directory');
  return { path: join(blocker, 'writes.log'), done: () => rm(dir, { recursive: true, force: true }) };
};

test('a pending record that cannot be saved throws, so the write is not made', async () => {
  const log = await unwritable();
  try {
    await withLog(log.path, () =>
      assert.rejects(
        recordWrite({ operation: 'x', summary: 'y', target: 'z', write_id: 'w1', status: 'pending' }),
        (err) => err instanceof UnrecordedWriteError && /Nothing was written/.test(err.message),
      ),
    );
  } finally {
    await log.done();
  }
});

test('a done record that cannot be saved is still swallowed, because the write happened', async () => {
  const log = await unwritable();
  try {
    await withLog(log.path, () =>
      recordWrite({ operation: 'x', summary: 'y', target: 'z', write_id: 'w1', status: 'done' }),
    );
  } finally {
    await log.done();
  }
});

test('the log reads back newest first, by write id, and from a date', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artist-log-'));
  const path = join(dir, 'writes.log');
  const line = (at, extra) => JSON.stringify({ at, operation: 'append_table_row', summary: 's', target: 'p', ...extra });
  await writeFile(
    path,
    [
      line('2026-11-20T08:00:00.000Z', {}),
      line('2026-11-22T07:00:00.000Z', { write_id: 'a', status: 'pending', wrote: '{"cells":["x"]}' }),
      '{ a line torn in half',
      line('2026-11-22T07:00:01.000Z', { write_id: 'a', status: 'done' }),
      line('2026-11-23T07:00:00.000Z', { write_id: 'b', status: 'pending' }),
    ].join('\n') + '\n',
  );
  try {
    await withLog(path, async () => {
      const all = await readWriteLog();
      assert.equal(all.length, 4, 'a torn line is skipped, not fatal');
      assert.equal(all[0].write_id, 'b', 'newest first');

      const a = await readWriteLog({ writeId: 'a' });
      assert.deepEqual(a.map((l) => l.status), ['done', 'pending']);
      assert.equal(a[1].wrote, '{"cells":["x"]}');

      const recent = await readWriteLog({ since: '2026-11-22T00:00:00.000Z' });
      assert.equal(recent.length, 3);

      // A pending line with no done line is a write that may not have landed.
      const b = await readWriteLog({ writeId: 'b' });
      assert.deepEqual(b.map((l) => l.status), ['pending']);
    });
    await withLog(join(dir, 'missing.log'), async () => assert.deepEqual(await readWriteLog(), []));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
