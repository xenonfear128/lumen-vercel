import { ClientUpdate } from './ClientUpdate';
import { native } from '../lib/device';
import { deviceStorage as localStorage } from '../lib/device';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSite } from '../hooks/useSite';
import { SiteError, siteApi } from '../lib/siteApi';
import { useSiteText } from '../siteI18n';
import { Button } from './Button';
import { loadLibrary } from '../lib/libraryStorage';
import { loadStats } from '../lib/stats';
import { profileKey } from '../lib/profile';
import type { Player } from '../hooks/usePlayer';
export function SiteField({ label, name, type = 'text', hint, required = true }: { label: string; name: string; type?: string; hint?: string; required?: boolean }) {
  return <label className="site-field"><span>{label}</span><input name={name} type={type} required={required} minLength={type === 'password' ? 12 : undefined} maxLength={type === 'password' ? 128 : 200} autoComplete={name === 'username' ? 'username' : type === 'password' ? name === 'currentPassword' ? 'current-password' : 'new-password' : 'off'} />{hint && <small className="text-muted">{hint}</small>}</label>;
}
export function SiteNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`site-notice ${error ? 'site-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p>;
}
export function SiteAccount({ player }: { player?: Player }) {
  const site = useSite(), t = useSiteText();
  const [mode, setMode] = useState<'login'|'register'|'setup'|'reset'>(!native && !site.initialized && site.configured ? 'setup' : !native && new URLSearchParams(location.search).get('account')==='register' ? 'register' : !native && new URLSearchParams(location.search).get('account')==='reset' ? 'reset' : 'login');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [importHidden, setImportHidden] = useState(false);
  const hasLegacy = player && site.user && !localStorage.getItem(profileKey('lumen.import.v1', site.user.id)) && (loadLibrary().playlists.length > 0 || loadStats().totalMs > 0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true); setError(''); setMessage('');
    try {
      await siteApi(`/auth/${site.user ? 'password' : mode}`, data);
      if (site.user || mode === 'reset') { setMessage(t('done')); setMode('login'); }
      await site.refresh();
    } catch(e) { setError(t(e instanceof SiteError ? e.code : 'REQUEST_FAILED')); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);setError('');
    try { await siteApi('/auth/logout', {}); await site.refresh(); }
    catch(e) { setError(t(e instanceof SiteError ? e.code : 'REQUEST_FAILED')); }
    finally {setBusy(false);}
  }
  if (!site.configured) return <SiteNotice>{t('notConfigured')}</SiteNotice>;
  return <div className="site-stack"><ClientUpdate />
    <a className="site-link" href="/downloads" onClick={e=>{if(native){e.preventDefault();void native.openExternal('/downloads');}}}>{t('downloads')}</a>
    {site.user ? <>
      <div><h3 className="text-lg font-semibold">{site.user.username}</h3><p className="text-sm text-muted">{t('cloudHint')}</p></div>
      {player && <Button variant="soft" onClick={() => void player.retrySync()}>{t(player.syncStatus)}</Button>}
      {site.user.role === 'admin' && <a className="site-link" href="/admin" onClick={e=>{if(native){e.preventDefault();void native.openExternal('/admin');}}}>{t('admin')}</a>}
      {hasLegacy && !importHidden && <section className="site-card site-stack"><h3 className="font-semibold">{t('importTitle')}</h3><p>{t('importHint')}</p><div className="site-actions"><Button disabled={busy} onClick={async () => { setBusy(true);setError('');try {await player.importLegacy();setImportHidden(true);}catch{setError(t('STORAGE_UNAVAILABLE'));}finally{setBusy(false);} }}>{t('import')}</Button><Button variant="ghost" onClick={() => setImportHidden(true)}>{t('later')}</Button></div></section>}
      <form onSubmit={submit} className="site-stack"><h3 className="font-semibold">{t('changePassword')}</h3><SiteField name="currentPassword" type="password" label={t('currentPassword')} /><SiteField name="password" type="password" label={t('password')} /><Button type="submit" disabled={busy}>{busy ? t('working') : t('changePassword')}</Button></form>
      <Button variant="ghost" disabled={busy} onClick={logout}>{t('logout')}</Button>
    </> : <>
      <p className="text-sm text-muted">{t(mode === 'setup' ? 'setupHint' : 'authHint')}</p>
      <div className="site-actions" role="group" aria-label={t('account')}>{(['login','register','reset',...(!native && !site.initialized ? ['setup'] : [])] as typeof mode[]).map(m => <Button key={m} active={mode === m} variant="soft" onClick={() => {if(native && m!=='login'){void native.openExternal('/?account='+m);return;}setMode(m);setError('');}}>{t(m)}</Button>)}</div>
      <form className="site-stack" onSubmit={submit}>
        {mode !== 'reset' && <SiteField name="username" label={t('username')} hint={t('usernameHint')} />}
        <SiteField name="password" type="password" label={t('password')} />
        {mode === 'register' && <SiteField name="invite" label={t('invite')} />}
        {mode === 'setup' && <SiteField name="setupToken" type="password" label={t('setupToken')} />}
        {mode === 'reset' && <SiteField name="resetToken" label={t('resetToken')} />}
        <Button type="submit" disabled={busy}>{busy ? t('working') : t(mode)}</Button>
      </form>
    </>}
    {native?.migrateLegacy && <Button variant="ghost" disabled={busy} onClick={async()=>{setBusy(true);try{if((await native!.migrateLegacy!()).imported)location.reload();}catch{setError(t('STORAGE_UNAVAILABLE'));}finally{setBusy(false);}}}>{t('legacyDesktop')}</Button>}
    {native?.platform==='android'  && <Button variant="ghost" onClick={()=>void native!.player!({action:'exit'})}>{t('exitClient')}</Button>}
    {error && <SiteNotice error>{error}</SiteNotice>}{message && <SiteNotice>{message}</SiteNotice>}
  </div>;
}
