import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('test-results',{recursive:true});
const profile=await mkdtemp(resolve('test-results','desktop-cloud-'));
const pcm=Buffer.alloc(44+44100*2*4);pcm.write('RIFF',0);pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(44100,24);pcm.writeUInt32LE(88200,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);
const wav=resolve(profile,'Cloud client smoke.wav');await writeFile(wav,pcm);
const env={...process.env,LUMEN_TEST_USER_DATA:profile,LUMEN_TEST_HEADLESS:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({...(process.env.LUMEN_EXECUTABLE?{executablePath:process.env.LUMEN_EXECUTABLE,args:[]}:{args:['.']}),env,timeout:30000});
try{
 const page=await app.firstWindow();await page.waitForURL('lumen://app/');await page.waitForSelector('.sidebar');const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const prefs=await app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation};});assert.deepEqual(prefs,{sandbox:true,nodeIntegration:false,contextIsolation:true});
 await assert.rejects(page.evaluate(()=>window.lumenNative.request({path:'/admin/status'})));
 await assert.rejects(page.evaluate(()=>window.lumenNative.request({path:'https://evil.example/'})));
 assert.equal(await page.evaluate(()=>typeof require),'undefined');
 await app.evaluate(({dialog},wav)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[wav]});},wav);
 await page.locator('.sidebar:visible .sidebar-actions button').nth(1).click();
 await page.waitForFunction(()=>document.body.textContent.includes('Cloud client smoke'));
 await page.locator('.player-transport-main > button').nth(1).click();
 await page.waitForFunction(()=>navigator.mediaSession.metadata?.title==='Cloud client smoke');
 const range=await page.evaluate(async()=>{const state=await window.lumenNative.bootstrap();const lib=JSON.parse(state.values['lumen.library.v1']);const id=lib.playlists[0].tracks[0].localFileId;const r=await fetch('lumen://app/file/'+id,{headers:{Range:'bytes=0-3'}});return {status:r.status,text:await r.text()};});assert.deepEqual(range,{status:206,text:'RIFF'});
 await page.reload();await page.waitForSelector('.sidebar');await page.waitForFunction(()=>document.body.textContent.includes('Cloud client smoke'));assert(!await page.locator('.site-file-link').count());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isDestroyed()),false);
 await app.evaluate(async ({BrowserWindow,protocol,dialog}, bytes)=>{
  dialog.showMessageBox=async()=>({response:1});
  protocol.handle('http',()=>new Response('<!doctype html><title>Legacy test seed</title>',{headers:{'Content-Type':'text/html'}}));
  const seed=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try{await seed.loadURL('http://127.0.0.1:3000/');await seed.webContents.executeJavaScript(`(async()=>{
    localStorage.setItem('lumen.library.v1',JSON.stringify({playlists:[{id:'old-playlist',name:'Legacy fixture',kind:'folder',tracks:[{id:'old-entry',localFileId:'old-file',source:'local',fileName:'Legacy.wav',title:'Legacy fixture'}]}]}));
    localStorage.setItem('lumen.netease.v1',JSON.stringify({cookie:'LEGACY_PRIVATE_COOKIE'}));
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lumen-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(new File([new Uint8Array(${JSON.stringify(bytes)})],'Legacy.wav',{type:'audio/wav'}),'old-file');tx.oncomplete=resolve;tx.onerror=reject;});db.close();
  })()`);}finally{seed.destroy();protocol.unhandle('http');}
 },Array.from(pcm));
 assert.equal((await page.evaluate(()=>window.lumenNative.migrateLegacy())).imported,true);
 const migrated=await page.evaluate(()=>window.lumenNative.bootstrap());assert(!JSON.stringify(migrated).includes('LEGACY_PRIVATE_COOKIE'));assert(JSON.parse(migrated.values['lumen.library.v1']).playlists.some(p=>p.name==='Legacy fixture'));
 assert.equal((await page.evaluate(()=>window.lumenNative.migrateLegacy())).imported,false);
 console.log('PASS explicit old-origin migration, audio retained and credentials excluded');
 assert.deepEqual(errors,[]);await page.screenshot({path:'test-results/desktop-cloud.png'});
 assert(!(await readFile('desktop/main.cjs','utf8')).includes('utilityProcess'));
 console.log('PASS bundled UI, sandbox, route denial, original file reference, Range, SQLite reload and close-to-tray');
}finally{await app.close();}
