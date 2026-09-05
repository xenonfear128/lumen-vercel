const test = require('node:test');
const assert = require('node:assert/strict');
const { createLumenServer } = require('../server/service.cjs');
async function running(t, options = {}) {
  const calls = [];
  const server = createLumenServer({ api: async (path, params) => {
    calls.push({ path, params }); return { status: 200, body: { code: 200, result: { songs: [] } } };
  }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}`, calls };
}
test('serves the built app and health without exposing arbitrary files', async t => {
  const { url } = await running(t);
  const html = await fetch(url).then(r => r.text());
  assert.match(html, /Lumen/); assert.match(html, /\/api/); assert(!html.includes('http://127.0.0.1:3000'));
  assert.equal((await fetch(`${url}/healthz`).then(r=>r.json())).service,'lumen');
  assert.equal((await fetch(`${url}/package.json`)).status,404);
  assert.equal((await fetch(`${url}/server/start.cjs`)).status,404);
  assert.equal((await fetch(`${url}/api/unknown`,{method:'POST'})).status,404);
});
test('POST API carries cookies in the body without shared Set-Cookie/cache', async t => {
  const {url,calls}=await running(t);
  const response=await fetch(`${url}/api/cloudsearch`,{method:'POST',body:new URLSearchParams({keywords:'test',cookie:'test-session'})});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('set-cookie'),null);
  assert.deepEqual(calls,[{path:'/cloudsearch',params:{keywords:'test',cookie:'test-session'}}]);
});
test('rejects cross-site API calls, unsupported methods, and oversized bodies',async t=>{
  const {url,calls}=await running(t);
  assert.equal((await fetch(`${url}/api/logout`)).status,405);
  assert.equal((await fetch(`${url}/api/logout`,{method:'POST',body:new URLSearchParams(),headers:{Origin:'https://unrelated.example'}})).status,403);
  assert.equal((await fetch(`${url}/api/logout`,{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status,415);
  assert.equal((await fetch(`${url}/api/logout`,{method:'POST',body:new URLSearchParams({cookie:'a'.repeat(70000)})})).status,413);
  assert.equal(calls.length,0);
});
test('optional server authentication covers app and API; health stays probeable',async t=>{
  const {url}=await running(t,{authUser:'test',authPassword:'long-test-password'});
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(`${url}/api/logout`,{method:'POST'})).status,401);
  assert.equal((await fetch(`${url}/healthz`)).status,200);
  const headers={Authorization:`Basic ${Buffer.from('test:long-test-password').toString('base64')}`};
  assert.equal((await fetch(url,{headers})).status,200);
});
test('desktop service requires its per-launch capability',async t=>{
  const {url}=await running(t,{desktopToken:'desktop-test-token'});
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url,{headers:{'X-Lumen-Desktop':'desktop-test-token'}})).status,200);
});
test('API failures return a generic error without leaking upstream request data',async t=>{
  const {url}=await running(t,{api:async()=>{throw new Error('secret-cookie-value');}});
  const response=await fetch(`${url}/api/logout`,{method:'POST',body:new URLSearchParams()});
  assert.equal(response.status,500);assert(!(await response.text()).includes('secret-cookie-value'));
});
