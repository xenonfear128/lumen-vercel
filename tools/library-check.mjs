import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = process.argv[2] ? null : await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server?.listen();
const base = process.argv[2] || server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('lumen.lang', 'zh');
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.testAudio = this; return play.call(this); };
  });
  await context.route('**/api/**', route => route.fulfill({ json: {
    code: 200, data: route.request().url().endsWith('/song/url/v1') ? [{ id: 42, url: null }] : { code: 200, profile: null },
    result: { songs: [{ id: 42, name: 'Saved Online Song', ar: [], al: { name: '' }, dt: 10000 }], songCount: 1 },
  } }));
  let page = await context.newPage();
  await page.goto(base);
  await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill('saved');
  await dialog.locator('input').press('Enter');
  await dialog.locator('.group.grid').first().locator('button').last().click();
  await page.getByRole('heading', { name: 'Saved Online Song', exact: true }).waitFor();
  const wav = Buffer.alloc(44 + 8000 * 2 * 8);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await page.locator('.sidebar:visible input[type=file]:not([webkitdirectory])').setInputFiles({ name: 'Persistent Tone.wav', mimeType: 'audio/wav', buffer: wav });
  const row = () => page.locator('main li[data-id]').filter({ hasText: 'Persistent Tone' });
  await row().waitFor();
  await page.reload();
  await row().waitFor();
  assert.equal(await page.locator('main li[data-id]').count(), 2, 'Mixed temporary list survives refresh');
  await page.getByRole('heading', { name: 'Saved Online Song', exact: true }).waitFor();
  // The visible manifest is synchronous; allow restoration of local file bytes.
  await page.waitForTimeout(300);
  await row().locator('button').first().click();
  await page.waitForFunction(() => window.testAudio?.currentTime > 0.2 && !window.testAudio.paused);
  await page.close();
  page = await context.newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'Persistent Tone', exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.locator('.player-transport-main > button').nth(1).click();
  await page.waitForFunction(() => window.testAudio?.currentTime > 0.2);
  const bytes = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('lumen-library', 1);
    request.onsuccess = () => { const db = request.result; const files = db.transaction('files').objectStore('files').getAll(); files.onsuccess = () => { resolve(files.result[0].size); db.close(); }; };
    request.onerror = () => reject(request.error);
  }));
  assert.equal(bytes, wav.length, 'The original audio bytes survive closing the page');
  await row().locator('button').last().click();
  await page.reload();
  assert.equal(await page.locator('main li[data-id]').count(), 1, 'Deleted local track stays deleted');
  await page.waitForFunction(() => localStorage.getItem('lumen.library.removedFiles') === '[]');
  const count = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('lumen-library', 1);
    request.onsuccess = () => { const db = request.result; const count = db.transaction('files').objectStore('files').count(); count.onsuccess = () => { resolve(count.result); db.close(); }; };
    request.onerror = () => reject(request.error);
  }));
  assert.equal(count, 0, 'Deleting a track releases its persisted file');
  await context.close();
  console.log('PASS mixed playlist, selection, local bytes/playback, reopen and deletion persistence');
  const legacy = await browser.newPage();
  await legacy.addInitScript(() => localStorage.setItem('lumen.online.v1', JSON.stringify([{ id: 'legacy', name: 'Legacy List', kind: 'netease', neteaseId: 1, tracks: [] }])));
  await legacy.goto(base);
  await legacy.getByText('Legacy List', { exact: true }).first().waitFor();
  assert(await legacy.evaluate(() => JSON.parse(localStorage.getItem('lumen.library.v1')).playlists[0].id === 'legacy'));
  await legacy.close();
  console.log('PASS legacy online library migration');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await browser.close(); await server?.close(); }
