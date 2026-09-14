import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const project=`lumen-test-${process.pid}`;
const directory=await mkdtemp(join(tmpdir(),'lumen-compose-'));
const override=join(directory,'override.yaml');
await writeFile(override,`services:\n  lumen:\n    image: lumen:validation\n    environment:\n      LUMEN_COOKIE_SECURE: "false"\n  migrate:\n    image: lumen:validation\n`);
const env={...process.env,POSTGRES_PASSWORD:randomBytes(24).toString('hex'),LUMEN_CREDENTIAL_KEY:randomBytes(32).toString('base64'),LUMEN_SETUP_TOKEN:randomBytes(24).toString('hex'),LUMEN_PORT:'18086',LUMEN_BIND_ADDRESS:'127.0.0.1',LUMEN_AUTH_USER:'',LUMEN_AUTH_PASSWORD:''};
const args=['compose','--project-name',project,'--project-directory',process.cwd(),'-f',resolve('compose.yaml'),'-f',override];
function docker(rest,allowFailure=false){const r=spawnSync('docker',[...args,...rest],{env,encoding:'utf8',timeout:600000});if(r.status!==0&&!allowFailure)throw new Error(`Docker ${rest[0]} failed: ${(r.stderr||'').replaceAll(env.POSTGRES_PASSWORD,'[redacted]').replaceAll(env.LUMEN_SETUP_TOKEN,'[redacted]').replaceAll(env.LUMEN_CREDENTIAL_KEY,'[redacted]')}`);return r;}
let cookie='',csrf='';
async function call(path,body){const r=await fetch(`http://127.0.0.1:18086/api${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Lumen-Request':'1','X-Lumen-CSRF':csrf},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];const data=await r.json();if(data.csrf)csrf=data.csrf;assert.equal(r.status,200,data.error);return data;}
try{
  docker(['up','-d','--build','--wait','--wait-timeout','180']);
  const created=await call('/auth/setup',{username:'container_admin',password:'container-fixture-password',setupToken:env.LUMEN_SETUP_TOKEN});
  await call('/sync/exchange',{cursor:0,operations:[{id:'container-op',type:'playlist.put',playlistId:'container-playlist',data:{name:'Survives restart',kind:'temp'}}]});
  docker(['restart','postgres','lumen']);
  let restored;
  for(let i=0;i<60;i++){
    try{restored=await call('/auth/session');if(restored.user)break;}catch{}
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal(restored?.user?.id,created.user.id);
  assert.equal((await call('/sync/exchange',{cursor:0,operations:[]})).snapshot.playlists[0].name,'Survives restart');
  console.log('PASS Linux containers: explicit migration, administrator session and playlists survive database/application restart');
}finally{
  // This project name is generated above solely for this test; never touch production volumes.
  docker(['down','--volumes','--remove-orphans'],true);
}
