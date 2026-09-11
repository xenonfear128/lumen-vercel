const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { createApiHandler } = require('../server/api-handler.cjs');

async function invoke(handler, { path = '/api/cloudsearch', body = 'keywords=test', parsed = false, headers = {}, method = 'POST' } = {}) {
  const req = Readable.from(parsed ? [] : [body]);
  Object.assign(req, { url: path, method, headers: { host: 'lumen.example', 'content-type': 'application/x-www-form-urlencoded', ...headers } });
  if (parsed) req.body = body;
  const response = { headers: {}, status: null, text: '', setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; for (const [key,value] of Object.entries(headers)) this.setHeader(key,value); },
    end(text) { this.text = text; }, destroy() { throw new Error('Unexpected destroyed response'); } };
  await handler(req, response);
  return response;
}

test('supports raw streams and all Vercel parsed form representations', async () => {
  const calls = [];
  const handler = createApiHandler({ api: async (path, params) => { calls.push({path,params}); return {status:200,body:{code:200}}; } });
  for (const options of [
    { body:'keywords=hello&cookie=session' },
    { body:'keywords=hello&cookie=session', parsed:true },
    { body:Buffer.from('keywords=hello&cookie=session'), parsed:true },
    { body:{ keywords:'hello', cookie:'session' }, parsed:true },
  ]) {
    const response = await invoke(handler, options);
    assert.equal(response.status,200);
    assert.deepEqual(calls.at(-1), {path:'/cloudsearch',params:{keywords:'hello',cookie:'session'}});
    for (const key of ['cache-control','cdn-cache-control','vercel-cdn-cache-control']) assert.equal(response.headers[key],'no-store');
    assert.equal(response.headers['set-cookie'],undefined);
  }
});

test('initializes lazily once and keeps concurrent users isolated', async () => {
  let initialized = 0;
  const handler = createApiHandler({ apiFactory: () => {
    initialized++;
    return async (_path, params) => { await new Promise(resolve => setTimeout(resolve, params.cookie === 'a' ? 10 : 1)); return {status:200,body:{cookie:params.cookie}}; };
  } });
  assert.equal((await invoke(handler,{path:'/api/healthz',method:'GET'})).status,200);
  assert.equal((await invoke(handler,{path:'/api/unknown'})).status,404);
  assert.equal(initialized,0);
  const responses = await Promise.all(['a','b'].map(cookie => invoke(handler,{body:{cookie},parsed:true})));
  assert.deepEqual(responses.map(response => JSON.parse(response.text).cookie),['a','b']);
  assert.equal(initialized,1);
});

test('rejects invalid routes, methods, origins, content types and query overrides before SDK loading', async () => {
  let loaded = false;
  const handler = createApiHandler({apiFactory:()=>{loaded=true; throw new Error('should not load');}});
  for (const [options, status] of [
    [{path:'/api/__proto__'},404], [{path:'/api/constructor'},404],
    [{path:'/api/unknown?path=login/status'},404], [{path:'/server/start.cjs'},404],
    [{method:'GET'},405], [{method:'OPTIONS'},405],
    [{headers:{origin:'https://attacker.example','x-forwarded-host':'attacker.example'}},403],
    [{headers:{origin:'null'}},403], [{headers:{'sec-fetch-site':'cross-site'}},403],
    [{headers:{'content-type':'application/json'}},415],
    [{headers:{'content-type':'application/x-www-form-urlencoded-malformed'}},415],
  ]) assert.equal((await invoke(handler,options)).status,status);
  assert.equal(loaded,false);
});

test('enforces body limits on streams, parsed objects and declared lengths', async () => {
  const handler = createApiHandler({apiFactory:()=>{throw new Error('should not load');}});
  for (const options of [
    {body:'cookie='+'a'.repeat(65536)},
    {body:{cookie:'a'.repeat(65536)},parsed:true},
    {headers:{'content-length':'70000'}},
  ]) assert.equal((await invoke(handler,options)).status,413);
  assert.equal((await invoke(handler,{body:{cookie:['one','two']},parsed:true})).status,400);
});

test('accepts same-origin preview domains and retries failed cold initialization safely', async () => {
  let attempts = 0;
  const handler = createApiHandler({apiFactory:()=>{
    if (++attempts === 1) throw new Error('private initialization detail');
    return async()=>({status:200,body:{code:200}});
  }});
  const options = {headers:{origin:'https://preview.vercel.app',host:'preview.vercel.app'}};
  const failed = await invoke(handler,options);
  assert.equal(failed.status,500);
  assert(!failed.text.includes('private'));
  assert.equal((await invoke(handler,options)).status,200);
});

test('actual function entry handles HTTP health and QR generation without a companion server', async t => {
  const { default: handler } = await import('../api/gateway.js');
  const server = http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/healthz`)).status,200);
  const qr = await fetch(`${base}/api/login/qr/create`,{method:'POST',body:new URLSearchParams({key:'lumen-test-key',qrimg:'1'})});
  assert.equal(qr.status,200);
  const body=await qr.json();
  assert.match(body.data.qrimg,/^data:image\/png;base64,/);
  assert.equal(new URL(body.data.qrurl).searchParams.get('codekey'),'lumen-test-key');
});
