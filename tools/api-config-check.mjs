/** Verify the local API binding in both the dev app and the built single-file app. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createServer, preview } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const browser = await chromium.launch({headless:true});
let checks=0;
try {
  for (const production of [false,true]) {
    const server = production
      ? await preview({preview:{host:'127.0.0.1',port:5202}})
      : await createServer({server:{host:'127.0.0.1',port:5201}});
    if (!production) await server.listen();
    try {
      for (const lang of ['zh','en','ja']) {
        const context=await browser.newContext({viewport:{width:1280,height:720}});
        const cached={baseUrl:'https://legacy.invalid:4321',cookie:'test-cookie',level:'lossless',audioProxy:'http://127.0.0.1:5174'};
        await context.addInitScript(({lang,cached})=>{
          localStorage.setItem('lumen.lang',lang);
          localStorage.setItem('lumen.netease.v1',JSON.stringify(cached));
        },{lang,cached});
        const page=await context.newPage();
        const requests=[],errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/api/**',async route=>{
          requests.push(route.request());
          await route.fulfill({json:route.request().url().endsWith('/api/song/url/v1')
            ? {code:200,data:[{id:1,url:'http://m702.music.126.net/fixture.mp3'}]}
            : {code:200,data:{code:200,profile:null},result:{songs:[]}}});
        });
        let legacyRequests=0;
        await page.route('https://legacy.invalid:4321/**',route=>{legacyRequests++;return route.abort();});
        await page.goto(server.resolvedUrls.local[0]);
        await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
        const dialog=page.getByRole('dialog');
        await dialog.locator('input').fill('binding test');
        await Promise.all([
          page.waitForResponse(r=>new URL(r.url()).pathname==='/api/cloudsearch'),
          dialog.locator('input').press('Enter'),
        ]);
        await dialog.locator('.w-fit').first().getByRole('button').nth(2).click();
        assert.equal(await dialog.locator('input').count(),1,'Only the audio-proxy input remains');
        const text=await dialog.innerText();
        assert(!/API (地址|URL|アドレス)/.test(text),'API address setting must be absent in every language');
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('lumen.netease.v1')));
        const {baseUrl:discarded,...preferences}=cached;
        assert.deepEqual(saved,preferences,'Legacy URL is removed without losing user preferences');
        assert.equal(legacyRequests,0,'Legacy API origin must never be used');
        assert(requests.some(r=>new URL(r.url()).pathname==='/api/login/status'));
        assert(requests.some(r=>new URL(r.url()).pathname==='/api/cloudsearch'));
        assert(requests.every(r=>r.method()==='POST' && !new URL(r.url()).searchParams.has('cookie')));
        assert.deepEqual(errors,[]);
        if (!production) {
          const verified=await page.evaluate(async()=>{
            const api=await import('/src/lib/netease.ts');
            const cfg={...api.defaultConfig(),baseUrl:'https://legacy.invalid:4321'};
            api.saveConfig(cfg);
            await api.search(cfg,'injected config',1,0);
            const stripped=!('baseUrl' in JSON.parse(localStorage.getItem('lumen.netease.v1')));
            localStorage.setItem('lumen.netease.v1','null');
            const defaults=JSON.stringify(api.loadConfig())===JSON.stringify(api.defaultConfig());
            const urls=await api.songUrls(api.defaultConfig(),[1]);
            return {stripped,defaults,https:urls.get(1)==='https://m702.music.126.net/fixture.mp3'};
          });
          assert.deepEqual(verified,{stripped:true,defaults:true,https:true});
          assert.equal(legacyRequests,0,'Even an injected runtime config cannot select a different API origin');
        }
        await context.close(); checks++;
        console.log(`PASS ${production?'production':'development'} ${lang}`);
      }
    } finally {
      if (production) await new Promise((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));
      else await server.close();
    }
  }
} finally { await browser.close(); }
console.log(`Passed ${checks} API binding scenarios.`);
