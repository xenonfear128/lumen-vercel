import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import builder from '@vercel/node';
import utils from '@vercel/build-utils';

const root = process.cwd();
const testResultsRoot = process.env.TEST_RESULTS_DIR || resolve('test-results');
const entrypoint = 'api/gateway.js';
const files = { ...await utils.glob('api/**',root), ...await utils.glob('server/**',root),
  ...await utils.glob('package.json',root), ...await utils.glob('tsconfig.json',root) };
const result = await builder.build({files,entrypoint,workPath:root,config:{},
  meta:{skipDownload:true,runNpmInstallSet:new Set([resolve('package.json')])} });
assert.equal(result.output.runtime,'nodejs24.x');
const names = Object.keys(result.output.files).map(name => name.replaceAll('\\', '/'));
for (const name of ['server/api-handler.cjs','server/api.cjs','node_modules/@neteasecloudmusicapienhanced/api/module/login_qr_create.js']) {
  assert(names.includes(name), `Missing function dependency: ${name}`);
}
assert(!names.some(name=>/^node_modules\/(electron|electron-builder|react|@capacitor)\//.test(name)), 'Desktop/frontend dependencies must not enter the function');
await mkdir(testResultsRoot,{recursive:true});
const directory = await mkdtemp(resolve(testResultsRoot, 'vercel-bundle-'));
for (const [name,file] of Object.entries(result.output.files)) {
  const target=resolve(directory,name);
  const local=relative(directory,target);
  assert(!local.startsWith('..') && !isAbsolute(local),'Bundle paths must stay in the bundle directory');
  await mkdir(dirname(target),{recursive:true});
  await pipeline(file.toStream(),createWriteStream(target));
}
const smoke = `
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
const root=process.cwd();
registerHooks({resolve(specifier,context,next){
  const result=next(specifier,context);
  if(result.url.startsWith('file:')){
    const local=relative(root,fileURLToPath(result.url));
    if(local.startsWith('..')||isAbsolute(local))throw new Error('Dependency escaped the deployment bundle: '+specifier);
  }
  return result;
}});
const mod=await import(pathToFileURL(root+'/'+process.argv[2]));
const handler=typeof mod.default==='function'?mod.default:mod.default.default;
const server=http.createServer(handler);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/healthz')).status,200);
  const response=await fetch(base+'/api/login/qr/create',{method:'POST',body:new URLSearchParams({key:'bundle-test-key',qrimg:'1'})});
  assert.equal(response.status,200);
  assert.match((await response.json()).data.qrimg,/^data:image\\/png;base64,/);
  console.log('PASS isolated Vercel bundle: health, SDK initialization and QR PNG');
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
`;
await writeFile(join(directory,'bundle-smoke.mjs'),smoke);
const run=spawnSync(process.execPath,['bundle-smoke.mjs',result.output.handler],{cwd:directory,encoding:'utf8',timeout:45000});
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
assert.equal(run.status,0,'The isolated deployment bundle must run successfully');
await writeFile(join(testResultsRoot, 'vercel-bundle.json'),JSON.stringify({runtime:result.output.runtime,handler:result.output.handler,files:names.length,directory},null,2));
console.log(`PASS Vercel Node builder: ${names.length} deployment files`);
