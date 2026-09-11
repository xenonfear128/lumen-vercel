/** Real-browser layout regression. See README for Playwright setup. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 5200 } });
await server.listen();
const baseURL = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true });
const output = new URL('../test-results/layout/', import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
let completed = false;
const long = '非常に長い曲名とアーティスト名VeryLongUnbrokenMetadata'.repeat(8);
const song = { id: 1, name: long, ar: [{ id: 1, name: long }], al: { id: 1, name: long }, dt: 360000 };
const track = { id: 'layout-track', source: 'netease', file: null, neteaseId: 1, path: '', fileName: long,
  title: long, artist: long, album: long, year: 2026, genre: long, duration: 360, codec: 'FLAC',
  bitrate: 1411200, sampleRate: 44100, coverUrl: null, fallbackCover: 0, metaLoaded: true };
const fixtures = {
  'lumen.library.v1': { playlists: [{ id: 'layout-playlist', kind: 'netease', name: long, neteaseId: 1, tracks: [track] }] },
  'lumen.stats.v1': { totalMs: 360000000000, days: {}, tracks: {
    fixture: { key: 'fixture', title: long, artist: long, ms: 360000000000, plays: 123456789, lastPlayed: Date.now() },
  }, artists: { [long]: 360000000000 } },
};
const viewports = [[320,568], [375,667], [640,360], [768,600], [1024,640], [1279,720], [1280,720], [1536,824], [2048,1112]];

async function check(page, label) {
  const problems = await page.evaluate(() => {
    const errors = [];
    const visible = e => e.getClientRects().length && e.getBoundingClientRect().width > 0;
    const describe = e => `${e.tagName}.${String(e.className).slice(0,65)} ${(e.textContent || '').trim().slice(0,30)}`;
    for (const e of document.querySelectorAll('body *')) {
      if (!(e instanceof HTMLElement) || !visible(e)) continue;
      const s = getComputedStyle(e);
      // Truncated metadata and explicitly scrollable containers are intentional.
      if (e.tagName !== 'INPUT' && s.overflowX === 'visible' && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2) {
        errors.push(`horizontal overflow (${e.scrollWidth}/${e.clientWidth}): ${describe(e)}`);
      }
    }
    for (const b of document.querySelectorAll('button')) {
      if (!visible(b)) continue;
      const rect = b.getBoundingClientRect();
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim() || walker.currentNode.parentElement.closest('.truncate')) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const r of range.getClientRects()) {
          if (r.left < rect.left - 1 || r.right > rect.right + 1 || r.top < rect.top - 1 || r.bottom > rect.bottom + 1)
            errors.push(`button text outside bounds: ${describe(b)}`);
        }
      }
      for (const icon of b.querySelectorAll('svg')) {
        const r = icon.getBoundingClientRect();
        if (r.width < 8 || r.left < rect.left - 1 || r.right > rect.right + 1)
          errors.push(`squeezed icon: ${describe(b)}`);
      }
      // Controls must remain in normal flow unless they intentionally overlay a cover/list row.
      for (const other of b.parentElement.querySelectorAll(':scope > button')) {
        if (other === b || !visible(other) || b.classList.contains('btn-overlay') || other.classList.contains('btn-overlay')) continue;
        const r = other.getBoundingClientRect();
        if (Math.min(r.right,rect.right)-Math.max(r.left,rect.left)>2 && Math.min(r.bottom,rect.bottom)-Math.max(r.top,rect.top)>2)
          errors.push(`overlapping buttons: ${describe(b)}`);
      }
    }
    for (const e of document.querySelectorAll('main, body > #root > div > header, nav, [role="dialog"] > .glass-strong')) {
      if (!visible(e)) continue;
      const r=e.getBoundingClientRect();
      if (r.left < -1 || r.right > innerWidth+1 || r.top < -1 || r.bottom > innerHeight+1)
        errors.push(`outside viewport: ${describe(e)}`);
    }
    const cover=document.querySelector('.player-art .aspect-square');
    if (cover && visible(cover.parentElement)) {
      const r=cover.getBoundingClientRect();
      if(r.width < 100 || r.height < 100) errors.push(`collapsed album cover: ${r.width}x${r.height}`);
    }
    return [...new Set(errors)];
  });
  assert.deepEqual(problems, [], `${label}\n${problems.join('\n')}`);
  results.push(label);
}
async function showSidebar(page) {
  if (!(await page.locator('.sidebar:visible').count())) await page.locator('nav button').first().click();
  return page.locator('.sidebar:visible');
}
async function closeModal(page) { await page.locator('[role="dialog"] > .glass-strong > div').first().getByRole('button').click(); }

try {
  for (const lang of ['zh','en','ja']) {
    for (const [width,height] of viewports) {
      const context = await browser.newContext({ viewport: { width,height } });
      await context.addInitScript(({lang}) => {
        localStorage.setItem('lumen.lang',lang); localStorage.setItem('lumen.theme','dark');
      }, {lang});
      const page=await context.newPage();
      const runtimeErrors=[]; page.on('pageerror',e=>runtimeErrors.push(e.message));
      await page.route('**/api/**',route=>{
        const path=new URL(route.request().url()).pathname.slice(4);
        const json = path==='/cloudsearch' ? {code:200,result:{songs:[song,{...song,id:2}],songCount:2}}
          : path==='/login/status' ? {code:200,data:{code:200,profile:{nickname:long,userId:1}}}
          : {code:200,data:[]};
        return route.fulfill({json});
      });
      await page.goto(baseURL);
      await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}button{transform:none!important}'});
      const prefix=`${lang} ${width}x${height}`;
      await check(page,`${prefix} empty player`);
      await page.evaluate(()=>document.documentElement.classList.remove('dark'));
      await check(page,`${prefix} light theme`);
      await page.evaluate(()=>document.documentElement.classList.add('dark'));
      // Every transport / mode control must be reachable in a short scrolling pane.
      const modeLast=page.locator('.now-playing button').last();
      await modeLast.scrollIntoViewIfNeeded();
      const modeBox=await modeLast.boundingBox();
      assert(modeBox.y+modeBox.height<=height, `${prefix}: unreachable player control`);
      await showSidebar(page);
      await check(page,`${prefix} empty sidebar`);
      const sidebar=page.locator('.sidebar:visible');
      await sidebar.locator('.sidebar-actions button').nth(3).click();
      await check(page,`${prefix} equalizer`);
      const bands=page.locator('[role="dialog"] .overflow-x-auto');
      await bands.evaluate(e=>{e.scrollLeft=e.scrollWidth;});
      assert(await bands.locator('input').last().isVisible());
      await closeModal(page);
      await sidebar.locator('.sidebar-actions button').nth(4).click();
      await check(page,`${prefix} empty stats`); await closeModal(page);
      await sidebar.locator('.sidebar-actions button').nth(2).click();
      await page.locator('[role="dialog"] input').fill('layout');
      await page.locator('[role="dialog"] input').press('Enter');
      await page.locator('[role="dialog"] .group').first().waitFor();
      await check(page,`${prefix} online results`);
      const tabs=page.locator('[role="dialog"] .w-fit').first().getByRole('button');
      await tabs.nth(1).click(); await check(page,`${prefix} online import`);
      await tabs.nth(2).click(); await check(page,`${prefix} online account`);
      await closeModal(page);

      await page.addInitScript(fixtures=>{for(const [key,value] of Object.entries(fixtures))localStorage.setItem(key,JSON.stringify(value));},fixtures);
      await page.reload();
      await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}button{transform:none!important}'});
      await showSidebar(page);
      await page.locator('.sidebar:visible li > button').first().click();
      if (width>=768 && width<1280) await page.locator('nav button').last().click();
      await check(page,`${prefix} long playlist and tracks`);
      await page.locator('main li[data-id] button').first().click();
      if (width<1280) await page.locator('nav button').filter({has:page.locator('svg.rotate-90')}).click();
      for (const mode of ['off','bars','wave','ring']) {
        const index=['off','bars','wave','ring'].indexOf(mode);
        await page.locator('.now-playing > div').last().locator('div').last().getByRole('button').nth(index).click();
        await check(page,`${prefix} long metadata and ${mode}`);
      }
      if (width<1280) await page.locator('nav button').last().click();
      const search=page.locator('main section header input:visible');
      await search.fill('VeryLong'); await check(page,`${prefix} search with clear button`);
      await showSidebar(page);
      await page.locator('.sidebar:visible .sidebar-actions button').nth(4).click();
      await check(page,`${prefix} populated stats`); await closeModal(page);
      if (width===1536) {
        await page.screenshot({path:new URL(`${lang}-desktop.png`,output).pathname.replace(/^\/(.:)/,'$1')});
      }
      assert.deepEqual(runtimeErrors,[],`${prefix}: browser errors`);
      await context.close();
      console.log(`PASS ${prefix}`);
    }
  }
  completed = true;
} finally {
  await writeFile(new URL('report.json',output),JSON.stringify({passed:completed,checks:results.length,results},null,2));
  await browser.close(); await server.close();
}
console.log(`Passed ${results.length} layout checks.`);


