const { createApi, ROUTES } = require('./api.cjs');
const { createManaged } = require('./managed.cjs');

const BODY_LIMIT = 64 * 1024;

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function fail(status) {
  throw Object.assign(new Error('Invalid request'), { status });
}

async function readForm(req) {
  const length = Number(req.headers['content-length']);
  if (length > BODY_LIMIT) fail(413);

  // Vercel may already have consumed and parsed the request stream.
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > BODY_LIMIT) fail(413);
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    if (Buffer.byteLength(body) > BODY_LIMIT) fail(413);
    return Object.fromEntries(new URLSearchParams(body.toString()));
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400);
  if (Object.values(body).some(value => typeof value !== 'string')) fail(400);
  if (Buffer.byteLength(new URLSearchParams(body).toString()) > BODY_LIMIT) fail(413);
  return Object.fromEntries(Object.entries(body));
}

function createApiHandler({ api, apiFactory = createApi, managed } = {}) {
  // One SDK instance per warm function; user cookies remain request-local.
  let musicApi = api;
  const accounts = managed || createManaged({ api: (path, params) => { musicApi ||= apiFactory(); return musicApi(path, params); } });
  return async (req, res) => {
    try {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { fail(400); }
      if (url.pathname === '/api/healthz' && req.method === 'GET') {
        return json(res, 200, { status: 'ok', service: 'lumen', version: require('../package.json').version });
      }
      if (await accounts.handle(req, res, url.pathname)) return;
      const pathname = url.pathname.slice(4);
      if (!url.pathname.startsWith('/api/') || !Object.hasOwn(ROUTES, pathname)) {
        return json(res, 404, { code: 404 });
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { code: 405 });
      }
      const origin = req.headers.origin;
      if (origin) {
        let originUrl;
        try { originUrl = new URL(origin); } catch { fail(403); }
        if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.host !== req.headers.host) fail(403);
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') fail(403);
      const contentType = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/x-www-form-urlencoded') fail(415);
      const params = await readForm(req);
      let result;
      if (pathname === '/song/url/v1') result = { status: 200, body: await accounts.playback(req, params) };
      else { musicApi ||= apiFactory(); result = await musicApi(pathname, params); }
      const status = Number.isInteger(result?.status) && result.status >= 200 && result.status < 600 ? result.status : 502;
      return json(res, status, result?.body || { code: 502 });
    } catch (error) {
      const status = [400, 401, 403, 409, 413, 415, 429, 502, 503].includes(error.status) ? error.status : 500;
      if (!res.headersSent) json(res, status, { code: status, ...(error.status && { error: error.code }), msg: 'Request could not be completed' });
      else res.destroy();
    }
  };
}

module.exports = { createApiHandler };
