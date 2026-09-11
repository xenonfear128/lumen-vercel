import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';
import handler from '../api/gateway.js';

const config=JSON.parse(await readFile('vercel.json','utf8'));
const server=await preview({mode:'vercel',preview:{host:'127.0.0.1',port:0},plugins:[{
  name:'vercel-local-check',
  configurePreviewServer(server) {
    server.middlewares.use((req,res,next)=>{
      for(const header of config.headers[0].headers) res.setHeader(header.key,header.value);
      if(req.url.startsWith('/api/')) return handler(req,res);
      next();
    });
  },
}]});
const base=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({headless:true});
try {
  for(const lang of ['zh','en','ja']) {
    const context=await browser.newContext({viewport:{width:1280,height:720}});
    await context.addInitScript(lang=>localStorage.setItem('lumen.lang',lang),lang);
    const page=await context.newPage();
    const errors=[],failed=[],violations=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('requestfailed',req=>failed.push(req.url()));
    await page.exposeFunction('recordCspViolation',value=>violations.push(value));
    await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.recordCspViolation(`${e.violatedDirective}: ${e.blockedURI}`)));
    // Stable UI fixtures; the real deployed entrypoint is exercised separately below.
    await page.route('**/api/login/status',route=>route.fulfill({json:{code:200,data:{profile:null}}}));
    await page.route('**/api/cloudsearch',route=>route.fulfill({json:{code:200,result:{songs:[]}}}));
    const coverRequests=[];
    await page.route('**://cdn.lumen-test.invalid/cover.png',route=>{
      coverRequests.push(route.request().url());
      return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
    });
    await page.goto(base);
    // Old saved playlists and upstream metadata may still contain HTTP covers.
    await page.evaluate(()=>new Promise((resolve,reject)=>{
      const cover=new Image();
      cover.onload=()=>resolve(true);cover.onerror=()=>reject(new Error('HTTP cover was not upgraded'));
      cover.src='http://cdn.lumen-test.invalid/cover.png';
    }));
    assert.deepEqual(coverRequests,['https://cdn.lumen-test.invalid/cover.png']);
    await page.locator('.sidebar:visible .sidebar-actions button').nth(2).click();
    const dialog=page.getByRole('dialog');
    await dialog.locator('input').fill('Vercel test');
    await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/cloudsearch')),dialog.locator('input').press('Enter')]);
    await dialog.locator('.w-fit').first().getByRole('button').nth(2).click();
    assert.equal(await dialog.locator('input').count(),1,'API address must remain hidden');
    await page.keyboard.press('Escape');

    const wav=Buffer.alloc(44+8000*2*2);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
    wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
    wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    await page.locator('.sidebar:visible input[type=file]:not([webkitdirectory])').setInputFiles({name:'vercel-local.wav',mimeType:'audio/wav',buffer:wav});
    await page.getByText('vercel-local',{exact:true}).first().waitFor();
    await page.locator('.player-transport-main > button').nth(1).click();
    await page.waitForFunction(()=>navigator.mediaSession.metadata?.title==='vercel-local');
    const localApi=await page.evaluate(async()=>{
      const health=await fetch('/api/healthz').then(r=>r.json());
      const qr=await fetch('/api/login/qr/create',{method:'POST',body:new URLSearchParams({key:'browser-check',qrimg:'1'})}).then(r=>r.json());
      const unknown=await fetch('/api/unknown',{method:'POST'});
      return {health:health.status,qr:qr.data.qrimg.startsWith('data:image/png;base64,'),unknown:unknown.status};
    });
    assert.deepEqual(localApi,{health:'ok',qr:true,unknown:404});
    await page.evaluate(()=>document.fonts.ready);
    assert.deepEqual(errors,[],'Browser runtime errors');
    assert.deepEqual(violations,[],'Content security policy violations');
    assert.deepEqual(failed,[],'Failed asset requests');
    await mkdir('test-results',{recursive:true});
    await page.screenshot({path:`test-results/vercel-${lang}.png`,fullPage:true});
    await context.close();
    console.log(`PASS Vercel browser ${lang}: static assets, API, CSP, HTTPS covers and local WAV playback`);
  }
} finally {
  await browser.close();
  server.httpServer.closeAllConnections();
  await new Promise(resolve=>server.httpServer.close(resolve));
}
