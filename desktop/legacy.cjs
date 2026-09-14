const {BrowserWindow,dialog,ipcMain,protocol}=require('electron');
const {join}=require('node:path');
const {mkdir,writeFile}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
// Read the previous Electron origin without opening a listening socket. Originals are untouched.
async function migrateLegacy(parent,repo,userData){
 if(repo.snapshot()['lumen.legacy.desktop.v1'])return {imported:false};
 const answer=await dialog.showMessageBox(parent,{type:'question',buttons:['Cancel / 取消 / キャンセル','Import / 导入 / 取り込む'],defaultId:0,cancelId:0,message:'Import old desktop library? / 导入旧版桌面资料？ / 旧版のライブラリを取り込みますか？',detail:'Original data and stored audio copies will be retained. / 原始资料与音频副本会保留。 / 元のデータと音声コピーは保持されます。'});
 if(answer.response!==1)return {imported:false};
 const id=randomUUID();let win,timer;
 const files=new Map();
 const html=`<!doctype html><meta charset="utf-8"><script>
 (async()=>{try{
 const raw=localStorage.getItem('lumen.library.v1');const library=raw?JSON.parse(raw):{playlists:JSON.parse(localStorage.getItem('lumen.online.v1')||'[]')};
 const ids=[...new Set((library.playlists||[]).flatMap(p=>p.tracks||[]).filter(t=>t.source==='local').map(t=>t.localFileId||t.id))];
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lumen-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 for(const id of ids){const file=await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null)});if(file instanceof Blob)await legacyTransfer.file({id,name:file.name||'Audio',bytes:await file.arrayBuffer()});}db.close();
 await legacyTransfer.finish({library,stats:JSON.parse(localStorage.getItem('lumen.stats.v1')||'null')});
 }catch{await legacyTransfer.finish({error:true})}})();
 </script>`;
 await protocol.handle('http',req=>new Response(req.url===`http://127.0.0.1:3000/legacy-${id}`?html:'',{status:req.url===`http://127.0.0.1:3000/legacy-${id}`?200:403,headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'"}}));
 try{return await new Promise((resolve,reject)=>{
 const valid=event=>event.sender===win?.webContents&&event.senderFrame===win.webContents.mainFrame;
 ipcMain.handle('lumen:legacy-file',async(event,value)=>{if(!valid(event)||typeof value.id!=='string'||value.id.length>200||!(value.bytes instanceof ArrayBuffer)||value.bytes.byteLength>1024*1024*1024)throw Error('MIGRATION_INVALID');
 const localId=randomUUID();const dir=join(userData,'legacy-files');await mkdir(dir,{recursive:true});const path=join(dir,localId+'.audio');await writeFile(path,Buffer.from(value.bytes));files.set(value.id,{localId,path});
 });
 ipcMain.handle('lumen:legacy-finish',(event,value)=>{if(!valid(event))throw Error('MIGRATION_INVALID');if(value.error){reject(Error('MIGRATION_FAILED'));return;}
 try{
  const {cloudTrack}=require('./legacy-sanitize.cjs');
  const existing=JSON.parse(repo.snapshot()['lumen.library.v1']||'{"playlists":[]}');
  if(!Array.isArray(value.library?.playlists))throw Error('MIGRATION_INVALID');
  const imported=value.library.playlists.filter(p=>p&&Array.isArray(p.tracks)).map(p=>({id:randomUUID(),name:String(p.name||'Imported').slice(0,200),kind:['folder','temp','netease'].includes(p.kind)?p.kind:'folder',neteaseId:p.neteaseId||null,tracks:p.tracks.map(t=>{const file=files.get(t.localFileId||t.id);return {...cloudTrack(t),id:randomUUID(),localFileId:file?.localId||randomUUID(),file:null,path:'',coverUrl:null};})}));
  repo.db.exec('BEGIN IMMEDIATE');try{for(const f of files.values())repo.db.prepare('INSERT INTO files VALUES(?,?,?)').run(f.localId,'guest',f.path);repo.set('lumen.library.v1',JSON.stringify({...existing,playlists:[...(existing.playlists||[]),...imported]}));if(value.stats&&!repo.snapshot()['lumen.stats.v1'])repo.set('lumen.stats.v1',JSON.stringify(value.stats));repo.set('lumen.legacy.desktop.v1','imported');repo.db.exec('COMMIT');}catch(e){repo.db.exec('ROLLBACK');throw e;}resolve({imported:true});
 }catch{reject(Error('MIGRATION_FAILED'));}
 });
 win=new BrowserWindow({show:false,webPreferences:{preload:join(__dirname,'legacy-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event)=>event.preventDefault());timer=setTimeout(()=>reject(Error('MIGRATION_TIMEOUT')),300000);void win.loadURL(`http://127.0.0.1:3000/legacy-${id}`).catch(reject);
 });}finally{clearTimeout(timer);win?.destroy();ipcMain.removeHandler('lumen:legacy-file');ipcMain.removeHandler('lumen:legacy-finish');protocol.unhandle('http');}
}
module.exports={migrateLegacy};
