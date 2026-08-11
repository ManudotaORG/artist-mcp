import { pathToFileURL } from 'node:url';

const TELEGRAM_LIMIT = 3900;
const RELEASES_URL = 'https://github.com/ManudotaORG/artist-mcp/releases';

const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const cleanLine = (value) =>
  value
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*\([a-f0-9]{7,40}\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeSubject = (value) =>
  cleanLine(value)
    .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s*\(#\d+\)\s*$/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();

const parseReleaseBody = (body) => {
  const trimmed = body.trim();
  if (!trimmed || /release notes (?:were|are) too long/i.test(trimmed)) {
    throw new Error('Release notes are empty or contain an overflow placeholder.');
  }

  const entries = [];
  let section = 'Changes';
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) {
      section = cleanLine(heading[1]);
      continue;
    }
    if (!/^[-*+]\s+/.test(line) && !/^\d+[.)]\s+/.test(line)) {
      continue;
    }
    const text = cleanLine(line);
    if (text) {
      entries.push({ section, text });
    }
  }

  if (entries.length === 0) {
    entries.push({ section: 'Changes', text: cleanLine(trimmed) });
  }

  const deduped = new Map();
  for (const entry of entries) {
    const key = normalizeSubject(entry.text);
    if (key && !deduped.has(key)) {
      deduped.set(key, entry);
    }
  }
  return [...deduped.values()];
};

const sectionIcon = (section) => {
  const value = section.toLowerCase();
  if (value.includes('fix')) return '🛠';
  if (value.includes('security')) return '🔒';
  if (value.includes('document')) return '📚';
  if (value.includes('feature')) return '✨';
  return '•';
};

const splitSection = (section, maximumLength) => {
  const lines = section.split('\n');
  const chunks = [];
  let chunk = lines.shift() ?? '';
  for (const line of lines) {
    if (`${chunk}\n${line}`.length > maximumLength && chunk) {
      chunks.push(chunk);
      chunk = line;
    } else {
      chunk = `${chunk}\n${line}`;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
};

const paginate = (header, sections, footer) => {
  const pages = [];
  let page = header;
  const maximumSectionLength = TELEGRAM_LIMIT - header.length - footer.length - 4;
  const chunks = sections.flatMap((section) => splitSection(section, maximumSectionLength));
  for (const section of chunks) {
    const candidate = `${page}\n\n${section}`;
    if (`${candidate}\n\n${footer}`.length > TELEGRAM_LIMIT && page !== header) {
      pages.push(page);
      page = `${header}\n\n${section}`;
    } else {
      page = candidate;
    }
  }
  pages.push(`${page}\n\n${footer}`);
  return pages;
};

const formatReleaseNotes = ({ title, body, url = RELEASES_URL }) => {
  const entries = parseReleaseBody(body);
  const grouped = new Map();
  for (const entry of entries) {
    const group = grouped.get(entry.section) ?? [];
    group.push(entry.text);
    grouped.set(entry.section, group);
  }

  const sections = [...grouped].map(
    ([section, items]) =>
      `${sectionIcon(section)} <b>${escapeHtml(section)}</b>\n${items
        .map((item) => `• ${escapeHtml(item)}`)
        .join('\n')}`,
  );
  const displayTitle = title.replace(/^artist-mcp:\s*/i, '');
  const header = `🎼 <b>artist-mcp ${escapeHtml(displayTitle)}</b>`;
  const footer = `<a href="${escapeHtml(url)}">View release</a>`;
  return paginate(header, sections, footer);
};

const run = () => {
  const [title, body, url] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(formatReleaseNotes({ title, body, url })));
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}

export { formatReleaseNotes, normalizeSubject, parseReleaseBody };
