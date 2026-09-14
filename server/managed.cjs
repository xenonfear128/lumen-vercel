const { randomUUID } = require('node:crypto');
const { createDatabase } = require('./database.cjs');
const { hash, token, equal, fail, passwordHash, checkPassword, encrypt, decrypt, encryptionKey } = require('./security.cjs');
const { synchronize } = require('./sync.cjs');
const SESSION_SECONDS = 14 * 86400;
const userView = u => u ? { id:u.id, username:u.username, role:u.role, disabled:u.disabled } : null;
const sourceView = s => ({ enabled:s.enabled, status:s.status, account:s.account, checkedAt:s.checked_at });
const csrfFor = raw => hash(`csrf:${raw}`);
function cookies(header) {
  return Object.fromEntries(String(header || '').split(';').map(part => { const i=part.indexOf('='); return [part.slice(0,i).trim(),part.slice(i+1).trim()]; }));
}
async function readJson(req) {
  const type = req.headers['content-type']?.split(';')[0].trim();
  if (type !== 'application/json') fail('CONTENT_TYPE',415);
  let body=req.body;
  if (Number(req.headers['content-length'])>1048576) fail('BODY_TOO_LARGE',413);
  if (body===undefined) {
    const chunks=[];let size=0;
    for await (const chunk of req) { size+=Buffer.byteLength(chunk);if(size>1048576) fail('BODY_TOO_LARGE',413);chunks.push(Buffer.from(chunk)); }
    body=Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(body)||typeof body==='string') {
    if(Buffer.byteLength(body)>1048576) fail('BODY_TOO_LARGE',413);
    try {body=JSON.parse(body.toString());} catch {fail('JSON_INVALID');}
  }
  if (!body||Array.isArray(body)||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>1048576) fail('JSON_INVALID');
  return body;
}
function createManaged({ db=createDatabase(), api, config=process.env }={}) {
  function ready() { if(!db) fail('DATABASE_UNAVAILABLE',503); }
  async function limit(key,max) {
    ready(); const bucket=Math.floor(Date.now()/60000);
    const r=await db.query('INSERT INTO lumen_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key,bucket) DO UPDATE SET count=lumen_limits.count+1 RETURNING count',[hash(key),bucket]);
    if(r.rows[0].count>max) fail('RATE_LIMITED',429);
    if(Math.random()<0.01) {
      await db.query('DELETE FROM lumen_limits WHERE bucket<$1',[bucket-60]);
      await db.query("DELETE FROM lumen_failures WHERE created_at < now()-interval '7 days'");
      await db.query('DELETE FROM lumen_sessions WHERE expires_at<now()');
    }
  }
  async function session(req) {
    if(!db) return null;
    const raw=cookies(req.headers.cookie).lumen_session;
    if(!raw||raw.length>100) return null;
    const u=(await db.query('SELECT u.*,s.hash AS session_hash FROM lumen_sessions s JOIN lumen_users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now() AND NOT u.disabled',[hash(raw)])).rows[0];
    return u ? {...u,csrf:csrfFor(raw)} : null;
  }
  async function requireUser(req) {
    ready();const u=await session(req);
    if(!u || (req.headers['x-lumen-user'] && req.headers['x-lumen-user']!==u.id)) fail('AUTH_REQUIRED',401);
    return u;
  }
  async function issue(tx,userId,res) {
    const raw=token();await tx.query('INSERT INTO lumen_sessions(hash,user_id,expires_at) VALUES($1,$2,$3)',[hash(raw),userId,new Date(Date.now()+SESSION_SECONDS*1000)]);
    const secure=config.VERCEL ? true : config.LUMEN_COOKIE_SECURE==='false' ? false : config.LUMEN_COOKIE_SECURE==='true'||config.NODE_ENV==='production';
    res.setHeader('Set-Cookie',`lumen_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure?'; Secure':''}`);
    return csrfFor(raw);
  }
  function origin(req) {
    if(req.headers['sec-fetch-site']==='cross-site') fail('CSRF_REJECTED',403);
    if(req.headers.origin) {
      let url;try{url=new URL(req.headers.origin);}catch{fail('CSRF_REJECTED',403);}
      if(!['https:','http:'].includes(url.protocol)||url.host!==req.headers.host) fail('CSRF_REJECTED',403);
    }
  }
  async function source() {return (await db.query('SELECT * FROM lumen_source WHERE id=1')).rows[0];}
  async function upstream(path,params) {
    let result;try{result=await api(path,params);}catch{fail('SOURCE_UNAVAILABLE',502);}
    if(result?.status!==200||!result.body) fail('SOURCE_UNAVAILABLE',502);
    return result.body;
  }
  async function inspect(cookie) {
    const result=await upstream('/login/status',{cookie});
    if(result.data?.code!==200) fail('SOURCE_UNAVAILABLE',502);
    const profile=result.data?.profile;
    if(!profile?.userId) fail('SOURCE_EXPIRED',503);
    return {id:profile.userId,nickname:typeof profile.nickname==='string'?profile.nickname.slice(0,200):''};
  }
  async function failure(error,s) {
    await db.query('INSERT INTO lumen_failures(kind) VALUES($1)',[error.code==='SOURCE_EXPIRED'?'expired':'upstream']);
    if(error.code==='SOURCE_EXPIRED'&&s) await db.query("UPDATE lumen_source SET status='expired',checked_at=now() WHERE id=1 AND version=$1",[s.version]);
    throw error;
  }
  async function playback(req,params) {
    const u=await requireUser(req);origin(req);
    // The form endpoint is retained, but a CSRF token is required for website playback.
    if(!equal(req.headers['x-lumen-csrf']||'',u.csrf)) fail('CSRF_REJECTED',403);
    if(!/^[1-9]\d{0,15}$/.test(String(params.id||''))||!['standard','exhigh','lossless','hires'].includes(params.level)) fail('PLAYBACK_INVALID');
    const configuredLimit=Number(config.LUMEN_PLAYBACK_LIMIT||30);
    await limit(`play:${u.id}`,Number.isInteger(configuredLimit)&&configuredLimit>0?configuredLimit:30);
    const s=await source();
    if(!s.credential) fail('SOURCE_UNCONFIGURED',503);
    if(!s.enabled) fail('SOURCE_DISABLED',503);
    if(s.status==='expired') fail('SOURCE_EXPIRED',503);
    let cookie;try{cookie=decrypt(s.credential,config.LUMEN_CREDENTIAL_KEY);}catch{fail('SOURCE_KEY_MISSING',503);}
    try {
      if(!s.checked_at||Date.now()-new Date(s.checked_at).getTime()>300000) {
        await inspect(cookie);await db.query("UPDATE lumen_source SET status='ready',checked_at=now() WHERE id=1 AND version=$1",[s.version]);
      }
      const body=await upstream('/song/url/v1',{cookie,id:params.id,level:params.level});
      if(body.code!==200||!Array.isArray(body.data)) fail('SOURCE_UNAVAILABLE',502);
      const song=body.data.find(item=>String(item.id)===String(params.id));
      if(!song?.url) {await inspect(cookie);return {code:200,data:[{id:Number(params.id),url:null}],reason:'TRACK_UNAVAILABLE'};}
      // Never relay cookie or account properties from the SDK envelope.
      return {code:200,data:[{id:Number(params.id),url:song.url,level:song.level}]};
    } catch(error) {return failure(error,s);}
  }
  async function action(path,body,req,res) {
    if(path==='/auth/session') {
      if(!db)return {configured:false,initialized:false,user:null,csrf:null};
      const u=await session(req);const initialized=(await db.query('SELECT initialized FROM lumen_system WHERE id=1')).rows[0]?.initialized;
      return {configured:true,initialized:!!initialized,user:userView(u),csrf:u?.csrf||null};
    }
    ready();
    const ip = config.VERCEL ? req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown' : req.socket?.remoteAddress || 'unknown';
    if(['/auth/setup','/auth/register','/auth/login','/auth/reset'].includes(path)) {
      const configured = Number(path==='/auth/login' ? config.LUMEN_LOGIN_LIMIT||20 : config.LUMEN_REGISTRATION_LIMIT||5);
      await limit(`auth-ip:${path}:${ip}`, Number.isInteger(configured)&&configured>0 ? configured : 5);
      if(body.username) await limit(`auth-name:${String(body.username).toLowerCase()}`,10);
      const username=String(body.username||'').trim().toLowerCase();
      if(path!=='/auth/reset'&&!/^[a-z0-9_]{3,32}$/.test(username)) fail('USERNAME_INVALID');
      if(path==='/auth/login') {
        const u=(await db.query('SELECT * FROM lumen_users WHERE username=$1',[username])).rows[0];
        // A fixed dummy hash gives unknown names the same scrypt cost.
        const dummy='scrypt:00000000000000000000000000000000:'+'0'.repeat(128);
        if(!await checkPassword(body.password,u?.password_hash||dummy)||!u||u.disabled) fail('LOGIN_INVALID',401);
        return db.transaction(async tx=>{
          const locked=(await tx.query('SELECT * FROM lumen_users WHERE id=$1 FOR UPDATE',[u.id])).rows[0];
          if(locked.disabled||locked.password_hash!==u.password_hash) fail('LOGIN_INVALID',401);
          return {user:userView(locked),csrf:await issue(tx,u.id,res)};
        });
      }
      if(path==='/auth/setup'&&(!config.LUMEN_SETUP_TOKEN||!equal(body.setupToken||'',config.LUMEN_SETUP_TOKEN))) fail('SETUP_DENIED',403);
      const password=await passwordHash(body.password);
      return db.transaction(async tx=>{
        if(path==='/auth/reset') {
          const reset=(await tx.query('DELETE FROM lumen_resets WHERE hash=$1 AND expires_at>now() RETURNING user_id',[hash(body.resetToken||'')])).rows[0];
          if(!reset) fail('RESET_INVALID');
          await tx.query('UPDATE lumen_users SET password_hash=$2 WHERE id=$1',[reset.user_id,password]);
          await tx.query('DELETE FROM lumen_sessions WHERE user_id=$1',[reset.user_id]);
          return {ok:true};
        }
        if(path==='/auth/setup') {
          const state=(await tx.query('SELECT initialized FROM lumen_system WHERE id=1 FOR UPDATE')).rows[0];
          if(state.initialized) fail('SETUP_CLOSED',409);
        } else {
          const invite=(await tx.query('SELECT * FROM lumen_invites WHERE hash=$1 FOR UPDATE',[hash(body.invite||'')])).rows[0];
          if(!invite||invite.revoked||invite.used_by||new Date(invite.expires_at)<=new Date()) fail('INVITE_INVALID');
        }
        const u={id:randomUUID(),username,role:path==='/auth/setup'?'admin':'user',disabled:false};
        try{await tx.query('INSERT INTO lumen_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',[u.id,username,password,u.role]);}
        catch(e){if(e.code==='23505')fail('USERNAME_TAKEN',409);throw e;}
        if(path==='/auth/setup')await tx.query('UPDATE lumen_system SET initialized=true WHERE id=1');
        else await tx.query('UPDATE lumen_invites SET used_by=$2 WHERE hash=$1',[hash(body.invite),u.id]);
        return {user:userView(u),csrf:await issue(tx,u.id,res)};
      });
    }
    const u=await requireUser(req);
    if(req.method!=='GET'&&!equal(req.headers['x-lumen-csrf']||'',u.csrf)) fail('CSRF_REJECTED',403);
    if(path==='/auth/logout') {
      await db.query('DELETE FROM lumen_sessions WHERE hash=$1',[u.session_hash]);
      await db.query('UPDATE lumen_source SET qr_generation=NULL,qr_key=NULL,qr_owner=NULL WHERE qr_owner=$1',[u.session_hash]);
      res.setHeader('Set-Cookie','lumen_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return {ok:true};
    }
    if(path==='/auth/password') {
      if(!await checkPassword(body.currentPassword,u.password_hash))fail('LOGIN_INVALID',401);
      const password=await passwordHash(body.password);
      await db.transaction(async tx=>{
        const result=await tx.query('UPDATE lumen_users SET password_hash=$2 WHERE id=$1 AND password_hash=$3 RETURNING id',[u.id,password,u.password_hash]);
        if(!result.rows.length)fail('LOGIN_INVALID',401);
        await tx.query('DELETE FROM lumen_sessions WHERE user_id=$1',[u.id]);
      });return {ok:true};
    }
    if(path==='/sync/exchange') {await limit(`sync:${u.id}`,120);return synchronize(db,u.id,body);}
    if(u.role!=='admin')fail('ADMIN_REQUIRED',403);
    if(path==='/admin/status') {
      const s=await source();const failures=Number((await db.query("SELECT count(*) AS count FROM lumen_failures WHERE created_at>now()-interval '24 hours'")).rows[0].count);
      return {database:'ready',source:sourceView(s),failures};
    }
    if(path==='/admin/users')return {users:(await db.query('SELECT id,username,role,disabled,created_at FROM lumen_users ORDER BY created_at')).rows};
    if(path==='/admin/users/update') {
      if(typeof body.disabled!=='boolean')fail('USER_INVALID');
      await db.transaction(async tx=>{
        await tx.query('SELECT id FROM lumen_system WHERE id=1 FOR UPDATE');
        const target=(await tx.query('SELECT * FROM lumen_users WHERE id=$1 FOR UPDATE',[body.id])).rows[0];
        if(!target)fail('USER_INVALID');
        if(body.disabled&&target.role==='admin'&&!target.disabled) {
          const count=Number((await tx.query("SELECT count(*) AS count FROM lumen_users WHERE role='admin' AND NOT disabled")).rows[0].count);
          if(count<=1)fail('LAST_ADMIN',409);
        }
        await tx.query('UPDATE lumen_users SET disabled=$2 WHERE id=$1',[body.id,body.disabled]);
        if(body.disabled)await tx.query('DELETE FROM lumen_sessions WHERE user_id=$1',[body.id]);
      });return {ok:true};
    }
    if(path==='/admin/users/reset') {
      const raw=token();await db.transaction(async tx=>{
        if(!(await tx.query('SELECT id FROM lumen_users WHERE id=$1 FOR UPDATE',[body.id])).rows.length)fail('USER_INVALID');
        await tx.query('DELETE FROM lumen_resets WHERE user_id=$1',[body.id]);
        await tx.query("INSERT INTO lumen_resets(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hash(raw),body.id]);
        await tx.query('DELETE FROM lumen_sessions WHERE user_id=$1',[body.id]);
      });return {resetToken:raw};
    }
    if(path==='/admin/invites')return {invites:(await db.query('SELECT id,expires_at,used_by,revoked,created_at FROM lumen_invites ORDER BY created_at DESC LIMIT 200')).rows};
    if(path==='/admin/invites/create') {
      const raw=token();await db.query("INSERT INTO lumen_invites(id,hash,expires_at) VALUES($1,$2,now()+interval '7 days')",[randomUUID(),hash(raw)]);return {invite:raw};
    }
    if(path==='/admin/invites/revoke'){await db.query('UPDATE lumen_invites SET revoked=true WHERE id=$1',[body.id]);return {ok:true};}
    if(path==='/admin/source/start') {
      encryptionKey(config.LUMEN_CREDENTIAL_KEY);
      await limit(`qr:${u.id}`,10);
      const generation=randomUUID();
      await db.query("UPDATE lumen_source SET qr_generation=$1,qr_key=NULL,qr_owner=$2,qr_expires_at=now()+interval '5 minutes' WHERE id=1",[generation,u.session_hash]);
      const keyResult=await upstream('/login/qr/key',{});const key=keyResult.data?.unikey;
      if(!key)fail('SOURCE_UNAVAILABLE',502);
      const img=await upstream('/login/qr/create',{key,qrimg:'true'});
      if(!img.data?.qrimg)fail('SOURCE_UNAVAILABLE',502);
      const r=await db.query('UPDATE lumen_source SET qr_key=$2 WHERE id=1 AND qr_generation=$1 RETURNING id',[generation,key]);
      if(!r.rows.length)fail('QR_STALE',409);
      return {generation,image:img.data.qrimg};
    }
    if(path==='/admin/source/cancel') {
      await db.query('UPDATE lumen_source SET qr_generation=NULL,qr_key=NULL,qr_owner=NULL WHERE id=1 AND qr_generation=$1 AND qr_owner=$2',[body.generation,u.session_hash]);return {ok:true};
    }
    if(path==='/admin/source/poll') {
      await limit(`qr-poll:${u.id}`,40);
      const s=await source();
      if(s.qr_generation!==body.generation||s.qr_owner!==u.session_hash)fail('QR_STALE',409);
      if(!s.qr_key||new Date(s.qr_expires_at)<=new Date())return {state:'expired'};
      const r=await upstream('/login/qr/check',{key:s.qr_key});
      if([800,801,802].includes(r.code))return {state:{800:'expired',801:'waiting',802:'scanned'}[r.code]};
      if(r.code!==803||typeof r.cookie!=='string'||!r.cookie.trim())fail('SOURCE_UNAVAILABLE',502);
      const account=await inspect(r.cookie);const credential=encrypt(r.cookie,config.LUMEN_CREDENTIAL_KEY);
      const result=await db.query("UPDATE lumen_source SET credential=$1,account=$2,enabled=true,status='ready',checked_at=now(),version=version+1,qr_generation=NULL,qr_key=NULL,qr_owner=NULL WHERE id=1 AND qr_generation=$3 AND qr_owner=$4 AND qr_expires_at>now() AND EXISTS(SELECT 1 FROM lumen_sessions s JOIN lumen_users u ON u.id=s.user_id WHERE s.hash=$4 AND s.expires_at>now() AND NOT u.disabled AND u.role='admin') RETURNING id",[credential,account,body.generation,u.session_hash]);
      if(!result.rows.length)fail('QR_STALE',409);
      return {state:'success',account};
    }
    if(path==='/admin/source/check') {
      const s=await source();if(!s.credential)fail('SOURCE_UNCONFIGURED',503);
      try {
        const account=await inspect(decrypt(s.credential,config.LUMEN_CREDENTIAL_KEY));
        await db.query("UPDATE lumen_source SET account=$1,status='ready',checked_at=now() WHERE id=1 AND version=$2",[account,s.version]);
        return {source:sourceView(await source())};
      }catch(e){return failure(e,s);}
    }
    if(path==='/admin/source/toggle') {
      if(typeof body.enabled!=='boolean')fail('SOURCE_INVALID');
      await db.query('UPDATE lumen_source SET enabled=$1,version=version+1,qr_generation=NULL,qr_key=NULL,qr_owner=NULL WHERE id=1',[body.enabled]);return {ok:true};
    }
    if(path==='/admin/source/remove') {
      await db.query("UPDATE lumen_source SET credential=NULL,account=NULL,enabled=false,status='unconfigured',version=version+1,qr_generation=NULL,qr_key=NULL,qr_owner=NULL WHERE id=1");return {ok:true};
    }
    fail('NOT_FOUND',404);
  }
  const getRoutes=new Set(['/auth/session','/admin/status','/admin/users','/admin/invites']);
  async function handle(req,res,pathname) {
    const path=pathname.slice(4);
    if(!/^\/(auth|admin|sync)\//.test(path))return false;
    const respond=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    try {
      const method=getRoutes.has(path)?'GET':'POST';
      if(req.method!==method){res.setHeader('Allow',method);fail('METHOD_NOT_ALLOWED',405);}
      origin(req);
      if(method==='POST'&&req.headers['x-lumen-request']!=='1')fail('CSRF_REJECTED',403);
      respond(200,await action(path,method==='GET'?{}:await readJson(req),req,res));
    }catch(e){respond(e.status||503,{code:e.status||503,error:e.status?e.code:'DATABASE_UNAVAILABLE'});}
    return true;
  }
  return {handle,playback,session,db};
}
module.exports = { createManaged };
