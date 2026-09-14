const ORIGIN = 'https://lumen.rupa.best';
const JSON_ROUTES = new Set(['/auth/login','/auth/session','/auth/logout','/auth/password','/sync/exchange','/client/capabilities']);
const MUSIC_ROUTES = new Set(['/cloudsearch','/song/url/v1','/playlist/detail','/song/detail','/user/playlist','/login/qr/key','/login/qr/create','/login/qr/check','/login/status','/logout']);
function mediaUrl(value) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!(/(^|\.)music\.126\.net$/.test(u.hostname)))throw Error('MEDIA_HOST_DENIED');
  return u.href;
}
function createTransport(vault,fetcher=fetch) {
  let generation=0, compatibleUntil=0;
  return async function request({path,body,music=false,expectedUser}) {
    if(!(music?MUSIC_ROUTES:JSON_ROUTES).has(path))throw Error('CLIENT_ROUTE_DENIED');
    const seq=path==='/auth/login'||path==='/auth/logout'?++generation:generation;
    const token=vault.get('token');
    if(path==='/auth/session'&&!token)return {status:200,body:{configured:true,initialized:true,user:null,csrf:null}};
    if(path!=='/client/capabilities' && path!=='/auth/logout' && compatibleUntil<Date.now()) {
      const r=await fetcher(ORIGIN+'/api/client/capabilities',{redirect:'error',signal:AbortSignal.timeout(25000)});
      if(!r.ok)throw Error('CLIENT_UPDATE_REQUIRED');const cap=await r.json();
      if(!Number.isInteger(cap.minProtocol)||!Number.isInteger(cap.protocol)||cap.minProtocol>1||cap.protocol<1)throw Error('CLIENT_UPDATE_REQUIRED');compatibleUntil=Date.now()+300000;
    }
    if(expectedUser&&vault.get('user')?.id!==expectedUser)throw Error('AUTH_REQUIRED');
    if(seq!==generation)throw Error('AUTH_REQUIRED');
    const headers={'X-Lumen-Request':'1',...(token?{Authorization:`Bearer ${token}`}:{})};
    let payload=body;
    if(music){payload={...body};delete payload.cookie;if(path!=='/song/url/v1'&&vault.get('personal'))payload.cookie=vault.get('personal');}
    const endpoint=!music&&path.startsWith('/auth/')?'/client'+path:path;
    if(body!==undefined)headers['Content-Type']=music?'application/x-www-form-urlencoded':'application/json';
    if(expectedUser)headers['X-Lumen-User']=expectedUser;
    let response;
    try { response=await fetcher(ORIGIN+'/api'+endpoint,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:music?new URLSearchParams(payload):JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(25000)}); }
    catch {if(seq===generation&&path==='/auth/logout'){vault.set('token',null);vault.set('user',null);vault.set('personal',null);}throw Error('NETWORK_UNAVAILABLE');}
    const result=await response.json();
    if(seq!==generation)throw Error('AUTH_REQUIRED');
    if(response.status===401&&path!=='/auth/login'){vault.set('token',null);vault.set('user',null);vault.set('personal',null);}
    if(response.ok&&path==='/auth/login'){if(typeof result.token!=='string'||typeof result.user?.id!=='string')throw Error('AUTH_RESPONSE_INVALID');vault.set('token',result.token);vault.set('user',result.user);vault.set('personal',null);delete result.token;result.csrf=null;}
    if(response.ok&&path==='/auth/session')vault.set('user',result.user);
    if(response.ok&&(path==='/auth/logout'||path==='/auth/password')){generation++;vault.set('token',null);vault.set('user',null);vault.set('personal',null);}
    if(music&&path==='/login/qr/check'&&result.code===803){vault.set('personal',result.cookie);result.cookie='native-managed';}
    if(music&&path==='/logout')vault.set('personal',null);
    if(response.status===401&&path==='/auth/session')return {status:200,body:{configured:true,initialized:true,user:null,csrf:null}};
    return {status:response.status,body:result};
  };
}
module.exports={ORIGIN,createTransport,mediaUrl};
