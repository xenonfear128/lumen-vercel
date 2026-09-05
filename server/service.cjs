const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');
const { createApi, ROUTES } = require('./api.cjs');

function secureEqual(a, b) {
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw Object.assign(new Error('Request too large'), { status: 413 });
    parts.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(parts).toString('utf8')));
}

function createLumenServer({ distDir = join(__dirname, '..', 'dist'), api = createApi(), authUser = '', authPassword = '', desktopToken = '' } = {}) {
  if (Boolean(authUser) !== Boolean(authPassword)) throw new Error('Set both LUMEN_AUTH_USER and LUMEN_AUTH_PASSWORD');
  const html = readFileSync(join(distDir, 'index.html'));
  const scriptHashes = Array.from(html.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), match =>
    "'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'").join(' ');
  const csp = `default-src 'self'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https: http:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https: http:; media-src 'self' blob: https: http:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
  const expectedAuth = `Basic ${Buffer.from(`${authUser}:${authPassword}`).toString('base64')}`;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', csp);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok', service: 'lumen', version: require('../package.json').version });
      if (desktopToken && !secureEqual(req.headers['x-lumen-desktop'] || '', desktopToken)) return json(res, 403, { code: 403 });
      if (authUser && !secureEqual(req.headers.authorization || '', expectedAuth)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Lumen", charset="UTF-8"', 'Cache-Control': 'no-store' });
        return res.end('Authentication required');
      }
      if ((url.pathname === '/' || url.pathname === '/index.html') && ['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length, 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : html);
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (!url.pathname.startsWith('/api/') || !ROUTES[url.pathname.slice(4)]) return json(res, 404, { code: 404 });
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { code: 405 }); }
      const origin = req.headers.origin;
      if ((origin && new URL(origin).host !== req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { code: 403 });
      if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return json(res, 415, { code: 415 });
      const params = await readBody(req);
      const result = await api(url.pathname.slice(4), params);
      const status = Number.isInteger(result?.status) && result.status >= 200 && result.status < 600 ? result.status : 502;
      return json(res, status, result?.body || { code: 502 });
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { code: error.status || 500, msg: 'Request could not be completed' });
      else res.destroy();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
module.exports = { createLumenServer };
