/**
 * Let a per-URL fetch stub answer Graph `$batch` requests.
 *
 * Section listings and page previews go out as `$batch` POSTs (see
 * `graphBatchGet`), while every stub in this suite answers one URL at a time.
 * This unpacks a batch into the individual GETs it carries, asks the stub for
 * each, and packs the answers back the way Graph does — so a stub keeps
 * describing what OneNote holds, and does not have to know how it was asked.
 *
 * Each inner request reaches the stub as a GET for its full URL, which also
 * keeps tests that count or inspect requested URLs meaningful.
 */
export const withGraphBatch = (impl) => async (url, init = {}) => {
  const path = String(url);
  if ((init.method ?? 'GET').toUpperCase() === 'POST' && path.endsWith('/$batch')) {
    const { requests } = JSON.parse(init.body);
    const responses = await Promise.all(
      requests.map(async (r) => {
        const res = await impl(`https://graph.microsoft.com/v1.0${r.url}`, { method: 'GET' });
        const text = await res.text();
        let body;
        try {
          body = text === '' ? undefined : JSON.parse(text);
        } catch {
          body = text;
        }
        const headers = {};
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter !== null) headers['Retry-After'] = retryAfter;
        return { id: r.id, status: res.status, headers, body };
      }),
    );
    return new Response(JSON.stringify({ responses }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const res = await impl(url, init);
  if (res.status === 404 && /\/me\/onenote\/notebooks\?/.test(path)) return notebooksFromSections(impl);
  return res;
};

/**
 * A stub that describes only sections still answers the notebook listing.
 *
 * Since 0016 the notebook_key comes from `/me/onenote/notebooks`, which every
 * notebook question now asks alongside the sections. Most stubs here predate
 * that and describe an account by its sections alone, so a notebook listing
 * they do not answer is derived from those sections: each parent notebook, once.
 * A stub that answers the notebook listing itself, as the 0016 tests do to give
 * an account an empty notebook, is used as it is.
 */
/** On the URL of the request this helper makes itself, never on one the code makes. */
export const DERIVED = '#derived-notebook-listing';

const notebooksFromSections = async (impl) => {
  const res = await impl(
    // Marked, so a test counting the requests the code made can leave this one out.
    `https://graph.microsoft.com/v1.0/me/onenote/sections?$select=id,displayName,lastModifiedDateTime&$top=100${DERIVED}`,
    { method: 'GET' },
  );
  const { value = [] } = res.ok ? await res.json() : {};
  const names = [...new Set(value.map((s) => s.parentNotebook?.displayName ?? '(unnamed notebook)'))];
  return new Response(
    JSON.stringify({ value: names.map((displayName, i) => ({ id: `nb-${i}`, displayName })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
