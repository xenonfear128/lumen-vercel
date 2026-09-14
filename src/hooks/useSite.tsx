import { native, cachedDeviceUser } from '../lib/device';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { siteApi, setSiteSession, type SiteSession } from '../lib/siteApi';
const initial: SiteSession = { configured: false, initialized: false, user: null, csrf: null };
const Context = createContext({ ...initial, booted: false, refresh: async () => {} });
export function SiteProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SiteSession>(() => native ? {configured:true,initialized:true,user:cachedDeviceUser,csrf:null}:initial);
  const [booted, setBooted] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    try {
      const result = await siteApi<SiteSession>('/auth/session');
      if (seq !== generation.current) return;
      setSiteSession(result); setValue(result);
    } catch { /* Keep a known session during a temporary network outage. */ }
    finally { if (seq === generation.current) setBooted(true); }
  }, []);
  useEffect(() => {
    if(native)setSiteSession({configured:true,initialized:true,user:cachedDeviceUser,csrf:null});
    void refresh();
    const expired = () => { setSiteSession(initial); setValue(initial); void refresh(); };
    const focus = () => { if(document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('lumen-session-expired', expired);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', focus);
    return () => { generation.current++; window.removeEventListener('lumen-session-expired', expired); document.removeEventListener('visibilitychange', focus); window.removeEventListener('online', focus); };
  }, [refresh]);
  return <Context.Provider value={{ ...value, booted, refresh }}>{children}</Context.Provider>;
}
export const useSite = () => useContext(Context);
