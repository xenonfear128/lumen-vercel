import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
const remote = process.argv[2];
const server = remote ? null : await createServer({configFile:false,plugins:[react(),tailwindcss()],cacheDir:path.join(os.tmpdir(),'lumen-metadata-font-'+process.pid),server:{host:'127.0.0.1',port:5215,strictPort:true}});
await server?.listen();
const browser = await chromium.launch();
try {
 for(const lang of ['zh','en','ja']) {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.addInitScript(({lang})=>{
   localStorage.setItem('lumen.lang',lang);
   localStorage.setItem('lumen.library.v1',JSON.stringify({playlists:[{id:'font-fixture',kind:'netease',name:'Doomer | 俄罗斯后朋克',neteaseId:1,tracks:[]}]}));
  },{lang});
  await page.goto(remote || server.resolvedUrls.local[0]);
  await page.locator('h2').filter({hasText:'Doomer'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('h2').getAttribute('lang'),'zh-CN');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const {root}=await cdp.send('DOM.getDocument');
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'h2'});
  const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
  const systemFonts=fonts.filter(f=>!f.isCustomFont);
  assert.equal(systemFonts.length,1,JSON.stringify(fonts));
  assert.equal(systemFonts[0].glyphCount,6,JSON.stringify(fonts));
  assert(!systemFonts[0].familyName.includes('Yu Gothic'),JSON.stringify(fonts));
  console.log('PASS actual Chinese title glyphs',lang,JSON.stringify(fonts));
  if(lang==='ja') {await mkdir('test-results',{recursive:true});await page.locator('h2').screenshot({path:'test-results/metadata-title-ja.png'});}
  await page.close();
 }
} finally {await browser.close();await server?.close();}
