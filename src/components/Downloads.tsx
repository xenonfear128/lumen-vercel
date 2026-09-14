import { useI18n } from '../i18n';
import { useSiteText } from '../siteI18n';
import release from '../../config/client-release.json';
import { native, deviceVersion } from '../lib/device';
interface Artifact { platform:string; url:string; sha256:string }
const platforms=[['windows-x64','Windows 10 / 11 · x64'],['macos-arm64','macOS 12+ · Apple Silicon'],['macos-x64','macOS 12+ · Intel'],['android','Android 10+']];
function artifact(platform:string){return (release.artifacts as Artifact[]).find(a=>a.platform===platform&&/^https:\/\/(github\.com|lumen\.rupa\.best)\//.test(a.url)&&/^[a-f0-9]{64}$/.test(a.sha256));}
export function Downloads(){
 const {lang}=useI18n(),t=useSiteText();
 return <main className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-5 pb-10">
  <a className="site-link inline-flex min-h-11 items-center" href="/">{t('back')}</a>
  <h1 className="mt-6 text-3xl font-semibold tracking-tight">Lumen · {t('downloads')}</h1>
  <p className="my-4 max-w-2xl text-muted">{release.notes[lang]}</p>
  <p className="mb-6 text-sm">{native ? `${t('installedVersion')} ${deviceVersion} · `:''}v{release.version} · {t(release.published?'ready':'releasePending')}</p>
  <div className="grid gap-4 sm:grid-cols-2">
   {platforms.map(([platform,name])=><section key={name} className="site-card site-stack"><h2 className="font-semibold">{name}</h2><p className="text-sm text-muted">{t(name.startsWith('Android')?'androidDistribution':'unsignedTest')}</p>{release.published && artifact(platform) ? <><a className="site-link inline-flex min-h-11 items-center" href={artifact(platform)!.url}>{t('downloads')}</a><code className="break-all text-xs">SHA-256: {artifact(platform)!.sha256}</code></> : <span className="text-sm" role="status">{t('releasePending')}</span>}</section>)}
  </div>
  <p className="mt-6 text-sm text-muted">{t('manualUpdateHint')}</p>
 </main>;
}
