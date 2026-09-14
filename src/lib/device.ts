import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SiteUser } from './siteApi';
import type { Track } from './types';
export interface NativeBridge {
  platform: string;
  migrateLegacy?():Promise<{imported:boolean}>;
  bootstrap(): Promise<{ values: Record<string,string>; user: SiteUser|null; version: string }>;
  request(args: {path:string;body?:unknown;music?:boolean;expectedUser?:string}): Promise<{status:number;body:any}>;
  store(args:{key:string;value:string|null}): void | Promise<void>;
  pickFiles(args:{scope:string;folder?:boolean;relink?:string}): Promise<{tracks:Track[];name?:string}>;
  files(args:{scope:string;ids:string[];remove?:boolean;importGuest?:boolean}): Promise<Record<string,string>>;
  openExternal(path:string): Promise<void>;
  settings(args?:{closeToTray?:boolean}): Promise<{closeToTray:boolean}>;
  player?(args:Record<string,unknown>):Promise<any>;
  onPlayer?(callback:(state:any)=>void):()=>void;
  onSuspend(callback:()=>void): ()=>void;
}
declare global { interface Window { lumenNative?:NativeBridge } }
const plugin = registerPlugin<any>('LumenDevice');
function listen(name:string,callback:(data:any)=>void){let gone=false;const handle=plugin.addListener(name,callback);void handle.then((h:any)=>{if(gone)void h.remove();});return()=>{gone=true;void handle.then((h:any)=>h.remove());};}
const android:NativeBridge|undefined=typeof window!=='undefined'&&Capacitor.isNativePlatform()?{
 platform:'android',bootstrap:()=>plugin.bootstrap(),request:args=>plugin.request(args),store:args=>plugin.store(args),
 pickFiles:args=>plugin.pickFiles(args),files:args=>plugin.files(args),openExternal:path=>plugin.openExternal({path}),settings:args=>plugin.settings(args||{}),
 player:args=>plugin.player(args),onPlayer:cb=>listen('playerState',cb),onSuspend:cb=>listen('suspend',cb),
}:undefined;
export const native = typeof window === 'undefined' ? undefined : window.lumenNative || android;
let values:Record<string,string>={};
let pending:Promise<void>=Promise.resolve();
const failedWrites=new Map<string,string|null>();
export let cachedDeviceUser:SiteUser|null=null;
export let deviceVersion='';
export async function bootstrapDevice(){if(native){document.documentElement.dataset.native=native.platform;const state=await native.bootstrap();values=state.values;cachedDeviceUser=state.user;deviceVersion=state.version;if(values["lumen.theme"])document.documentElement.classList.toggle("dark",values["lumen.theme"]==="dark");}}
function persist(key:string,value:string|null){
  const result=native!.store({key,value});
  if(result){const operation=result.then(()=>{failedWrites.delete(key);},()=>{failedWrites.set(key,value);window.dispatchEvent(new Event('lumen-storage-error'));});pending=Promise.all([pending,operation]).then(()=>{});}
}
export async function flushDevice(){
 await pending;
 for(const [key,value] of [...failedWrites]){try{await native!.store({key,value});failedWrites.delete(key);}catch{throw Error('STORAGE_UNAVAILABLE');}}
}
// Desktop writes are synchronous SQLite transactions; Android flushes its durable queue before exchanging data.
export const deviceStorage={
 getItem(key:string):string|null {return native?values[key]??null:globalThis.localStorage.getItem(key);},
 setItem(key:string,value:string){if(native){persist(key,value);values[key]=value;}else globalThis.localStorage.setItem(key,value);},
 removeItem(key:string){if(native){persist(key,null);delete values[key];}else globalThis.localStorage.removeItem(key);},
};
export function filePatch(value:File|string):Partial<Track>{return typeof value==='string'?{file:null,localUrl:value}:{file:value,localUrl:undefined};}
