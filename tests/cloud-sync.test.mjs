import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
const { migrate }=require('../server/migrate.cjs');
const { synchronize }=require('../server/sync.cjs');
const bundled=await build({stdin:{contents:"export {CloudSync} from './src/lib/cloudSync'; export {setSiteSession} from './src/lib/siteApi';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Lumen',platform:'browser',target:'es2022'});
async function database(t) {
  const pg=new PGlite();const adapt=c=>({query:async(sql,args)=>args?c.query(sql,args):(await c.exec(sql)).at(-1)});
  const db={...adapt(pg),transaction:fn=>pg.transaction(tx=>fn(adapt(tx)))};await migrate(db);
  await db.query("INSERT INTO lumen_users(id,username,password_hash,role) VALUES('u','user','unused','user'),('v','other','unused','user')");
  t.after(()=>pg.close());return db;
}
function device(db,user='u',storage=new Map()) {
  const events=new EventTarget();let offline=false, latest=null,status='';const payloads=[];
  const context=vm.createContext({console,crypto:webcrypto,structuredClone,AbortSignal,Event,
    setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    window:events,document:Object.assign(new EventTarget(),{visibilityState:'visible'}),
    fetch:async(_url,options)=>{if(offline)throw new Error('offline');const body=JSON.parse(options.body);payloads.push(body);assert.equal(options.headers['X-Lumen-User'],user);return {ok:true,json:async()=>synchronize(db,user,body)};}
  });vm.runInContext(bundled.outputFiles[0].text,context);
  context.Lumen.setSiteSession({configured:true,initialized:true,user:{id:user},csrf:'fixture'});
  const sync=new context.Lumen.CloudSync(user,[]);
  return {sync,storage,payloads,context,get latest(){return latest;},setOffline(v){offline=v;},async start(){sync.start(s=>{latest=JSON.parse(JSON.stringify(s));},s=>{status=s;});await this.wait();},async wait(){for(let i=0;i<200&&status==='syncing';i++)await new Promise(r=>setTimeout(r,5));},async pull(){await sync.exchange();await this.wait();},stop(){sync.stop();}};
}
const track=id=>({id,source:'local',localFileId:'file-'+id,neteaseId:null,fileName:id+'.wav',path:'C:/private/audio',file:{bytes:'SECRET'},title:id,artist:'artist',album:null,genre:null,year:null,duration:30,codec:null,bitrate:null,sampleRate:null,coverUrl:'blob:secret',fallbackCover:0,metaLoaded:true});
const playlist=tracks=>({id:'p',name:'Songs',kind:'temp',neteaseId:null,tracks});

test('large imports finish across bounded requests and partially acknowledged transactions',async t=>{
  const db=await database(t);
  let clock=0;
  // Simulate network round trips consuming the function's time budget.
  t.mock.method(Date,'now',()=>clock);
  const slow={transaction:fn=>db.transaction(tx=>fn({query:async(...args)=>{clock+=1100;return tx.query(...args);}}))};
  const a=device(slow);t.after(()=>a.stop());await a.start();
  a.sync.observe([playlist(Array.from({length:105},(_,i)=>track('large-'+i)))]);
  await a.pull();
  assert.equal(a.latest.playlists[0].tracks.length,105);
  assert(a.payloads.filter(p=>p.operations.length).length>10);
  assert(a.payloads.every(p=>p.operations.length<=10));
  const snapshot=await synchronize(db,'u',{cursor:0,operations:[]});
  assert.equal(snapshot.snapshot.playlists[0].tracks.length,105);
  assert.equal(snapshot.cursor,106);
});
test('two offline devices merge additions and replay pending changes without resurrecting deletions',async t=>{
  const db=await database(t),a=device(db),b=device(db);t.after(()=>{a.stop();b.stop();});
  await a.start();a.sync.observe([playlist([track('one')])]);await a.pull();await b.start();
  a.setOffline(true);b.setOffline(true);
  a.sync.observe([playlist([track('one'),track('two')])]);b.sync.observe([playlist([track('one'),track('three')])]);
  await a.pull();await b.pull();a.setOffline(false);b.setOffline(false);
  await a.pull();await b.pull();await a.pull();
  assert.deepEqual(a.latest.playlists[0].tracks.map(t=>t.id),['one','two','three']);
  assert(!JSON.stringify(a.payloads).includes('SECRET'));assert(!JSON.stringify(a.payloads).includes('private'));assert(!JSON.stringify(a.payloads).includes('blob:'));
  b.sync.observe([]);await b.pull();
  a.sync.observe([{...playlist([track('one'),track('two'),track('three')]),name:'Offline rename'}]);await a.pull();
  assert.deepEqual(a.latest.playlists,[]);
});
test('unsent time survives reload, retries once, and cannot restore cleared statistics',async t=>{
  const db=await database(t),a=device(db);await a.start();a.setOffline(true);
  a.sync.record({key:'song',title:'Song',artist:'Artist',day:'2026-09-14',ms:4000,plays:0,lastPlayed:123});
  const storage=a.storage;a.stop();
  const restored=device(db,'u',storage);t.after(()=>restored.stop());await restored.start();
  assert.equal(restored.latest.stats.totalMs,4000);await restored.pull();assert.equal(restored.latest.stats.totalMs,4000);
  const b=device(db);t.after(()=>b.stop());await b.start();b.setOffline(true);
  b.sync.record({key:'song',title:'Song',artist:'Artist',day:'2026-09-14',ms:1000,plays:0,lastPlayed:124});
  restored.sync.clearStats();await restored.pull();b.setOffline(false);await b.pull();
  assert.equal(b.latest.stats.totalMs,0);await restored.pull();assert.equal(restored.latest.stats.totalMs,0);
});
test('user changes reject old pending submissions and caches remain account scoped',async t=>{
  const db=await database(t),a=device(db);t.after(()=>a.stop());await a.start();
  a.sync.observe([playlist([track('private')])]);
  a.context.Lumen.setSiteSession({configured:true,initialized:true,user:{id:'v'},csrf:'different'});
  await a.pull();assert.equal(a.payloads.length,1);
  const other=device(db,'v',a.storage);t.after(()=>other.stop());await other.start();assert.deepEqual(other.latest.playlists,[]);
});

test('large legacy statistics import in chunks and retry without double counting',async t=>{
  const db=await database(t),a=device(db);t.after(()=>a.stop());await a.start();
  const tracks=Object.fromEntries(Array.from({length:105},(_,i)=>['song'+i,{key:'song'+i,title:'Song '+i,artist:'Artist',ms:1000,plays:1,lastPlayed:123}]));
  const stats={totalMs:105000,days:{'2026-09-14':105000},artists:{Artist:105000},tracks};
  a.sync.importStats(stats,'legacy-device');await a.pull();
  assert.equal(a.latest.stats.totalMs,105000);assert.equal(Object.keys(a.latest.stats.tracks).length,105);
  a.sync.importStats(stats,'legacy-device');await a.pull();
  assert.equal(a.latest.stats.totalMs,105000);assert.equal(a.latest.stats.tracks.song0.plays,1);
  a.sync.clearStats();await a.pull();a.sync.importStats(stats,'legacy-device');await a.pull();
  assert.equal(a.latest.stats.totalMs,0);
});
