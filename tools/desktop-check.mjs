import { _electron as electron } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
await mkdir('test-results',{recursive:true});
const profile = await mkdtemp(resolve('test-results','desktop-profile-'));
const executablePath = process.env.LUMEN_EXECUTABLE;
const launchEnv = { ...process.env, LUMEN_TEST_USER_DATA: profile, LUMEN_TEST_HEADLESS: '1' };
delete launchEnv.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
  env: launchEnv,
  timeout: 30000,
});
try {
  const window=await app.firstWindow({timeout:20000});await window.waitForLoadState('domcontentloaded');
  assert.equal(new URL(window.url()).origin,'http://127.0.0.1:3000');
  assert(await window.title());
  const errors=[];window.on('pageerror',e=>errors.push(e.message));
  const security=await app.evaluate(({BrowserWindow})=>{
    const prefs=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {sandbox:prefs.sandbox,nodeIntegration:prefs.nodeIntegration,contextIsolation:prefs.contextIsolation};
  });
  assert.deepEqual(security,{sandbox:true,nodeIntegration:false,contextIsolation:true});
  assert.equal((await fetch('http://127.0.0.1:3000')).status,403,'External browsers cannot use the desktop private service');
  const health=await window.evaluate(()=>fetch('/healthz').then(r=>r.json()));assert.equal(health.service,'lumen');
  const api=await window.evaluate(()=>fetch('/api/login/status',{method:'POST',body:new URLSearchParams()}).then(async r=>({status:r.status,body:await r.json()})));
  assert.equal(api.status,200);assert.equal(api.body.data.profile,null);
  // Import a deterministic, silent WAV through the same picker path as a real file.
  const pcm=Buffer.alloc(44+44100*2*4);pcm.write('RIFF',0);pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(44100,24);pcm.writeUInt32LE(88200,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);
  await window.locator('.sidebar:visible input[type=file]').nth(1).setInputFiles({name:'Lumen smoke test.wav',mimeType:'audio/wav',buffer:pcm});
  const play=window.locator('.player-transport-main > button').nth(1);await play.click();
  await window.waitForFunction(()=>document.querySelector('h1')?.textContent==='Lumen smoke test');
  await window.waitForFunction(()=>navigator.mediaSession.metadata?.title==='Lumen smoke test');
  await window.screenshot({path:'test-results/desktop.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS desktop: private API, isolated renderer, local WAV playback, media metadata');
} finally { await app.close(); }
let released=false;
for(let i=0;i<30;i++){
 try{await fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(300)});}catch{released=true;break;}
 await delay(100);
}
assert(released,'Desktop shutdown must release the API port');
console.log('PASS desktop: companion API exits and port is released');
