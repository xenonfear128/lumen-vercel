import { useI18n } from "../i18n";
import type { Player } from "../hooks/usePlayer";
import { fmtBitrate, fmtSampleRate, fmtTime } from "../lib/format";
import { stripExt } from "../lib/metadata";
import type { PlayMode, VizMode } from "../lib/types";
import { IconButton, Segmented } from "./Button";
import { Cover } from "./Cover";
import { Next, Pause, Play, Prev, Repeat, RepeatOne, Shuffle, Volume } from "./Icons";
import { Visualizer } from "./Visualizer";
import { cn } from "../utils/cn";

export function NowPlaying({ player, dark, className }: { player: Player; dark: boolean; className?: string }) {
  const { t } = useI18n();
  const { current, playing, currentTime, duration, volume, muted } = player;
  const title = current ? current.title ?? stripExt(current.fileName) : t.noTrack;
  const artist = current ? current.artist ?? t.unknown : "";
  const album = current ? current.album ?? t.unknown : "";
  const pct = duration ? (currentTime / duration) * 100 : 0;

  const modeIcon: Record<PlayMode, { icon: React.ReactNode; label: string }> = {
    shuffle: { icon: <Shuffle size={18} />, label: t.shuffle },
    "repeat-all": { icon: <Repeat size={18} />, label: t.repeatAll },
    "repeat-one": { icon: <RepeatOne size={18} />, label: t.repeatOne },
  };

  const chips = current
    ? [
        current.source === "netease" ? t.sourceNetease : t.sourceLocal,
        current.codec,
        fmtBitrate(current.bitrate),
        fmtSampleRate(current.sampleRate),
        current.year ? String(current.year) : null,
        current.genre,
      ].filter(Boolean)
    : [];

  return (
    <section className={cn("now-playing flex h-full min-h-0 min-w-0 flex-col pb-1", className)}>
      {/* Cover + visualizer */}
      <div className="player-art relative flex min-h-48 flex-1 flex-col items-center justify-center py-2">
        <div className="flex min-h-32 w-full flex-1 items-center justify-center [container-type:size]">
          <div className="relative aspect-square" style={{ width: "min(100cqw, 100cqh, 420px)" }}>
            {player.viz === "ring" && (
              <div className="pointer-events-none absolute inset-0">
                <Visualizer engine={player.engine} mode="ring" playing={playing} dark={dark} />
              </div>
            )}
            <div
              className={cn(
                "relative h-full w-full transition-transform duration-700 ease-[var(--ease-out-quart)]",
                player.viz === "ring" ? "scale-50" : playing ? "scale-100" : "scale-[0.94]",
              )}
            >
              <Cover
                track={current}
                rounded={player.viz === "ring" ? "rounded-full" : "rounded-[28px]"}
                className={cn("h-full w-full shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)]", player.viz === "ring" && playing && "cover-spin")}
              />
            </div>
          </div>
        </div>

        {(player.viz === "bars" || player.viz === "wave") && (
          <div className="mt-4 h-14 w-full max-w-[420px] shrink-0 opacity-90">
            <Visualizer engine={player.engine} mode={player.viz} playing={playing} dark={dark} />
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="mt-2 text-center">
        <h1 key={title} title={title} className={cn("fade-in px-2 text-[22px] font-semibold tracking-tight sm:text-[24px]", current ? "truncate" : "[overflow-wrap:anywhere]")}>
          {title}
        </h1>
        <div className={cn("mt-1 text-[14px] text-muted", current ? "truncate" : "[overflow-wrap:anywhere]")}>
          {current ? (
            <>
              <span className="text-[var(--fg)]/80">{artist}</span>
              <span className="mx-2 opacity-40">—</span>
              <span>{album}</span>
            </>
          ) : (
            <span>{t.dropHint}</span>
          )}
        </div>
        {player.resolving && (
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            {t.resolving}
          </div>
        )}
        {player.trackError && (
          <div className="mt-2 text-[12px] text-muted [overflow-wrap:anywhere]">
            {t.trackUnavailable}: {player.trackError}
          </div>
        )}
        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
            {chips.map((c, i) => (
              <span key={i} className="max-w-full rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-muted [overflow-wrap:anywhere]">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="mt-5 px-1">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          disabled={!current}
          onChange={(e) => player.seek(parseFloat(e.target.value))}
          className="slider disabled:opacity-40"
          style={{ ["--p" as string]: `${pct}%` }}
        />
        <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted tnum">
          <span>{fmtTime(currentTime)}</span>
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="player-transport mt-3 flex items-center justify-between gap-2">
        <IconButton label={modeIcon[player.mode].label} onClick={player.cycleMode} size={40} variant="soft" active={player.mode !== "repeat-all"}>
          {modeIcon[player.mode].icon}
        </IconButton>

        <div className="player-transport-main flex items-center gap-2 sm:gap-3">
          <IconButton label={t.prev} onClick={player.prev} size={46} variant="ghost" disabled={!player.queue.length}>
            <Prev size={22} />
          </IconButton>
          <IconButton label={playing ? t.pause : t.play} onClick={player.toggle} size={64} variant="primary" disabled={!player.playlists.length}>
            <span key={playing ? "p" : "s"} className="fade-in flex">
              {playing ? <Pause size={26} /> : <Play size={26} />}
            </span>
          </IconButton>
          <IconButton label={t.next} onClick={player.next} size={46} variant="ghost" disabled={!player.queue.length}>
            <Next size={22} />
          </IconButton>
        </div>

        <div className="group relative flex items-center">
          <IconButton label={t.volume} onClick={() => player.setMuted(!muted)} size={40} variant="soft">
            <Volume size={18} level={muted ? 0 : volume} />
          </IconButton>
          <div className="absolute right-0 bottom-full hidden w-44 pb-2 group-hover:block group-focus-within:block">
            <div className="glass fade-in flex items-center gap-2 rounded-2xl px-3 py-2.5">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                className="slider"
                style={{ ["--p" as string]: `${(muted ? 0 : volume) * 100}%` }}
              />
              <span className="w-7 text-right font-mono text-[10.5px] text-muted tnum">{Math.round((muted ? 0 : volume) * 100)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Visualizer + mode selection */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented<PlayMode>
          value={player.mode}
          onChange={player.setMode}
          options={[
            { value: "repeat-all", label: t.repeatAll },
            { value: "repeat-one", label: t.repeatOne },
            { value: "shuffle", label: t.shuffle },
          ]}
        />
        <Segmented<VizMode>
          value={player.viz}
          onChange={player.setViz}
          options={[
            { value: "off", label: t.vizOff },
            { value: "bars", label: t.vizBars },
            { value: "wave", label: t.vizWave },
            { value: "ring", label: t.vizRing },
          ]}
        />
      </div>
    </section>
  );
}
