import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { native, deviceVersion } from '../lib/device';
import { siteApi, SiteError } from '../lib/siteApi';
import { useSiteText } from '../siteI18n';
import { Button } from './Button';
interface Release {version:string;published:boolean;protocol:number;minProtocol:number;notes:Record<string,string>}
export function ClientUpdate(){
 const {lang}=useI18n(),t=useSiteText();const [release,setRelease]=useState<Release|null>(null);const [error,setError]=useState('');
 async function check(){try{setRelease(await siteApi<Release>('/client/capabilities'));setError('');}catch(e){setError(e instanceof SiteError?e.code:'NETWORK_UNAVAILABLE');}}
 useEffect(()=>{if(native)void check();},[]);
 if(!native)return null;
 return <section className="site-card site-stack"><p>{t('installedVersion')} {deviceVersion}</p>
  {release && <><p className="text-sm">{release.notes[lang]}</p><p>{t(release.minProtocol>1?'CLIENT_UPDATE_REQUIRED':release.published&&release.version!==deviceVersion?'updateAvailable':'releasePending')}</p></>}
  {error&&<p role="status">{t(error)}</p>}
  <div className="site-actions"><Button variant="soft" onClick={()=>void check()}>{t('checkUpdate')}</Button><Button variant="ghost" onClick={()=>void native!.openExternal('/downloads')}>{t('downloads')}</Button></div>
 </section>;
}
