import assert from 'node:assert/strict';
import test from 'node:test';

import { listNotes } from '../dist/notes.js';
import { isUpdateTarget, pickTaskPages } from '../dist/task-pages.js';
import { withGraphBatch } from './support/graph-batch.mjs';

/**
 * The CL Aufgaben page walk is shared by `map_notes` in tasks mode and the
 * hosted task view (0020), so the two cannot disagree about which page is a
 * project's task record. These pin the rule where it now lives.
 */

test('the title rule takes the templated and the legacy title, and nothing else', () => {
  assert.equal(isUpdateTarget('CL Aufgaben — Montepulciano'), true);
  assert.equal(isUpdateTarget('CL Aufgaben – Melk BCW (Barocktage 2027)'), true);
  assert.equal(isUpdateTarget('CL  Aufgaben'), true);
  assert.equal(isUpdateTarget('CL Aufgaben-Kategorien'), false);
  assert.equal(isUpdateTarget('CL Status & Termine'), false);
});

test('one page per section is read; none and several are returned, not guessed', () => {
  const sec = (name, notebook = '2026-27') => ({ name, notebook });
  const page = (id, title, section, notebook = '2026-27') => ({ id, title, section, notebook });
  const { toRead, without, several } = pickTaskPages(
    [sec('Vidala'), sec('Köln Orfeo'), sec('Essen'), sec('Vidala', '2027-28')],
    [
      page('v', 'CL Aufgaben — Vidala', 'Vidala'),
      page('v-other', 'Programm', 'Vidala'),
      page('k', 'CL Status & Termine', 'Köln Orfeo'),
      page('e1', 'CL Aufgaben — Essen', 'Essen'),
      page('e2', 'CL Aufgaben', 'Essen'),
      // Same section name, another season: not Vidala 2026-27's page.
      page('v28', 'CL Aufgaben — Vidala 2028', 'Vidala', '2027-28'),
    ],
  );
  assert.deepEqual(toRead.map((p) => p.id), ['v', 'v28']);
  assert.deepEqual(without.map((s) => s.name), ['Köln Orfeo']);
  assert.deepEqual(several.map(({ sec, pages }) => [sec.name, pages.map((p) => p.id)]), [['Essen', ['e1', 'e2']]]);
});

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a page listing carries where the page opens, at no extra request', async () => {
  const seen = [];
  globalThis.fetch = withGraphBatch(async (url) => {
    const path = String(url);
    seen.push(path);
    const body = path.includes('/me/onenote/sections?')
      ? { value: [{ id: '0-abc', displayName: 'Vidala', lastModifiedDateTime: '2026-11-20T10:00:00Z', parentNotebook: { displayName: '2026-27' } }] }
      : {
          value: [
            {
              id: '0-p1',
              title: 'CL Aufgaben — Vidala',
              lastModifiedDateTime: '2026-11-20T10:00:00Z',
              links: {
                oneNoteClientUrl: { href: 'onenote:https://example/p1' },
                oneNoteWebUrl: { href: 'https://example/p1' },
              },
            },
            { id: '0-p2', title: 'Ohne Links', lastModifiedDateTime: '2026-11-20T10:00:00Z' },
          ],
        };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const { notes } = await listNotes('token');
  const withLinks = notes.find((n) => n.id === '0-p1');
  assert.equal(withLinks.web_url, 'https://example/p1');
  assert.equal(withLinks.client_url, 'onenote:https://example/p1');
  // Absent rather than null, so nothing that compares summaries changes shape.
  assert.equal('web_url' in notes.find((n) => n.id === '0-p2'), false);
  assert.ok(seen.some((u) => /pages\?\$select=[^&]*links/.test(decodeURIComponent(u))), 'links is not selected');
});
