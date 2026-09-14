import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
console.log("Login test server ready");
const browser = await chromium.launch({ headless: true });
console.log("Login test browser ready");
try {
  for (const scenario of ['success', 'failures', 'stale']) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('lumen.lang', 'zh');
      const Original = window.Audio;
      window.Audio = function (...args) { const audio = new Original(...args); window.testAudio = audio; return audio; };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let polls = 0, keyCount = 0, releaseOld;
    let loggedIn = false;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const params = new URLSearchParams(route.request().postData());
      let json = { code: 200 };
      if (path.endsWith('/login/status')) {
        loggedIn ||= params.get('cookie') === 'MUSIC_U=fixture';
        json = { data: { code: 200, profile: loggedIn ? { nickname: 'Regression User', userId: 42 } : null } };
      } else if (path.endsWith('/qr/key')) json = { code: 200, data: { unikey: String(++keyCount) } };
      else if (path.endsWith('/qr/create')) json = { code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' } };
      else if (path.endsWith('/qr/check')) {
        polls++;
        if (scenario === 'stale' && params.get('key') === '1') {
          await new Promise(resolve => { releaseOld = resolve; });
          json = { code: 803, cookie: 'MUSIC_U=stale' };
        } else if (scenario === 'failures' || polls === 1) {
          await route.fulfill({ status: 502, json: { code: 502 } }); return;
        } else json = scenario === 'stale' ? { code: 801 } : { code: 803, cookie: 'MUSIC_U=fixture' };
      }
      await route.fulfill({ json });
    });
    console.log(`Starting ${scenario}`);
    await page.goto(server.resolvedUrls.local[0]);
    if (scenario === 'success') {
      const validation = await page.evaluate(async () => {
        const api = await import('/src/lib/netease.ts');
        const original = window.fetch;
        let rejected = 0;
        try {
          for (const body of [{ code: 803, cookie: '' }, { code: 502 }, {}]) {
            window.fetch = async () => new Response(JSON.stringify(body));
            try { await api.loginQrCheck(api.defaultConfig(), 'fixture'); } catch { rejected++; }
          }
          window.fetch = async () => new Response(JSON.stringify({ data: { code: 502 } }));
          try { await api.loginStatus(api.defaultConfig()); } catch { rejected++; }
        } finally { window.fetch = original; }
        return rejected;
      });
      assert.equal(validation, 4, 'Malformed credentials and service errors must remain errors');
    }
    await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.w-fit').first().getByRole('button').nth(2).click();
    await dialog.getByRole('button', { name: '扫描二维码登录', exact: true }).click();
    // Exercise parent renders faster than the polling interval, as during playback.
    await page.evaluate(() => { window.tick = setInterval(() => { window.testAudio.currentTime += 0.1; window.testAudio.dispatchEvent(new Event('timeupdate')); }, 100); });
    if (scenario === 'success') {
      await dialog.getByText('Regression User', { exact: true }).waitFor({ timeout: 12000 });
      assert(loggedIn, 'Status request must carry the NEW cookie');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lumen.netease.v1')).cookie), 'MUSIC_U=fixture');
      await page.reload();
      await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
      await dialog.locator('.w-fit').first().getByRole('button').nth(2).click();
      await dialog.getByText('Regression User', { exact: true }).waitFor();
    } else if (scenario === 'failures') {
      await dialog.getByRole('alert').waitFor({ timeout: 25000 });
      assert.equal(polls, 8);
      await page.waitForTimeout(2300);
      assert.equal(polls, 8, 'Polling stops at the retry budget');
    } else {
      while (!releaseOld) await page.waitForTimeout(20);
      await dialog.getByRole('button', { name: '刷新二维码', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('img[alt="扫描二维码登录"]'));
      releaseOld();
      await page.waitForTimeout(500);
      assert.notEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('lumen.netease.v1')).cookie), 'MUSIC_U=stale');
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS QR browser ${scenario}`);
  }
  for (const mode of ['list', 'empty', 'error']) {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('lumen.lang', 'zh'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/login/status')) {
        await route.fulfill({ json: { data: { code: 200, profile: { nickname: 'Regression User', userId: 42 } } } });
      } else if (path.endsWith('/user/playlist')) {
        if (mode === 'error') { await route.fulfill({ status: 502, json: { code: 502 } }); return; }
        await route.fulfill({ json: { code: 200, playlist: mode === 'list' ? [{ id: 1, name: '我的收藏', trackCount: 3 }] : [] } });
      } else {
        await route.fulfill({ json: { code: 200, data: { code: 200 } } });
      }
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.w-fit').first().getByRole('button').nth(1).click();
    // Auto-load must populate the playlists section without any manual click.
    if (mode === 'list') {
      await dialog.getByText('我的收藏', { exact: true }).waitFor({ timeout: 12000 });
    } else if (mode === 'empty') {
      await dialog.getByText('暂无歌单', { exact: true }).waitFor({ timeout: 12000 });
    } else {
      await dialog.getByText('读取歌单失败', { exact: true }).waitFor({ timeout: 12000 });
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS my playlists ${mode}`);
  }
  for (const unavailable of [false, true]) {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('lumen.lang', 'zh'));
    const page = await context.newPage();
    let resolutions = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/song/url/v1')) {
        resolutions++;
        await route.fulfill({ status: unavailable ? 200 : 502, json: unavailable ? { code: 200, data: [{ id: 42, url: null, code: 404 }] } : { code: 502 } });
      } else await route.fulfill({ json: { code: 200, data: { code: 200, profile: null }, result: { songs: [{ id: 42, name: 'Fixture Song', ar: [], al: { name: '' }, dt: 10000 }], songCount: 1 } } });
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('.sidebar:visible').waitFor();
    await page.evaluate(async () => {
      const { setSiteSession } = await import('/src/lib/siteApi.ts');
      setSiteSession({ configured: true, initialized: true, user: { id: 'test', username: 'test', role: 'user' }, csrf: 'test' });
    });
    await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').fill('fixture');
    await dialog.locator('input').press('Enter');
    await dialog.locator('.group.grid').first().locator('button').last().click();
    await page.getByText(unavailable ? '无可用音源: Fixture Song' : '音源服务暂时不可用，请稍后重试: Fixture Song', { exact: true }).waitFor();
    assert.equal(resolutions, 1, 'Errors must not cause an endless skip loop');
    await context.close();
    console.log(`PASS audio error ${unavailable ? 'unavailable' : 'service'}`);
  }
  {
    const page = await browser.newPage();
    let release;
    await page.route('**/api/song/url/v1', async route => {
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: { code: 200, data: [{ id: 42, url: 'https://example.invalid/audio.mp3' }] } });
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.evaluate(async () => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { usePlayer } = await import('/src/hooks/usePlayer.ts');
      const { setSiteSession } = await import('/src/lib/siteApi.ts');
      setSiteSession({ configured: true, initialized: true, user: { id: 'test', username: 'test', role: 'user' }, csrf: 'test' });
      const { songToTrack } = await import('/src/lib/netease.ts');
      window.fixtureTrack = songToTrack({ id: 42, name: 'Pending', ar: [], al: { name: '' }, dt: 10000 });
      const element = document.createElement('div'); document.body.append(element);
      createRoot(element).render(React.createElement(function Harness() { window.testPlayer = usePlayer(); return null; }));
    });
    await page.waitForFunction(() => window.testPlayer);
    await page.evaluate(() => window.testPlayer.addNeteasePlaylist({ id: 'pending', kind: 'netease', name: 'Pending', neteaseId: 42, tracks: [window.fixtureTrack] }));
    await page.waitForFunction(() => window.testPlayer.playlists.length === 1);
    await page.evaluate(() => window.testPlayer.playOnlineTrack(window.fixtureTrack, 'pending'));
    while (!release) await page.waitForTimeout(20);
    await page.evaluate(() => window.testPlayer.removePlaylist('pending'));
    release();
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => window.testPlayer.current === null && !window.testPlayer.resolving && !window.testPlayer.engine.audio.getAttribute('src')),
      'Deleting a loading playlist must invalidate its pending URL response');
    await page.close();
    console.log('PASS deleting a pending playlist');
  }
} catch (error) { console.error(error); process.exitCode = 1; } finally { await browser.close(); await server.close(); }
