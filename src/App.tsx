import { Downloads } from './components/Downloads';
import { native } from './lib/device';
import { deviceStorage as localStorage } from './lib/device';
import { useCallback, useEffect, useMemo, useState } from "react";
import { Equalizer } from "./components/Equalizer";
import { List, Music, Sliders } from "./components/Icons";
import { Modal } from "./components/Modal";
import { NowPlaying } from "./components/NowPlaying";
import { OnlinePanel } from "./components/OnlinePanel";
import { Sidebar } from "./components/Sidebar";
import { StatsPanel } from "./components/StatsPanel";
import { TopBar } from "./components/TopBar";
import { TrackList } from "./components/TrackList";
import { coverSrc } from "./components/Cover";
import { usePlayer } from "./hooks/usePlayer";
import { I18nContext, LANGS, detectLang, getDict, type Lang } from "./i18n";
import { filesFromDataTransfer } from "./lib/metadata";
import { cn } from "./utils/cn";
import { useSite } from './hooks/useSite';
import { SiteAccount } from './components/SiteAccount';
import { AdminPanel } from './components/AdminPanel';
import { siteText } from './siteI18n';
import { loadLibrary } from './lib/libraryStorage';
import { loadStats } from './lib/stats';
import { profileKey } from './lib/profile';

type MobileTab = "library" | "player" | "queue";

export default function App() {
  const site = useSite();
  const isDownloads = window.location.pathname.replace(/\/$/,'') === '/downloads';
  const isAdmin = !native && window.location.pathname.replace(/\/$/, '') === '/admin';
  const [lang, setLangState] = useState<Lang>(detectLang);
  const [dark, setDark] = useState<boolean>(() => document.documentElement.classList.contains("dark"));
  const [eqOpen, setEqOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<MobileTab>("player");
  const player = usePlayer(site.user?.id || 'guest');
  const [accountOpen, setAccountOpen] = useState(() => new URLSearchParams(location.search).has('account') || !!site.user && !isAdmin && !localStorage.getItem(profileKey('lumen.import.v1', site.user.id)) && (loadLibrary().playlists.length > 0 || loadStats().totalMs > 0));

  const t = useMemo(() => getDict(lang), [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem("lumen.lang", l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = LANGS.find((l) => l.code === lang)?.html ?? "en";
    document.documentElement.dataset.lang = lang;
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("lumen.theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    document.title = player.current
      ? `${player.current.title ?? player.current.fileName} — ${player.current.artist ?? t.unknown} · Lumen`
      : "Lumen · Local Music Player";
  }, [player.current, t.unknown]);

  // Drag & drop (files and folders)
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (!e.dataTransfer) return;
      if(native){await player.pickDeviceFiles();return;}
      const { files, folder } = await filesFromDataTransfer(e.dataTransfer);
      if (folder) void player.addFolder(files);
      else void player.addFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [player.addFolder, player.addFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const bg = coverSrc(player.current);

  return (
    <I18nContext.Provider value={{ lang, t, setLang }}>
      <div className="relative flex h-full flex-col overflow-hidden">
        {/* Ambient background derived from the cover, desaturated to stay monochrome */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <img
            key={bg}
            src={bg}
            alt=""
            className={cn(
              "fade-in absolute inset-0 h-full w-full scale-125 object-cover blur-[90px] saturate-0 transition-opacity duration-1000",
              dark ? "opacity-[0.28]" : "opacity-[0.22]",
            )}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg)]/40 via-transparent to-[var(--bg)]/70" />
        </div>

        <TopBar dark={dark} onToggleTheme={() => setDark((d) => !d)} onOpenAccount={() => setAccountOpen(true)} syncStatus={site.user ? player.syncStatus : undefined} />

        {isDownloads ? <Downloads /> : isAdmin ? <AdminPanel /> : <>

        <div className="flex min-h-0 flex-1 gap-5 px-3 pb-3 sm:px-5 sm:pb-5 lg:px-7 lg:pb-7">
          {/* Sidebar (desktop) */}
          <Sidebar
            player={player}
            onOpenEq={() => setEqOpen(true)}
            onOpenStats={() => setStatsOpen(true)}
            onOpenOnline={() => setOnlineOpen(true)}
            className={cn("glass w-72 shrink-0 rounded-[28px] p-4 glass-sheen", "hidden md:flex")}
          />

          {/* Main */}
          <main className="grid min-h-0 min-w-0 flex-1 auto-rows-[minmax(0,1fr)] grid-cols-1 gap-5 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
            {/* Mobile: library tab */}
            <div className={cn("min-h-0 md:hidden", tab === "library" ? "block" : "hidden")}>
              <Sidebar
                player={player}
                onOpenEq={() => setEqOpen(true)}
                onOpenStats={() => setStatsOpen(true)}
                onOpenOnline={() => setOnlineOpen(true)}
                onNavigate={() => setTab("queue")}
                className="glass h-full rounded-[28px] p-4 glass-sheen"
              />
            </div>
            <div
              className={cn(
                "player-panel glass glass-sheen min-h-0 min-w-0 overflow-y-auto rounded-[28px] p-5 sm:p-6",
                tab === "player" && "block",
                tab === "library" && "hidden md:block",
                tab === "queue" && "hidden xl:block",
              )}
            >
              <NowPlaying player={player} dark={dark} />
            </div>
            <div className={cn("min-h-0 min-w-0", tab === "queue" ? "block" : "hidden xl:block")}>
              <TrackList player={player} />
            </div>
          </main>
        </div>

        {/* Mobile tab bar */}
        <nav className="glass-strong mx-3 mb-3 flex shrink-0 items-center justify-around rounded-full p-1 sm:mx-5 sm:mb-5 xl:hidden">
          {(
            [
              { k: "library", icon: <Music size={16} />, label: t.library },
              { k: "player", icon: <Sliders size={16} className="rotate-90" />, label: t.nowPlaying },
              { k: "queue", icon: <List size={16} />, label: t.queue },
            ] as { k: MobileTab; icon: React.ReactNode; label: string }[]
          ).map((it) => (
            <button
              key={it.k}
              type="button"
              onClick={() => setTab(it.k)}
              className={cn(
                "btn flex min-h-9 min-w-0 flex-1 flex-wrap items-center justify-center gap-x-2 gap-y-0 rounded-full px-2 py-1 text-[12.5px] font-medium",
                it.k === "library" && "md:hidden",
                tab === it.k ? "btn-active" : "btn-ghost text-muted",
              )}
            >
              {it.icon}
              <span className="whitespace-nowrap">{it.label}</span>
            </button>
          ))}
        </nav>

        {/* Drop overlay */}
        {dragging && (
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-[var(--bg)]/60 backdrop-blur-md" />
            <div className="glass-strong relative flex flex-col items-center gap-3 rounded-[32px] border-2 border-dashed border-current/30 px-12 py-10 text-center">
              <Music size={28} />
              <div className="text-[16px] font-semibold tracking-tight">{t.dropHint}</div>
            </div>
          </div>
        )}

        <Modal open={eqOpen} onClose={() => setEqOpen(false)} title={t.equalizer} subtitle="10-band · ISO octave">
          <Equalizer player={player} />
        </Modal>
        <Modal open={statsOpen} onClose={() => setStatsOpen(false)} title={t.stats} width="max-w-3xl">
          <StatsPanel player={player} />
        </Modal>
        <Modal open={onlineOpen} onClose={() => setOnlineOpen(false)} title={t.onlineMusic} width="max-w-2xl">
          <OnlinePanel player={player} onClose={() => setOnlineOpen(false)} />
        </Modal>
        </>}
        <Modal open={accountOpen} onClose={() => setAccountOpen(false)} title={siteText(lang, 'account')} width="max-w-lg"><SiteAccount player={player} /></Modal>

      </div>
    </I18nContext.Provider>
  );
}
