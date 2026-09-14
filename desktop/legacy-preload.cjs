const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('legacyTransfer',{
 file:value=>ipcRenderer.invoke('lumen:legacy-file',value),
 finish:value=>ipcRenderer.invoke('lumen:legacy-finish',value),
});
