import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const html = await readFile(join(config.outputDirectory, 'index.html'), 'utf8');
const csp = config.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy').value;
for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const src = /\bsrc="([^"]+)"/.exec(attributes)?.[1];
  if (src) {
    assert(src.startsWith('/assets/'), 'Production scripts must use bundled assets');
    await access(join(config.outputDirectory, src));
  } else if (body.trim()) {
    const hash = createHash('sha256').update(body).digest('base64');
    assert(csp.includes(`'sha256-${hash}'`), 'Update the CSP bootstrap hash when changing the inline theme script');
  }
}
assert(!html.includes('http://127.0.0.1:3000'));
assert(!config.rewrites?.some(rule => rule.source === '/(.*)'), 'A blanket SPA rewrite would swallow API errors');
assert(config.rewrites?.some(rule => rule.source === '/api/:path*' && rule.destination === '/api/gateway'), 'Nested music API paths require an explicit Vercel rewrite');
console.log('PASS Vercel assets and Content-Security-Policy');
