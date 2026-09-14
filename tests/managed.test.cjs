const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { migrate } = require('../server/migrate.cjs');
const { createManaged } = require('../server/managed.cjs');
const { createLumenServer } = require('../server/service.cjs');
const { synchronize } = require('../server/sync.cjs');
const { hash } = require('../server/security.cjs');

async function fixture(t) {
  const pg = new PGlite();
  const adapt = client => ({ query: async (sql,args) => args ? client.query(sql,args) : (await client.exec(sql)).at(-1) });
  const db = { ...adapt(pg), transaction: fn => pg.transaction(tx => fn(adapt(tx))) };
  await migrate(db);
  const state = { cookie:'secret-public-account', valid:true, missing:false, requests:[], delayed:null };
  const api = async (path,params) => {
    state.requests.push({path,params});
    if(path==='/login/qr/key')return {status:200,body:{code:200,data:{unikey:'fixture-key'}}};
    if(path==='/login/qr/create')return {status:200,body:{code:200,data:{qrimg:'data:image/png;base64,AA=='}}};
    if(path==='/login/qr/check') { if(state.delayed)await state.delayed;return {status:200,body:{code:803,cookie:state.cookie}}; }
    if(path==='/login/status')return {status:200,body:{data:{code:200,profile:state.valid?{userId:7,nickname:'Source account'}:null}}};
    if(path==='/song/url/v1')return {status:200,body:{code:200,cookie:state.cookie,data:[{id:Number(params.id),url:state.missing?null:'https://music.example/song.mp3',cookie:state.cookie}]}};
    return {status:200,body:{code:200}};
  };
  const managed=createManaged({db,api,config:{LUMEN_SETUP_TOKEN:'setup-fixture',LUMEN_CREDENTIAL_KEY:randomBytes(32).toString('base64')}});
  const server=process.env.LUMEN_TEST_VERCEL === '1'
    ? require('node:http').createServer(require('../server/api-handler.cjs').createApiHandler({api,managed}))
    : createLumenServer({api,managed});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});await pg.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const client=()=>({cookie:'',csrf:'',async call(path,body,headers={}){
    const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:this.cookie,'X-Lumen-Request':'1','X-Lumen-CSRF':this.csrf,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const cookie=r.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];
    const json=await r.json();if(json.csrf)this.csrf=json.csrf;
    return {status:r.status,body:json,headers:r.headers};
  },async play(params={id:'1',level:'exhigh'},headers={}){
    const r=await fetch(base+'/api/song/url/v1',{method:'POST',headers:{Cookie:this.cookie,'X-Lumen-CSRF':this.csrf,'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(params)});
    return {status:r.status,body:await r.json()};
  }});
  const admin=client();
  const setup=await admin.call('/auth/setup',{setupToken:'setup-fixture',username:'admin',password:'fixture-password-123'});
  assert.equal(setup.status,200);
  const register=async(name)=>{const invite=(await admin.call('/admin/invites/create',{})).body.invite;const c=client();const r=await c.call('/auth/register',{username:name,password:'fixture-password-123',invite});assert.equal(r.status,200);return {client:c,user:r.body.user};};
  return {db,state,admin,client,register,base};
}
test('setup, invitation transactions, user roles, sessions and reset credentials',async t=>{
  const {db,admin,client,register}=await fixture(t);
  assert.equal((await client().call('/auth/setup',{setupToken:'setup-fixture',username:'other',password:'fixture-password-123'})).status,409);
  const invite=(await admin.call('/admin/invites/create',{})).body.invite;
  const attempts=await Promise.all(['alice','bob'].map(username=>client().call('/auth/register',{username,password:'fixture-password-123',invite})));
  assert.deepEqual(attempts.map(x=>x.status).sort(),[200,400]);
  assert(!JSON.stringify((await admin.call('/admin/invites')).body).includes(invite));
  const {client:user,user:record}=await register('charlie');
  assert.equal((await user.call('/admin/status')).status,403);
  assert.equal((await admin.call('/admin/users/update',{id:(await admin.call('/auth/session')).body.user.id,disabled:true})).status,409);
  assert.equal((await admin.call('/admin/users/update',{id:record.id,disabled:true})).status,200);
  assert.equal((await user.call('/sync/exchange',{cursor:0,operations:[]})).status,401);
  await admin.call('/admin/users/update',{id:record.id,disabled:false});
  await user.call('/auth/login',{username:'charlie',password:'fixture-password-123'});
  const reset=(await admin.call('/admin/users/reset',{id:record.id})).body.resetToken;
  assert.equal((await user.call('/sync/exchange',{cursor:0,operations:[]})).status,401);
  assert.equal((await client().call('/auth/reset',{resetToken:reset,password:'replacement-password'})).status,200);
  assert.equal((await client().call('/auth/reset',{resetToken:reset,password:'another-password'})).status,400);
  const login=await user.call('/auth/login',{username:'charlie',password:'replacement-password'});assert.equal(login.status,200);
  assert(login.headers.get('set-cookie').includes('HttpOnly'));assert(login.headers.get('set-cookie').includes('SameSite=Strict'));
  await db.query('UPDATE lumen_sessions SET expires_at=now()-interval \'1 second\' WHERE user_id=$1',[record.id]);
  assert.equal((await user.call('/auth/session')).body.user,null);
  const hashes=await db.query('SELECT password_hash FROM lumen_users');assert(hashes.rows.every(r=>r.password_hash.startsWith('scrypt:')));
});
test('public source stays encrypted and isolated; authentication, expiry and limits fail closed',async t=>{
  const {admin,client,register,db,state}=await fixture(t);
  const {client:user,user:record}=await register('listener');
  assert.equal((await client().play()).body.error,'AUTH_REQUIRED');
  assert.equal((await user.play()).body.error,'SOURCE_UNCONFIGURED');
  assert.equal((await admin.call('/admin/source/start',{}, {Origin:'https://evil.example'})).status,403);
  const qr=(await admin.call('/admin/source/start',{})).body;
  const bound=await admin.call('/admin/source/poll',{generation:qr.generation});assert.equal(bound.body.state,'success');
  assert(!JSON.stringify(bound).includes(state.cookie));
  const source=(await db.query('SELECT * FROM lumen_source')).rows[0];assert(!JSON.stringify(source).includes(state.cookie));
  const play=await user.play({id:'1',level:'exhigh',cookie:'personal-cookie'});assert.equal(play.status,200);assert(!JSON.stringify(play).includes(state.cookie));
  assert.equal(state.requests.filter(r=>r.path==='/song/url/v1').at(-1).params.cookie,state.cookie);
  await user.call('/auth/logout',{});
  assert.equal((await db.query('SELECT enabled FROM lumen_source')).rows[0].enabled,true);
  await user.call('/auth/login',{username:'listener',password:'fixture-password-123'});
  assert.equal((await user.play({id:'1,2',level:'exhigh'})).status,400);
  state.missing=true;assert.equal((await user.play()).body.reason,'TRACK_UNAVAILABLE');
  state.valid=false;assert.equal((await user.play()).body.error,'SOURCE_EXPIRED');
  assert.equal((await user.play()).body.error,'SOURCE_EXPIRED');
  await db.query('INSERT INTO lumen_limits(key,bucket,count) VALUES($1,$2,30) ON CONFLICT(key,bucket) DO UPDATE SET count=30',[hash(`play:${record.id}`),Math.floor(Date.now()/60000)]);
  assert.equal((await user.play()).status,429);
});
test('cancelled QR responses cannot replace a newer source',async t=>{
  const {admin,state,db}=await fixture(t);
  const qr=(await admin.call('/admin/source/start',{})).body;
  let release;state.delayed=new Promise(resolve=>{release=resolve;});
  const pending=admin.call('/admin/source/poll',{generation:qr.generation});
  await new Promise(resolve=>setTimeout(resolve,50));
  await admin.call('/admin/source/cancel',{generation:qr.generation});
  release();assert.equal((await pending).status,409);
  assert.equal((await db.query('SELECT credential FROM lumen_source')).rows[0].credential,null);
});

test('expired and revoked invitations, missing CSRF, and stale account headers are rejected',async t=>{
  const {admin,client,db}=await fixture(t);
  const expired=(await admin.call('/admin/invites/create',{})).body.invite;
  await db.query("UPDATE lumen_invites SET expires_at=now()-interval '1 second' WHERE hash=$1",[hash(expired)]);
  assert.equal((await client().call('/auth/register',{username:'expired',password:'fixture-password-123',invite:expired})).body.error,'INVITE_INVALID');
  const revoked=(await admin.call('/admin/invites/create',{})).body.invite;
  const id=(await db.query('SELECT id FROM lumen_invites WHERE hash=$1',[hash(revoked)])).rows[0].id;
  await admin.call('/admin/invites/revoke',{id});
  assert.equal((await client().call('/auth/register',{username:'revoked',password:'fixture-password-123',invite:revoked})).body.error,'INVITE_INVALID');
  assert.equal((await admin.call('/admin/invites/create',{}, {'X-Lumen-CSRF':''})).body.error,'CSRF_REJECTED');
  assert.equal((await admin.call('/admin/invites/create',{}, {'X-Lumen-Request':''})).body.error,'CSRF_REJECTED');
  assert.equal((await admin.call('/sync/exchange',{cursor:0,operations:[]},{'X-Lumen-User':'previous-user'})).body.error,'AUTH_REQUIRED');
});

test('failed replacement preserves the binding and logout invalidates in-flight QR completion',async t=>{
  const {admin,state,db}=await fixture(t);
  const first=(await admin.call('/admin/source/start',{})).body;
  await admin.call('/admin/source/poll',{generation:first.generation});
  const before=(await db.query('SELECT credential FROM lumen_source')).rows[0].credential;
  const replacement=(await admin.call('/admin/source/start',{})).body;
  state.valid=false;
  assert.equal((await admin.call('/admin/source/poll',{generation:replacement.generation})).body.error,'SOURCE_EXPIRED');
  assert.deepEqual((await db.query('SELECT credential FROM lumen_source')).rows[0].credential,before);
  state.valid=true;
  let release;state.delayed=new Promise(resolve=>{release=resolve;});
  const pending=admin.call('/admin/source/poll',{generation:replacement.generation});
  await new Promise(resolve=>setTimeout(resolve,50));
  await admin.call('/auth/logout',{});
  release();assert.equal((await pending).status,409);
  assert.deepEqual((await db.query('SELECT credential FROM lumen_source')).rows[0].credential,before);
});
test('synchronization merges entries, deduplicates events, isolates users and preserves tombstones',async t=>{
  const {db,register}=await fixture(t);
  const {user:a}=await register('alpha');const {user:b}=await register('beta');
  const exchange=(id,ops,cursor=0)=>synchronize(db,id,{cursor,operations:ops});
  const playlist={id:'p1',type:'playlist.put',playlistId:'p',data:{name:'Music',kind:'temp'}};
  const entry=(id)=>({id:'op-'+id,type:'entry.put',playlistId:'p',entryId:id,data:{source:'local',localFileId:'file-'+id,fileName:'C:\\private\\song.wav',file:'SECRET_BYTES',path:'C:\\private',coverUrl:'data:SECRET',title:id}});
  await exchange(a.id,[playlist,entry('a')]);
  const merged=await exchange(a.id,[entry('b')]);assert.deepEqual(merged.snapshot.playlists[0].tracks.map(t=>t.id),['a','b']);
  assert(!JSON.stringify(merged).includes('SECRET'));assert(!JSON.stringify(merged).includes('private'));
  assert.deepEqual((await exchange(b.id,[])).snapshot.playlists,[]);
  await exchange(a.id,[{id:'del',type:'entry.delete',playlistId:'p',entryId:'a'}]);
  const stale=entry('a');stale.id='new-old';assert.equal((await exchange(a.id,[stale])).snapshot.playlists[0].tracks.length,1);
  const event={id:'event',type:'stats.add',epoch:'initial',data:{key:'song',title:'song',artist:'artist',day:'2026-09-14',ms:15000,plays:1,lastPlayed:1}};
  await exchange(a.id,[event]);assert.equal((await exchange(a.id,[event])).snapshot.events.length,1);
  await exchange(a.id,[{id:'clear',type:'stats.clear',epoch:'initial',nextEpoch:'next'}]);
  assert.equal((await exchange(a.id,[{...event,id:'late'}])).snapshot.events.length,0);
  await exchange(a.id,[{id:'delete-p',type:'playlist.delete',playlistId:'p'}]);
  assert.equal((await exchange(a.id,[{...playlist,id:'stale-p'}])).snapshot.playlists.length,0);
  const delta=await exchange(a.id,[],1);assert(delta.changes.length>0);assert(!delta.snapshot);
});

test('device bearer sessions are separate, hashed, revocable and never authorize admin or Cookie routes',async t=>{
 const {admin,client,register,db}=await fixture(t);
 const {user}=await register('deviceuser');const device=client();
 const login=await device.call('/client/auth/login',{username:'deviceuser',password:'fixture-password-123'});
 assert.equal(login.status,200);assert.equal(login.headers.get('set-cookie'),null);assert.equal(login.body.expiresIn,14*86400);
 const bearer={Authorization:`Bearer ${login.body.token}`};
 assert.equal((await device.call('/client/auth/session',undefined,bearer)).body.user.id,user.id);
 assert.equal((await db.query('SELECT kind,hash FROM lumen_sessions WHERE hash=$1',[hash(login.body.token)])).rows[0].kind,'client');
 assert.equal((await device.call('/auth/session',undefined,bearer)).status,403);
 assert.equal((await device.call('/auth/password',{currentPassword:'fixture-password-123',password:'changed-password-123'},bearer)).status,403);
 assert.equal((await device.call('/sync/exchange',{cursor:0,operations:[]},bearer)).status,200);
 assert.equal((await device.play(undefined,bearer)).body.error,'SOURCE_UNCONFIGURED');
 assert.equal((await device.call('/client/auth/session',undefined,{Cookie:admin.cookie})).status,401);
 assert.equal((await device.call('/client/auth/session',undefined,{Authorization:`Bearer ${admin.cookie.split('=')[1]}`})).status,401);
 const al=await client().call('/client/auth/login',{username:'admin',password:'fixture-password-123'});
 assert.equal((await device.call('/admin/status',undefined,{Authorization:`Bearer ${al.body.token}`})).status,403);
 assert.equal((await device.call('/client/admin/status',undefined,bearer)).status,404);
 assert.equal((await device.call('/sync/exchange',{cursor:0,operations:[]},{...bearer,Origin:'https://evil.example'})).status,403);
 await admin.call('/admin/users/update',{id:user.id,disabled:true});
 assert.equal((await device.call('/client/auth/session',undefined,bearer)).status,401);
 await admin.call('/admin/users/update',{id:user.id,disabled:false});
 const again=await device.call('/client/auth/login',{username:'deviceuser',password:'fixture-password-123'});const b2={Authorization:`Bearer ${again.body.token}`};
 assert.equal((await device.call('/client/auth/password',{currentPassword:'fixture-password-123',password:'changed-password-123'},b2)).status,200);
 assert.equal((await device.call('/client/auth/session',undefined,b2)).status,401);
 assert.equal((await device.call('/client/capabilities')).body.minProtocol,1);
});
