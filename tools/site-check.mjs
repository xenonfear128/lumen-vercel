import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {migrate}=require('../server/migrate.cjs');
const {createManaged}=require('../server/managed.cjs');
const {createLumenServer}=require('../server/service.cjs');
const pg=new PGlite();
const adapt=c=>({query:async(sql,args)=>args?c.query(sql,args):(await c.exec(sql)).at(-1)});
const db={...adapt(pg),transaction:fn=>pg.transaction(tx=>fn(adapt(tx)))};
await migrate(db);
const sourceCookie='SOURCE_COOKIE_MUST_NOT_REACH_BROWSER';
const api=async(path,params)=>{
  if(path==='/login/qr/key')return {status:200,body:{code:200,data:{unikey:'key'}}};
  if(path==='/login/qr/create')return {status:200,body:{code:200,data:{qrimg:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}}};
  if(path==='/login/qr/check')return {status:200,body:{code:803,cookie:sourceCookie}};
  if(path==='/login/status')return {status:200,body:{data:{code:200,profile:params.cookie===sourceCookie?{userId:42,nickname:'Shared source'}:null}}};
  if(path==='/song/url/v1') {assert.equal(params.cookie,sourceCookie);return {status:200,body:{code:200,data:[{id:1,url:null}]}};}
  return {status:200,body:{code:200,result:{songs:[],songCount:0}}};
};
const managed=createManaged({db,api,config:{LUMEN_SETUP_TOKEN:'fixture-setup-token',LUMEN_CREDENTIAL_KEY:randomBytes(32).toString('base64')}});
const server=createLumenServer({api,managed});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const errors=[];
const context=await browser.newContext({viewport:{width:1280,height:850}});
await context.addInitScript(()=>localStorage.setItem('lumen.lang','zh'));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const fill=async(name,value)=>page.locator(`input[name="${name}"]`).fill(value);
const request=async(p,path,body)=>p.evaluate(async({path,body})=>{
  const session=await fetch('/api/auth/session').then(r=>r.json());
  const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Lumen-Request':'1','X-Lumen-CSRF':session.csrf||'','X-Lumen-User':session.user?.id||''},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};
},{path,body});
try {
  await page.goto(base+'/admin');
  await fill('username','admin');await fill('password','fixture-password-123');await fill('setupToken','fixture-setup-token');
  await page.locator('form button[type=submit]').click();
  await page.getByRole('button',{name:'扫码绑定账号',exact:true}).waitFor();
  await page.getByRole('button',{name:'扫码绑定账号',exact:true}).click();
  await page.getByRole('heading',{name:'Shared source'}).waitFor();
  assert(!await page.content().then(s=>s.includes(sourceCookie)));
  assert(!await page.evaluate(()=>JSON.stringify(localStorage).includes('SOURCE_COOKIE_MUST_NOT_REACH_BROWSER')));
  await page.getByRole('button',{name:'用户与邀请码',exact:true}).click();
  await page.getByRole('button',{name:'生成邀请码',exact:true}).click();
  const invite=await page.locator('.site-secret').inputValue();assert(invite.length>30);
  console.log('PASS administrator setup, QR binding, credential isolation and invitation UI');

  const userContext=await browser.newContext({viewport:{width:1280,height:850}});
  await userContext.addInitScript(()=>localStorage.setItem('lumen.lang','zh'));
  const user=await userContext.newPage();user.on('pageerror',e=>errors.push(e.message));
  await user.goto(base);
  const pcm=Buffer.alloc(44+44100*2*3);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(44100,24);pcm.writeUInt32LE(88200,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);
  await user.locator('.sidebar:visible input[type=file]').nth(1).setInputFiles({name:'Cloud fixture.wav',mimeType:'audio/wav',buffer:pcm});
  await user.getByRole('button',{name:'网站账号',exact:true}).click();
  await user.getByRole('button',{name:'注册',exact:true}).first().click();
  await user.locator('input[name=username]').fill('listener');await user.locator('input[name=password]').fill('fixture-password-123');await user.locator('input[name=invite]').fill(invite);
  await user.locator('form button[type=submit]').click();
  await user.getByRole('button',{name:'导入到此账号',exact:true}).waitFor();
  await user.getByRole('button',{name:'导入到此账号',exact:true}).click();
  await user.getByRole('button',{name:'导入到此账号',exact:true}).waitFor({state:'hidden'});
  await user.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await user.waitForFunction(()=>document.querySelector('[aria-label="已同步"]'));
  const session=(await request(user,'/auth/session')).body;
  const snapshot=(await request(user,'/sync/exchange',{cursor:0,operations:[]})).body.snapshot;
  assert.equal(snapshot.playlists.length,1);assert.equal(snapshot.playlists[0].tracks[0].fileName,'Cloud fixture.wav');
  assert(!JSON.stringify(snapshot).includes('blob:'));assert(!JSON.stringify(snapshot).includes('RIFF'));
  console.log('PASS invitation registration and explicit local metadata migration');

  const secondContext=await browser.newContext({viewport:{width:1280,height:850}});
  await secondContext.addInitScript(()=>localStorage.setItem('lumen.lang','zh'));
  const second=await secondContext.newPage();second.on('pageerror',e=>errors.push(e.message));
  await second.goto(base);await second.getByRole('button',{name:'网站账号',exact:true}).click();
  await second.locator('input[name=username]').fill('listener');await second.locator('input[name=password]').fill('fixture-password-123');await second.locator('form button[type=submit]').click();
  await second.waitForFunction(()=>document.querySelector('[aria-label="已同步"]'));
  await second.locator('.site-file-link').waitFor();
  await second.locator('.site-file-link input').setInputFiles({name:'Cloud fixture.wav',mimeType:'audio/wav',buffer:pcm});
  await second.locator('.site-file-link').waitFor({state:'hidden'});
  await second.locator('.player-transport-main > button').nth(1).click();
  await second.waitForFunction(()=>document.querySelector('h1')?.textContent==='Cloud fixture');
  await second.waitForTimeout(4000);
  const cloud=(await request(second,'/sync/exchange',{cursor:0,operations:[]})).body;
  assert(cloud.snapshot.events.some(e=>e.type==='stats.add'&&e.data.plays===1));
  await second.reload();await second.waitForFunction(()=>document.querySelector('[aria-label="已同步"]'));
  assert.equal(await second.locator('.site-file-link').count(),0);
  console.log('PASS second-device sync, missing-file indication, relinking, playback and statistics');

  // Delete on one device and force an incremental pull on the other.
  await second.locator('li button[aria-label="移除"]').first().click();
  await second.waitForFunction(()=>document.querySelector('[aria-label="已同步"]'));
  await user.evaluate(()=>window.dispatchEvent(new Event('online')));
  await user.waitForFunction(()=>!document.querySelector('li[data-id]'));
  const isolated=await request(page,'/sync/exchange',{cursor:0,operations:[]});assert.equal(isolated.body.snapshot.playlists.length,0);
  console.log('PASS remote deletion propagation and account data isolation');

  // A recreated temporary list must receive a new identity after its tombstone.
  let previousId=(await request(second,'/sync/exchange',{cursor:0,operations:[]})).body.snapshot.playlists[0].id;
  for(let i=0;i<2;i++) {
    await second.locator('.sidebar:visible li button').last().click();
    await second.waitForFunction(()=>document.querySelectorAll('.sidebar li').length===0);
    await second.waitForFunction(()=>document.querySelector('[aria-label="已同步"]'));
    await second.locator('.sidebar:visible input[type=file]').nth(1).setInputFiles({name:'Re-added.wav',mimeType:'audio/wav',buffer:pcm});
    await second.waitForFunction(()=>document.querySelector('li[data-id]'));
    await second.waitForFunction(()=>document.querySelector('[aria-label="已同步"]'));
    const recreated=(await request(second,'/sync/exchange',{cursor:0,operations:[]})).body.snapshot.playlists;
    assert.equal(recreated.length,1);assert.notEqual(recreated[0].id,previousId);assert.equal(recreated[0].tracks.length,1);
    previousId=recreated[0].id;
  }
  console.log('PASS deleted temporary playlists can be recreated without reviving tombstones');

  await mkdir('test-results',{recursive:true});
  for(const [lang,label] of [['zh','中文'],['en','English'],['ja','日本語']]) {
    await page.getByRole('radio',{name:label,exact:true}).click();
    await page.setViewportSize({width:375,height:812});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,`Admin overflow: ${lang}`);
    await page.screenshot({path:`test-results/admin-${lang}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);
  assert(session.user.id);
  console.log('PASS three-language mobile admin layout and no browser errors');
} finally {
  await browser.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});await pg.close();
}
