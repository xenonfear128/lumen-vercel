const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lumenNative',{
 platform:process.platform,
 migrateLegacy:()=>ipcRenderer.invoke('lumen:migrate'),
 request:args=>ipcRenderer.invoke('lumen:request',args),
 bootstrap:()=>ipcRenderer.invoke('lumen:bootstrap'),
 store:args=>{const r=ipcRenderer.sendSync('lumen:store',args);if(!r.ok)throw Error(r.error);},
 pickFiles:args=>ipcRenderer.invoke('lumen:pick',args),
 files:args=>ipcRenderer.invoke('lumen:files',args),
 openExternal:path=>ipcRenderer.invoke('lumen:external',path),
 settings:args=>ipcRenderer.invoke('lumen:settings',args),
 onSuspend:callback=>{const listener=()=>callback();ipcRenderer.on('lumen:suspend',listener);return()=>ipcRenderer.removeListener('lumen:suspend',listener);},
});
