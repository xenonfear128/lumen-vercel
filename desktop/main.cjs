const { app, BrowserWindow, dialog, Menu, Tray, session, protocol, net, ipcMain, safeStorage, powerMonitor, shell } = require('electron');
const { join, resolve, relative, extname, basename, sep } = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createTransport, mediaUrl, ORIGIN } = require('./cloud.cjs');
const { createRepository } = require('./repository.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'lumen',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
let window, tray, repo, stopping=false;
const grants=new Map();
const extensions=new Set(['.mp3','.flac','.wav','.ogg','.opus','.m4a','.aac','.aiff','.aif','.wma','.webm']);
if(process.env.LUMEN_TEST_USER_DATA)app.setPath('userData',process.env.LUMEN_TEST_USER_DATA);
app.setAppUserModelId('app.lumen.player');
function scope(){return repo.vault.get('user')?.id || 'guest';}
function grant(value){const id=randomUUID();grants.set(id,{url:mediaUrl(String(value).replace(/^http:/i,'https:')),scope:scope(),expires:Date.now()+3600000});for(const [k,g] of grants)if(g.expires<Date.now())grants.delete(k);return `lumen://app/media/${id}`;}
function trusted(event){if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame.url.startsWith('lumen://app/'))throw Error('CLIENT_FRAME_DENIED');}
function bind(name,handler){ipcMain.handle('lumen:'+name,(event,args)=>{trusted(event);return handler(args);});}
function checkScope(value){if(value!==scope())throw Error('AUTH_REQUIRED');}
async function localResponse(path,request){
  const stat=await fs.stat(path);if(!stat.isFile())return new Response(null,{status:404});
  let start=0,end=stat.size-1,status=200;
  const range=request.headers.get('range');
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416});
    if(!m[1])start=Math.max(0,stat.size-Number(m[2]));else start=Number(m[1]);
    if(m[1]&&m[2])end=Math.min(end,Number(m[2]));
    if(start>end||start>=stat.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});status=206;
  }
  const mime={'.mp3':'audio/mpeg','.wav':'audio/wav','.flac':'audio/flac','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.opus':'audio/ogg','.webm':'audio/webm'}[extname(path).toLowerCase()]||'application/octet-stream';
  const headers={'Content-Type':mime,'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'no-store'};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(path,{start,end})),{status,headers});
}
async function resource(request){
  try{
    const url=new URL(request.url);if(url.host!=='app'||!['GET','HEAD'].includes(request.method))return new Response(null,{status:403});
    if(url.pathname.startsWith('/media/')){
      const g=grants.get(url.pathname.slice(7));if(!g||g.scope!==scope()||g.expires<Date.now())return new Response(null,{status:403});
      let target=g.url;
      for(let n=0;n<4;n++){
        const r=await net.fetch(target,{method:request.method,credentials:'omit',redirect:'manual',headers:request.headers.has('range')?{Range:request.headers.get('range')}: {}});
        if(r.status>=300&&r.status<400){target=mediaUrl(new URL(r.headers.get('location'),target).href);await r.body?.cancel();continue;}
        const headers=new Headers();for(const k of ['content-type','content-length','content-range','accept-ranges'])if(r.headers.has(k))headers.set(k,r.headers.get(k));headers.set('Cache-Control','no-store');
        return new Response(r.body,{status:r.status,headers});
      }return new Response(null,{status:502});
    }
    if(url.pathname.startsWith('/file/')){
      const id=url.pathname.slice(6);const row=repo.db.prepare('SELECT path FROM files WHERE id=? AND scope=?').get(id,scope());
      if(!row)return new Response(null,{status:404});return await localResponse(row.path,request);
    }
    const root=resolve(__dirname,'../dist');const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    const rel=relative(root,path);if(rel.startsWith('..'+sep)||rel==='..'||resolve(path)===root)return new Response(null,{status:403});
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'}[extname(path)];
    if(!mime)return new Response(null,{status:404});
    return new Response(request.method==='HEAD'?null:await fs.readFile(path),{headers:{'Content-Type':mime,'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.music.126.net https://*.music.163.com; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'"}});
  }catch{return new Response(null,{status:404});}
}
async function choose({scope:owner,folder=false,relink}={}){
  checkScope(owner);if(relink&&(typeof relink!=='string'||relink.length>200))throw Error('FILE_INVALID');
  const selected=await dialog.showOpenDialog(window,{properties:folder?['openDirectory']:relink?['openFile']:['openFile','multiSelections'],filters:[{name:'Audio',extensions:[...extensions].map(x=>x.slice(1))}]});
  checkScope(owner);if(selected.canceled)return {tracks:[]};
  let paths=[];
  async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(paths.length>=10000)throw Error('FILE_LIMIT');const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()&&extensions.has(extname(p).toLowerCase()))paths.push(p);}}
  if(folder)await walk(selected.filePaths[0]);else paths=selected.filePaths.filter(p=>extensions.has(extname(p).toLowerCase()));
  paths.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const tracks=[];
  for(const p of paths){checkScope(owner);const id=relink||randomUUID();repo.db.prepare('INSERT INTO files VALUES(?,?,?) ON CONFLICT(id,scope) DO UPDATE SET path=excluded.path WHERE files.scope=excluded.scope').run(id,owner,p);
    let info={};try{info=await (await import(pathToFileURL(join(__dirname,'metadata.mjs')).href)).metadata(p);}catch{}
    tracks.push({id:randomUUID(),localFileId:id,source:'local',file:null,localUrl:`lumen://app/file/${id}`,neteaseId:null,path:'',fileName:basename(p),title:basename(p,extname(p)),artist:null,album:null,year:null,genre:null,duration:null,codec:extname(p).slice(1),bitrate:null,sampleRate:null,coverUrl:null,fallbackCover:0,metaLoaded:false,...info,title:info.title||basename(p,extname(p))});}
  return {tracks,name:folder?basename(selected.filePaths[0]):undefined};
}
function menu(){return Menu.buildFromTemplate([{label:'Lumen',submenu:[{label:'Show / 显示 / 表示',click:()=>{window.show();window.focus();}},{label:'Close to tray / 关闭后后台播放 / 閉じても再生',type:'checkbox',checked:repo.snapshot()['lumen.closeToTray']!=='false',click:item=>repo.set('lumen.closeToTray',String(item.checked))},{label:'Downloads / 下载 / ダウンロード',click:()=>shell.openExternal(ORIGIN+'/downloads')},{type:'separator'},{label:'Quit / 退出 / 終了',click:()=>app.quit()}]},{role:'editMenu'},{role:'windowMenu'}]);}
async function start(){
  await fs.mkdir(app.getPath('userData'),{recursive:true});repo=createRepository(join(app.getPath('userData'),'client.sqlite'),safeStorage);
  const request=createTransport(repo.vault);
  protocol.handle('lumen',resource);
  session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  let migrating=false;bind('migrate',async()=>{if(migrating)throw Error('MIGRATION_BUSY');migrating=true;try{return await require('./legacy.cjs').migrateLegacy(window,repo,app.getPath('userData'));}finally{migrating=false;}});
  bind('bootstrap',()=>({values:repo.snapshot(),user:repo.vault.get('user'),version:app.getVersion()}));
  bind('request',async args=>{if(['/auth/login','/auth/logout','/auth/password'].includes(args.path))window.webContents.send('lumen:suspend');const previous=scope();const result=await request(args);if(previous!==scope()){grants.clear();window.webContents.send('lumen:suspend');}if(args.music&&args.path==='/song/url/v1'&&result.status===200)for(const item of result.body.data||[])if(item.url)item.url=grant(item.url);return result;});
  ipcMain.on('lumen:store',(event,args)=>{try{trusted(event);if(args.value===null)repo.remove(args.key);else repo.set(args.key,args.value);event.returnValue={ok:true};}catch{event.returnValue={error:'STORAGE_UNAVAILABLE'};}});
  bind('pick',choose);
  bind('files',async args=>{checkScope(args.scope);if(!Array.isArray(args.ids)||args.ids.length>20000)throw Error('FILE_INVALID');const result={};for(const id of args.ids){if(args.importGuest)repo.db.prepare('INSERT OR IGNORE INTO files SELECT id,?,path FROM files WHERE id=? AND scope=?').run(args.scope,id,'guest');const row=repo.db.prepare('SELECT path FROM files WHERE id=? AND scope=?').get(id,args.scope);if(row){if(args.remove)repo.db.prepare('DELETE FROM files WHERE id=? AND scope=?').run(id,args.scope);else try{await fs.access(row.path);result[id]=`lumen://app/file/${id}`;}catch{}}}checkScope(args.scope);return result;});
  bind('external',path=>{if(!['/','/admin','/downloads','/?account=register','/?account=reset'].includes(path))throw Error('CLIENT_ROUTE_DENIED');return shell.openExternal(ORIGIN+path);});
  bind('settings',args=>{if(args?.closeToTray!==undefined)repo.set('lumen.closeToTray',String(!!args.closeToTray));return {closeToTray:repo.snapshot()['lumen.closeToTray']!=='false'};});
  window=new BrowserWindow({width:1440,height:900,minWidth:800,minHeight:560,show:false,title:'Lumen',backgroundColor:'#121211',icon:join(__dirname,'../build/icon.png'),webPreferences:{preload:join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('lumen://app/'))e.preventDefault();});
  window.on('close',e=>{if(!stopping&&repo.snapshot()['lumen.closeToTray']!=='false'){e.preventDefault();window.hide();}});
  Menu.setApplicationMenu(menu());tray=new Tray(join(__dirname,'../build/icon.png'));tray.setToolTip('Lumen');tray.setContextMenu(menu());tray.on('click',()=>window.show());
  powerMonitor.on('suspend',()=>window.webContents.send('lumen:suspend'));
  window.once('ready-to-show',()=>{if(!process.env.LUMEN_TEST_HEADLESS)window.show();});await window.loadURL('lumen://app/');
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{window?.show();window?.focus();});app.on('activate',()=>window?.show());app.on('window-all-closed',()=>{if(stopping||repo?.snapshot()['lumen.closeToTray']==='false')app.quit();});
 app.on('before-quit',event=>{if(!stopping&&window&&!window.isDestroyed()){event.preventDefault();stopping=true;window.webContents.send('lumen:suspend');window.webContents.executeJavaScript("window.dispatchEvent(new Event('pagehide'))").finally(()=>app.quit());}});
 app.on('will-quit',()=>repo?.db.close());app.whenReady().then(start).catch(()=>{dialog.showErrorBox('Lumen','Client startup failed / 客户端启动失败 / 起動できません');app.quit();});
}
