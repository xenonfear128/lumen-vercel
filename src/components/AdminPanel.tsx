import { useCallback, useEffect, useRef, useState } from 'react';
import { useSite } from '../hooks/useSite';
import { SiteError, siteApi } from '../lib/siteApi';
import { useSiteText } from '../siteI18n';
import { Button } from './Button';
import { SiteAccount, SiteNotice } from './SiteAccount';
interface Source { enabled: boolean; status: string; account: { id: number; nickname: string } | null; checkedAt: string | null }
interface Status { database: string; source: Source; failures: number }
interface User { id: string; username: string; role: string; disabled: boolean }
interface Invite { id: string; expires_at: string; used_by: string | null; revoked: boolean }
export function AdminPanel() {
  const site = useSite(), t = useSiteText();
  const [tab, setTab] = useState<'source'|'users'|'service'>('source');
  const [status, setStatus] = useState<Status | null>(null), [users, setUsers] = useState<User[]>([]), [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [secret, setSecret] = useState(''), [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<{ generation: string; image: string } | null>(null), [qrState, setQrState] = useState('waiting');
  const [confirmation, setConfirmation] = useState<{ path: string; body: unknown; hint: string } | null>(null);
  const active = useRef(true), generation = useRef(0), qrRef = useRef(qr); qrRef.current = qr;
  const userId = site.user?.id;
  const refresh = useCallback(async () => {
    const [s,u,i] = await Promise.all([siteApi<Status>('/admin/status'),siteApi<{users:User[]}>('/admin/users'),siteApi<{invites:Invite[]}>('/admin/invites')]);
    if(active.current){setStatus(s);setUsers(u.users);setInvites(i.invites);}
  }, []);
  useEffect(() => {
    active.current = true;
    if(site.user?.role === 'admin')void refresh().catch(e => {if(active.current)setError(e instanceof SiteError ? e.code : 'REQUEST_FAILED');});
    const cancel = () => {generation.current++;if(qrRef.current)void siteApi('/admin/source/cancel',{generation:qrRef.current.generation},userId).catch(()=>{});};
    window.addEventListener('pagehide',cancel);
    return () => {active.current=false;cancel();window.removeEventListener('pagehide',cancel);};
  }, [userId,site.user?.role,refresh]);
  useEffect(() => {
    if(!qr)return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>,failures=0;
    const poll=async()=>{
      try {
        const r=await siteApi<{state:string}>('/admin/source/poll',{generation:qr.generation},userId);
        if(cancelled)return; failures=0;setQrState(r.state);
        if(r.state==='success'){setQr(null);await refresh();return;}
        if(r.state==='expired')return;
      }catch(e){if(cancelled)return;failures++;if(failures>=8||(e instanceof SiteError&&[401,403,409].includes(e.status))){setError(e instanceof SiteError?e.code:'REQUEST_FAILED');return;}}
      if(!cancelled)timer=setTimeout(poll,2000);
    };
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[qr,userId,refresh]);
  async function perform(path:string,body:unknown={}) {
    setBusy(true);setError('');
    try {
      const r=await siteApi<{invite?:string;resetToken?:string}>(path,body,userId);
      if(!active.current)return;
      if(r.invite||r.resetToken){setSecret(r.invite||r.resetToken||'');setCopied(false);}
      await refresh();
    }catch(e){if(active.current)setError(e instanceof SiteError?e.code:'REQUEST_FAILED');}
    finally{if(active.current)setBusy(false);}
  }
  async function startQr() {
    const seq=++generation.current;setBusy(true);setError('');setQr(null);
    try {
      const result=await siteApi<{generation:string;image:string}>('/admin/source/start',{},userId);
      if(!active.current||seq!==generation.current){void siteApi('/admin/source/cancel',{generation:result.generation},userId).catch(()=>{});return;}
      setQrState('waiting');setQr(result);
    }catch(e){if(active.current)setError(e instanceof SiteError?e.code:'REQUEST_FAILED');}
    finally{if(active.current)setBusy(false);}
  }
  const source=status?.source;
  return <main className="admin-page"><div className="admin-shell site-stack">
    <div className="site-actions justify-between"><h1 className="text-2xl font-semibold">{t('admin')}</h1><a href="/" className="site-link">{t('back')}</a></div>
    {!site.user ? <section className="site-card"><SiteAccount /></section> : site.user.role!=='admin' ? <SiteNotice error>{t('adminOnly')}</SiteNotice> : <>
      <nav className="site-actions" aria-label={t('admin')}>{(['source','users','service'] as const).map(k=><Button key={k} active={k===tab} variant="soft" onClick={()=>{setTab(k);setSecret('');setError('');}}>{t(k)}</Button>)}</nav>
      {error&&<SiteNotice error>{t(error)}</SiteNotice>}
      {confirmation&&<section className="site-card site-stack" role="alertdialog" aria-modal="false" aria-label={t('confirm')}><p>{t(confirmation.hint)}</p><div className="site-actions"><Button disabled={busy} onClick={()=>{const c=confirmation;setConfirmation(null);void perform(c.path,c.body);}}>{t('confirm')}</Button><Button variant="ghost" onClick={()=>setConfirmation(null)}>{t('cancel')}</Button></div></section>}
      {tab==='source'&&<section className="site-card site-stack">
        <div><h2 className="text-xl font-semibold">{source?.account?.nickname||t('noAccount')}</h2><p className="text-muted mt-2">{t('sourceHint')}</p></div>
        {source&&<dl className="site-details"><div><dt>{t('source')}</dt><dd>{t(!source.enabled&&source.account?'disabled':source.status==='expired'?'SOURCE_EXPIRED':source.status)}</dd></div><div><dt>{t('lastChecked')}</dt><dd>{source.checkedAt?new Date(source.checkedAt).toLocaleString():'—'}</dd></div></dl>}
        <div className="site-actions"><Button disabled={busy} onClick={startQr}>{busy?t('working'):t(source?.account?'rebind':'bind')}</Button>{source?.account&&<><Button variant="soft" disabled={busy} onClick={()=>void perform('/admin/source/check')}>{t('check')}</Button><Button variant="soft" disabled={busy} onClick={()=>void perform('/admin/source/toggle',{enabled:!source.enabled})}>{t(source.enabled?'disable':'enable')}</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirmation({path:'/admin/source/remove',body:{},hint:'removeHint'})}>{t('remove')}</Button></>}</div>
        {qr&&<div className="site-qr"><img src={qr.image} width={220} height={220} alt={t('qrAlt')} /><SiteNotice>{t(qrState)}</SiteNotice><Button variant="ghost" onClick={()=>{generation.current++;const old=qr;setQr(null);void perform('/admin/source/cancel',{generation:old.generation});}}>{t('cancel')}</Button></div>}
      </section>}
      {tab==='users'&&<div className="site-stack">
        <section className="site-card site-stack"><div><h2 className="text-xl font-semibold">{t('invite')}</h2><p className="mt-2 text-muted">{t('inviteHint')}</p></div><Button disabled={busy} onClick={()=>void perform('/admin/invites/create')}>{t('createInvite')}</Button>
          {secret&&<div className="site-stack"><SiteNotice>{t('tokenHint')}</SiteNotice><input className="site-secret" aria-label={t('tokenHint')} value={secret} readOnly onFocus={e=>e.target.select()} /><Button variant="soft" onClick={async()=>{try{await navigator.clipboard.writeText(secret);setCopied(true);}catch{setCopied(false);}}}>{t(copied?'copied':'copy')}</Button></div>}
          {!invites.length&&<p className="text-muted">{t('empty')}</p>}
          {invites.map(i=><div className="site-row" key={i.id}><div className="min-w-0"><p>{t(i.revoked?'revoked':i.used_by?'used':new Date(i.expires_at)<new Date()?'expiredItem':'active')}</p><small className="text-muted">{t('validUntil')} · {new Date(i.expires_at).toLocaleString()}</small></div>{!i.revoked&&!i.used_by&&<Button variant="ghost" disabled={busy} onClick={()=>void perform('/admin/invites/revoke',{id:i.id})}>{t('revoke')}</Button>}</div>)}
        </section>
        <section className="site-card site-stack"><h2 className="text-xl font-semibold">{t('users')}</h2>{users.map(u=><div className="site-row" key={u.id}><div className="min-w-0"><p className="font-medium break-all">{u.username}</p><small className="text-muted">{t(u.role==='admin'?'administrator':'user')} · {t(u.disabled?'disabled':'active')}</small></div><div className="site-actions"><Button variant="soft" disabled={busy} onClick={()=>u.disabled?void perform('/admin/users/update',{id:u.id,disabled:false}):setConfirmation({path:'/admin/users/update',body:{id:u.id,disabled:true},hint:'disableHint'})}>{t(u.disabled?'enable':'disable')}</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirmation({path:'/admin/users/reset',body:{id:u.id},hint:'resetHint'})}>{t('resetUser')}</Button></div></div>)}</section>
      </div>}
      {tab==='service'&&<section className="site-card site-stack"><h2 className="text-xl font-semibold">{t('service')}</h2><dl className="site-details"><div><dt>{t('database')}</dt><dd>{status?t('ready'):'—'}</dd></div><div><dt>{t('failures')}</dt><dd>{status?.failures??'—'}</dd></div></dl><Button variant="soft" onClick={()=>void refresh().catch(e=>setError(e instanceof SiteError?e.code:'REQUEST_FAILED'))}>{t('refresh')}</Button></section>}
    </>}
  </div></main>;
}
