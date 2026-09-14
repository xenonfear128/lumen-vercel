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
 for(const [width,height] of [[320,568],[393,668],[430,780]]) {
  const page=await browser.newPage({viewport:{width,height}});
  await page.addInitScript(()=>{
   localStorage.setItem('lumen.lang','zh');localStorage.setItem('lumen.viz','off');
   localStorage.setItem('lumen.library.v1',JSON.stringify({viewPlaylistId:'p',queuePlaylistId:'p',currentId:'t',playlists:[{id:'p',kind:'netease',name:'Music',tracks:[{id:'t',source:'netease',neteaseId:1,fileName:'Momentum',title:'Momentum',artist:'Zackow, MAXPVNK',album:'Momentum',duration:148,fallbackCover:0,metaLoaded:true}]}]}));
  });
  await page.goto(remote || server.resolvedUrls.local[0]);await page.evaluate(()=>document.fonts.ready);
  for(const lang of ['中文','English','日本語']) {
   await page.getByRole('radio',{name:lang,exact:true}).click();
   const visual=page.locator('.now-playing-settings .segmented-control').last();
   for(let mode=0;mode<4;mode++) {
    await visual.locator('button').nth(mode).click();
    const bounds=await page.evaluate(()=>{
     const r=s=>document.querySelector(s).getBoundingClientRect();
     const panel=r('.player-panel'),cover=r('.player-art .aspect-square'),settings=r('.now-playing-settings');
     return {cover:cover.width,bottomGap:panel.bottom-settings.bottom,settingsBottom:settings.bottom,panelBottom:panel.bottom,scroll:document.querySelector('.player-panel').scrollTop};
    });
    assert(bounds.cover>=99,JSON.stringify(bounds));
    assert(bounds.settingsBottom<=bounds.panelBottom-4,JSON.stringify({width,height,lang,mode,...bounds}));
    assert(bounds.bottomGap<45,JSON.stringify({width,height,lang,mode,...bounds}));
    if(width===393 && lang==='中文' && mode===0){await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/mobile-spacing.png'});console.log(bounds);}
   }
  }
  console.log('PASS mobile spacing',width,height,'3 languages x 4 visualizer modes');await page.close();
 }
} finally {await browser.close();await server?.close();}
