/**
 * Which page in a section holds its tasks: the CL Aufgaben page.
 *
 * One rule, used by `list_notes` to name an update target, by `map_notes` in
 * tasks mode to choose what to read (0014), and by the hosted task view to
 * choose what to snapshot (0020). Exported so those cannot disagree about which
 * page is a project's task record — the same reason `pageTasks` is shared for
 * what a task on it is.
 */
import { sectionKey } from './notes.js';

/** The older, untemplated title. Still a target, named as due for conversion. */
export const LEGACY_UPDATE_TARGET = 'cl aufgaben';

/**
 * The templated shape is `CL Aufgaben — <project>`, and the live notebook names
 * them `CL Aufgaben — Montepulciano` and `CL Aufgaben — Melk BCW (Barocktage
 * 2027)`, so only the prefix up to the dash is fixed. A bare prefix match was
 * wrong: every `CL` page belongs to the tool, and `CL Aufgaben-Kategorien` in
 * `Projekt Kontext` is a reference page, which the prefix alone offered as the
 * place an update belongs.
 */
export const isUpdateTarget = (title: string): boolean => {
  const key = sectionKey(title);
  return key === LEGACY_UPDATE_TARGET || /^cl aufgaben [—–-] \S/.test(key);
};

type PageLike = { title: string; section: string | null; notebook?: string | null };
type SectionLike = { name: string; notebook: string | null };

/**
 * Per section: its one CL Aufgaben page, or the fact that it has none or
 * several. None and several read nothing — picking one of two would report one
 * project's tasks as the whole of them — and both are returned so a caller can
 * say so rather than show an empty project.
 *
 * Pages are matched to sections by name and notebook, as the listing reports
 * them, and computed from every page listed, so a capped answer cannot hide one.
 */
export const pickTaskPages = <P extends PageLike, S extends SectionLike>(
  sections: readonly S[],
  pages: readonly P[],
): { toRead: P[]; without: S[]; several: { sec: S; pages: P[] }[] } => {
  const inSection = (page: P, sec: S) =>
    page.section === sec.name && (page.notebook ?? null) === (sec.notebook ?? null);
  const toRead: P[] = [];
  const without: S[] = [];
  const several: { sec: S; pages: P[] }[] = [];
  for (const sec of sections) {
    const targets = pages.filter((p) => inSection(p, sec) && isUpdateTarget(p.title));
    if (targets.length === 1) toRead.push(targets[0]);
    else if (targets.length === 0) without.push(sec);
    else several.push({ sec, pages: targets });
  }
  return { toRead, without, several };
};
