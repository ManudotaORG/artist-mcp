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
  return impl(url, init);
};
