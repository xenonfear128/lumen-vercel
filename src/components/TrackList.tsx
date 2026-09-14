import { native } from '../lib/device';
import { metadataTypography } from "../lib/metadataTypography";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { Player } from "../hooks/usePlayer";
import { fmtTime } from "../lib/format";
import { stripExt } from "../lib/metadata";
import { Cover } from "./Cover";
import { IconButton } from "./Button";
import { Search, Trash, X, Play } from "./Icons";
import { cn } from "../utils/cn";
import { useSiteText } from '../siteI18n';

export function TrackList({ player, className }: { player: Player; className?: string }) {
  const { t } = useI18n();
  const st = useSiteText();
  const [q, setQ] = useState("");
  const pl = player.viewPlaylist;
  const listRef = useRef<HTMLDivElement>(null);

  const tracks = useMemo(() => {
    if (!pl) return [];
    const s = q.trim().toLowerCase();
    if (!s) return pl.tracks;
    return pl.tracks.filter((tr) =>
      [tr.title, tr.artist, tr.album, tr.fileName].some((v) => v && v.toLowerCase().includes(s)),
    );
  }, [pl, q]);

  // scroll active into view when the queue changes track
  useEffect(() => {
    if (!player.current || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-id="${player.current.id}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [player.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => tracks.reduce((a, x) => a + (x.duration || 0), 0), [tracks]);

  return (
    <section className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}>
      <header className="mb-3 flex shrink-0 flex-wrap items-end gap-3 px-1">
        <div className="min-w-0 flex-[1_1_10rem]">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.queue}</div>
          <h2 {...metadataTypography(pl?.kind === "temp" ? undefined : pl?.name)} className="truncate text-[20px] font-semibold tracking-tight">
            {pl ? (pl.kind === "temp" ? t.tempPlaylist : pl.name) : t.library}
          </h2>
          {pl && (
            <div className="text-[12px] text-muted tnum">
              {t.trackCount(tracks.length)} · {fmtTime(total)}
              {player.loadingCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  {t.loadingMeta} ({player.loadingCount})
                </span>
              )}
            </div>
          )}
        </div>
        <label className="glass flex h-9 min-w-0 max-w-full flex-[1_1_14rem] items-center gap-2 rounded-full px-3">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.search}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          {q && (
            <button type="button" className="btn shrink-0 rounded-full p-0.5 text-muted" onClick={() => setQ("")}>
              <X size={13} />
            </button>
          )}
        </label>
      </header>

      <div ref={listRef} className="glass min-h-0 flex-1 overflow-y-auto rounded-3xl p-1.5">
        {!pl || tracks.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[13px] text-muted">
            {pl ? t.noResults : t.dropHint}
          </div>
        ) : (
          <ul>
            {tracks.map((tr, i) => {
              const isCurrent = tr.id === player.current?.id;
              const isPlayingRow = isCurrent && player.playing;
              return (
                <li
                  key={tr.id}
                  data-id={tr.id}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "56px" }}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl px-2.5 py-1.5 transition-colors duration-200",
                    isCurrent ? "bg-[color-mix(in_oklab,var(--fg)_9%,transparent)]" : "hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]",
                  )}
                  onDoubleClick={() => player.playTrackById(tr.id, pl.id)}
                >
                  <div className="relative h-11 w-11 shrink-0">
                    <Cover track={tr} className="h-11 w-11" rounded="rounded-lg" />
                    <button
                      type="button"
                      aria-label={isPlayingRow ? t.pause : t.play}
                      onClick={() => (isCurrent ? player.toggle() : player.playTrackById(tr.id, pl.id))}
                      className={cn(
                        "btn btn-overlay absolute inset-0 flex items-center justify-center rounded-lg bg-black/45 text-white opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100",
                        isCurrent && "opacity-100",
                      )}
                    >
                      {isPlayingRow ? (
                        <span className="flex h-3.5 items-end gap-[2px]">
                          {[0, 1, 2].map((k) => (
                            <span key={k} className="eq-bar block h-full w-[2.5px] rounded-full bg-white" style={{ animationDelay: `${k * 0.16}s` }} />
                          ))}
                        </span>
                      ) : (
                        <Play size={16} />
                      )}
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    {tr.source === 'local' && !tr.file && !tr.localUrl && <label className="site-file-link" onClick={e => {e.stopPropagation();if(native){e.preventDefault();void player.pickDeviceFiles(false,tr.id);}}}>
                      <span>{st('missing')} · {st('attach')}</span>
                      <input type="file" accept="audio/*" aria-label={st('attach')} onChange={e => { const file = e.target.files?.[0]; if (file) void player.attachLocalFile(tr.id, file).catch(() => {}); e.target.value = ''; }} />
                    </label>}
                    <div {...metadataTypography(tr.title ?? stripExt(tr.fileName))} className={cn("truncate text-[13.5px]", isCurrent ? "font-semibold" : "font-medium")}>
                      {tr.title ?? stripExt(tr.fileName)}
                    </div>
                    <div className="truncate text-[11.5px] text-muted">
                      <span {...metadataTypography(tr.artist)}>{tr.artist ?? t.unknown}</span>
                      <span className="mx-1.5 opacity-50">·</span>
                      <span {...metadataTypography(tr.album)}>{tr.album ?? t.unknown}</span>
                    </div>
                  </div>
                  <div className="hidden w-8 shrink-0 text-right font-mono text-[11px] text-muted tnum sm:block">{i + 1}</div>
                  <div className="w-12 shrink-0 text-right font-mono text-[12px] text-muted tnum">{fmtTime(tr.duration)}</div>
                  <IconButton
                    label={t.remove}
                    size={28}
                    variant="soft"
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => player.removeTrack(pl.id, tr.id)}
                  >
                    <Trash size={12} />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
