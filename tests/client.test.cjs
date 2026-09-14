const test=require('node:test');const assert=require('node:assert/strict');
const {createTransport,mediaUrl}=require('../desktop/cloud.cjs');
function fixture(fetcher){const secrets=new Map();return {secrets,request:createTransport({get:k=>secrets.get(k),set:(k,v)=>v===null?secrets.delete(k):secrets.set(k,v)},fetcher)};}
test('native transport seals credentials, fixed origin and public/personal separation',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('/capabilities')?{minProtocol:1,protocol:1}:url.endsWith('/auth/login')?{token:'PRIVATE',user:{id:'u'}}:url.endsWith('/login/qr/check')?{code:803,cookie:'PERSONAL'}:{code:200}};});
 const login=await f.request({path:'/auth/login',body:{username:'u',password:'p'}});assert(!JSON.stringify(login).includes('PRIVATE'));
 await f.request({path:'/login/qr/check',body:{key:'k'},music:true});
 await f.request({path:'/song/url/v1',body:{id:1,level:'exhigh',cookie:'OVERRIDE'},music:true,expectedUser:'u'});
 assert(!calls.at(-1).options.body.has('cookie'));assert.equal(calls.at(-1).options.headers.Authorization,'Bearer PRIVATE');
 await f.request({path:'/user/playlist',body:{uid:1},music:true});assert.equal(calls.at(-1).options.body.get('cookie'),'PERSONAL');
 await assert.rejects(f.request({path:'https://evil.example'}),/CLIENT_ROUTE_DENIED/);await assert.rejects(f.request({path:'/admin/status'}),/CLIENT_ROUTE_DENIED/);
 assert(calls.every(c=>c.url.startsWith('https://lumen.rupa.best/api/')&&c.options.redirect==='error'));
 for(const url of ['http://m1.music.126.net/x','https://music.126.net.evil.com/x','https://user@music.126.net/x','file:///secret','https://localhost/x'])assert.throws(()=>mediaUrl(url));
 assert.equal(mediaUrl('https://m1.music.126.net/a'),'https://m1.music.126.net/a');
});
test('late device responses cannot restore an account after logout',async()=>{
 let finish;const f=fixture(async url=>{if(url.endsWith('/session'))await new Promise(r=>finish=r);return {ok:true,status:200,json:async()=>url.endsWith('/capabilities')?{minProtocol:1,protocol:1}:({user:{id:'old'}})};});f.secrets.set('token','old');f.secrets.set('user',{id:'old'});
 const pending=f.request({path:'/auth/session'});while(!finish)await new Promise(r=>setImmediate(r));await f.request({path:'/auth/logout',body:{}});finish();await assert.rejects(pending,/AUTH_REQUIRED/);assert.equal(f.secrets.get('token'),undefined);
});
