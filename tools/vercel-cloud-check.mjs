import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'https://lumen-vercel-neon.vercel.app').origin;
const outputDir = process.env.TEST_RESULTS_DIR || 'test-results';
assert(base.startsWith('https://'), 'Check the actual HTTPS deployment');
const checks = [];
const accessHeaders = process.env.LUMEN_PREVIEW_ACCESS
  ? { 'x-vercel-protection-bypass': process.env.LUMEN_PREVIEW_ACCESS } : {};
async function api(path, params) {
  const response = await fetch(base + path, {
    headers: accessHeaders,
    ...(params ? { method: 'POST', body: new URLSearchParams(params) } : {}),
    signal: AbortSignal.timeout(40000),
  });
  assert.equal(response.status, 200, `${path} HTTP status`);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  checks.push(path);
  return response.json();
}
assert.equal((await api('/api/healthz')).status, 'ok');
assert.equal((await api('/api/login/status', {})).data.profile, null);
const search = await api('/api/cloudsearch', { keywords: '纯音乐', limit: '3', type: '1' });
assert(search.result.songs.length > 0, 'Real search must return songs');
const ids = search.result.songs.map(song => song.id).join(',');
assert((await api('/api/song/detail', { ids })).songs.length > 0);
const urls = await api('/api/song/url/v1', { id: ids, level: 'standard' });
assert.equal(urls.code, 200);
assert(urls.data.some(song => typeof song.url === 'string'), 'At least one sample must have a playable URL');
const playableId = urls.data.find(song => typeof song.url === 'string').id;
const playableSong = search.result.songs.find(song => song.id === playableId);
const key = await api('/api/login/qr/key', {});
assert.equal(typeof key.data.unikey, 'string');
const qr = await api('/api/login/qr/create', { key: key.data.unikey, qrimg: '1' });
assert.match(qr.data.qrimg, /^data:image\/png;base64,/);
const unknown = await fetch(`${base}/api/unknown?path=login/status`, { method: 'POST', headers: accessHeaders });
assert.equal(unknown.status, 404);
assert.equal((await unknown.json()).code, 404);
const denied = await fetch(`${base}/api/logout`, {
  method: 'POST', headers: { ...accessHeaders, Origin: 'https://unrelated.example' }, body: new URLSearchParams(),
});
assert.equal(denied.status, 403);
console.log('PASS cloud API: search, details, playable URLs, QR key/image, login status and request isolation');

const browser = await chromium.launch({ headless: true });
try {
  await mkdir(outputDir, { recursive: true });
  for (const lang of ['zh', 'en', 'ja']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    // Never forward a preview access credential to external music/CDN hosts.
    if (process.env.LUMEN_PREVIEW_ACCESS) await context.route(`${base}/**`, route =>
      route.continue({ headers: { ...route.request().headers(), ...accessHeaders } }));
    await context.addInitScript(lang => localStorage.setItem('lumen.lang', lang), lang);
    await context.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { window.__lumenMedia = this; return play.call(this); };
    });
    const page = await context.newPage();
    const errors = [], violations = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('recordCspViolation', value => violations.push(value));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.recordCspViolation(e.violatedDirective)));
    await page.goto(base);
    await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').fill('纯音乐');
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/cloudsearch'), { timeout: 40000 }),
      dialog.locator('input').press('Enter'),
    ]);
    assert.equal(response.status(), 200);
    const results = await response.json();
    await dialog.getByText(results.result.songs[0].name, { exact: true }).first().waitFor();
    await dialog.locator('.w-fit').first().getByRole('button').nth(2).click();
    assert.equal(await dialog.locator('input').count(), 1, 'Only the optional audio proxy remains visible');
    if (lang === 'zh') {
      await dialog.locator('.w-fit').first().getByRole('button').first().click();
      await dialog.locator('.group.grid').filter({ has: page.getByText(playableSong.name, { exact: true }) }).first().locator('button').last().click();
      await page.waitForFunction(() => window.__lumenMedia?.currentTime > 0.2 && !window.__lumenMedia.paused, { timeout: 40000 });
      await page.locator('.player-transport-main > button').nth(1).click();
      console.log('PASS cloud online playback: real CDN audio advances through the player');
    }
    await page.addInitScript(() => { localStorage.removeItem("lumen.library.v1"); localStorage.removeItem("lumen.online.v1"); });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const wav = Buffer.alloc(44 + 8000 * 2 * 4);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    await page.locator('.sidebar:visible input[type=file]:not([webkitdirectory])').setInputFiles({ name: 'Lumen cloud check.wav', mimeType: 'audio/wav', buffer: wav });
    await page.getByText('Lumen cloud check', { exact: true }).first().waitFor();
    await page.locator('.player-transport-main > button').nth(1).click();
    await page.waitForFunction(() => navigator.mediaSession.metadata?.title === 'Lumen cloud check');
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(errors, []);
    assert.deepEqual(violations, []);
    await page.screenshot({ path: `${outputDir}/cloud-${lang}.png`, fullPage: true });
    await context.close();
    console.log(`PASS cloud browser ${lang}: real search, hidden API address, local WAV playback and CSP`);
  }
} finally { await browser.close(); }
await writeFile(`${outputDir}/vercel-cloud.json`, JSON.stringify({ url: base, verifiedAt: new Date().toISOString(), api: checks, languages: ['zh', 'en', 'ja'] }, null, 2));
