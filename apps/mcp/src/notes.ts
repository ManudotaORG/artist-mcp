/**
 * OneNote: the working unit. One page is one unit of work, and everything the
 * agent pack does rests on that.
 *
 * Ported from the edge function unchanged in behaviour, including the section
 * enumeration below, which exists for a reason that is not obvious from the
 * code alone.
 */

import { GraphError } from './client.js';
import { graphGet } from './api.js';

/** Graph ids are opaque, but they are concatenated into URLs, so they are checked like any other value. */
const ONENOTE_ID = /^[A-Za-z0-9!._~-]{1,300}$/;

type OneNotePage = {
  id: string;
  title?: string;
  lastModifiedDateTime?: string;
};

type OneNoteSection = {
  id: string;
  displayName?: string;
  parentNotebook?: { displayName?: string };
};

export type NoteSummary = {
  id: string;
  title: string;
  section: string | null;
  notebook: string | null;
  last_modified: string | null;
};

/**
 * OneNote nests deeply and emits entities for accented characters, so the raw
 * content is unreadable as prose without this. Order matters in two places, and
 * both are marked.
 */
export const htmlToText = (html: string): string =>
  html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    // Numeric entities first: OneNote emits these for accented characters, so
    // without this "Müller" arrives as "M&#252;ller".
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // &amp; last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&')
    // Flatten the indentation and stray blank lines the nesting leaves behind.
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * `/me/onenote/pages` looks like the obvious call and works right up until the
 * account has too many sections, at which point Graph fails the whole request
 * with error 20266 and tells you to page per section instead. Organised
 * notebooks hit this, so sections are enumerated first and their pages fetched
 * one section at a time. The notebook name comes along for free.
 *
 * Do not "simplify" this back to the single call.
 */
export const listNotes = async (token: string): Promise<{ notes: NoteSummary[] }> => {
  const sectionsRes = await graphGet(
    '/me/onenote/sections?$select=id,displayName' +
      '&$expand=parentNotebook($select=displayName)&$top=100',
    token,
  );
  const sections = ((await sectionsRes.json()) as { value?: OneNoteSection[] }).value ?? [];

  const perSection = await Promise.all(
    sections
      .filter((s) => typeof s.id === 'string' && ONENOTE_ID.test(s.id))
      .map(async (section) => {
        const res = await graphGet(
          `/me/onenote/sections/${section.id}/pages` +
            '?$select=id,title,lastModifiedDateTime&$top=100',
          token,
        );
        const pages = ((await res.json()) as { value?: OneNotePage[] }).value ?? [];
        return pages.map((p) => ({
          id: p.id,
          title: p.title ?? '(untitled)',
          section: section.displayName ?? null,
          notebook: section.parentNotebook?.displayName ?? null,
          last_modified: p.lastModifiedDateTime ?? null,
        }));
      }),
  );

  // Newest first, matching the order the single-call version happened to
  // return; pages with no timestamp sort last rather than jumping to the top.
  const notes = perSection
    .flat()
    .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''));

  return { notes };
};

export const readNote = async (
  token: string,
  noteId: unknown,
): Promise<{ title: string; text: string }> => {
  if (typeof noteId !== 'string' || !ONENOTE_ID.test(noteId)) {
    throw new GraphError('note_id is missing or malformed.', false);
  }
  // Encoded, and shape-checked above, so it can only ever be one path segment.
  const id = encodeURIComponent(noteId);

  const meta = await graphGet(`/me/onenote/pages/${id}?$select=title`, token);
  const { title } = (await meta.json()) as { title?: string };

  const content = await graphGet(`/me/onenote/pages/${id}/content`, token);

  return { title: title ?? '(untitled)', text: htmlToText(await content.text()) };
};
