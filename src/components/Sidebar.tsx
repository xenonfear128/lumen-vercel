import { native } from '../lib/device';
import { metadataTypography } from "../lib/metadataTypography";
import { useRef } from "react";
import { useI18n } from "../i18n";
import type { Player } from "../hooks/usePlayer";
import { Button, IconButton } from "./Button";
import { Chart, FileAudio, Folder, Globe, Music, Sliders, Trash } from "./Icons";
import { cn } from "../utils/cn";

export function Sidebar({
  player,
  onOpenEq,
  onOpenStats,
  onOpenOnline,
  className,
  onNavigate,
}: {
  player: Player;
  onOpenEq: () => void;
  onOpenStats: () => void;
  onOpenOnline: () => void;
  className?: string;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  return (
    <aside className={cn("sidebar flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto", className)}>
      <div className="sidebar-actions grid shrink-0 gap-2">
        <Button className="justify-start" variant="primary" icon={<Folder size={16} />} onClick={() => native ? void player.pickDeviceFiles(true) : folderRef.current?.click()}>
          {t.addFolder}
        </Button>
        <Button className="justify-start" variant="soft" icon={<FileAudio size={16} />} onClick={() => native ? void player.pickDeviceFiles() : filesRef.current?.click()}>
          {t.addFiles}
        </Button>
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error non-standard attribute
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            void player.addFolder(files);
            e.target.value = "";
            onNavigate?.();
          }}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          accept="audio/*,.mp3,.flac,.wav,.ogg,.opus,.m4a,.aac,.aiff,.aif,.wma,.webm"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            void player.addFiles(files);
            e.target.value = "";
            onNavigate?.();
          }}
        />
        <Button className="justify-start" variant="soft" icon={<Globe size={16} />} aria-label={t.online} onClick={onOpenOnline}>
          {t.online}
        </Button>
      </div>

      <div className="min-h-24 flex-1 overflow-y-auto">
        <div className="mb-2 flex items-center justify-between px-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.playlists}</div>
          <div className="text-[11px] text-muted tnum">{player.playlists.length}</div>
        </div>
        {player.playlists.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center">
            <Music className="mx-auto mb-2 text-muted" size={22} />
            <div className="text-[13px] font-medium">{t.emptyLibrary}</div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{t.emptyLibraryHint}</div>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {player.playlists.map((pl) => {
              const active = pl.id === player.viewPlaylistId;
              const isQueue = pl.id === player.queuePlaylistId;
              return (
                <li key={pl.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      player.setViewPlaylistId(pl.id);
                      onNavigate?.();
                    }}
                    className={cn(
                      // Full-width rows sit inside an overflow-y-auto list, so the shared
                      // `.btn` hover/active scale would be clipped at the list edge (the
                      // delete button got cut in half). `.btn-row` cancels the transform.
                      "btn btn-row flex w-full items-center gap-3 rounded-xl py-2.5 pl-3 pr-11 text-left",
                      active ? "btn-active" : "btn-ghost",
                    )}
                  >
                    <span className={cn("shrink-0", active ? "" : "text-muted")}>
                      {pl.kind === "folder" ? <Folder size={16} /> : pl.kind === "netease" ? <Globe size={16} /> : <FileAudio size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span {...metadataTypography(pl.kind === "temp" ? undefined : pl.name)} className="block truncate text-[13.5px] font-medium">{pl.kind === "temp" ? t.tempPlaylist : pl.name}</span>
                      <span className={cn("block text-[11px] tnum", active ? "opacity-70" : "text-muted")}>
                        {t.trackCount(pl.tracks.length)}
                        {isQueue && player.playing && <span className="ml-1.5">· {t.playing}</span>}
                      </span>
                    </span>
                    {isQueue && player.playing && (
                      <span className="flex h-3 items-end gap-[2px]">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="eq-bar block w-[2px] h-full rounded-full bg-current" style={{ animationDelay: `${i * 0.18}s` }} />
                        ))}
                      </span>
                    )}
                  </button>
                  <IconButton
                    label={t.removePlaylist}
                    size={28}
                    variant="soft"
                    className={cn(
                      "btn btn-overlay absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                      active && "!bg-[var(--accent-fg)]/15 text-[var(--accent-fg)]",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      player.removePlaylist(pl.id);
                    }}
                  >
                    <Trash size={13} />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="sidebar-actions grid shrink-0 gap-2">
        <Button className="justify-start" variant="soft" icon={<Sliders size={16} />} onClick={onOpenEq}>
          {t.equalizer}
        </Button>
        <Button className="justify-start" variant="soft" icon={<Chart size={16} />} onClick={onOpenStats}>
          {t.stats}
        </Button>
      </div>
    </aside>
  );
}
