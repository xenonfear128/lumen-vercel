import { useMemo } from "react";
import { useI18n } from "../i18n";
import type { Player } from "../hooks/usePlayer";
import { fmtDurationLong } from "../lib/format";
import { lastNDays } from "../lib/stats";
import { Button } from "./Button";
import { cn } from "../utils/cn";

export function StatsPanel({ player }: { player: Player }) {
  const { t } = useI18n();
  const { stats, sessionMs, clearStats } = player;
  const u = { h: t.h, m: t.m, s: t.s };

  const days = useMemo(() => lastNDays(stats, 7), [stats]);
  const weekMs = days.reduce((a, d) => a + d.ms, 0);
  const todayMs = days[days.length - 1]?.ms ?? 0;
  const maxDay = Math.max(1, ...days.map((d) => d.ms));
  const totalPlays = Object.values(stats.tracks).reduce((a, x) => a + x.plays, 0);

  const topTracks = useMemo(() => Object.values(stats.tracks).sort((a, b) => b.ms - a.ms).slice(0, 6), [stats]);
  const topArtists = useMemo(
    () =>
      Object.entries(stats.artists)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [stats],
  );
  const empty = stats.totalMs === 0 && totalPlays === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t.totalListening} value={fmtDurationLong(stats.totalMs, u)} />
        <Stat label={t.today} value={fmtDurationLong(todayMs, u)} />
        <Stat label={t.thisWeek} value={fmtDurationLong(weekMs, u)} />
        <Stat label={t.plays} value={String(totalPlays)} />
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.last7days}</div>
          <div className="text-[11.5px] text-muted">
            {t.session}: <span className="tnum">{fmtDurationLong(sessionMs, u)}</span>
          </div>
        </div>
        <div className="flex h-28 items-end gap-2">
          {days.map((d, i) => (
            <div key={d.key} className="group flex h-full min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="relative flex w-full flex-1 items-end">
                <div
                  className={cn(
                    "w-full rounded-t-md transition-[height] duration-700 ease-[var(--ease-out-quart)]",
                    i === days.length - 1 ? "bg-[var(--accent)]" : "bg-[color-mix(in_oklab,var(--fg)_22%,transparent)]",
                  )}
                  style={{ height: `${Math.max(3, (d.ms / maxDay) * 100)}%` }}
                  title={fmtDurationLong(d.ms, u)}
                />
              </div>
              <div className="text-[10.5px] text-muted">{t.weekdays[d.date.getDay()]}</div>
            </div>
          ))}
        </div>
      </div>

      {empty ? (
        <p className="text-center text-[13px] text-muted">{t.nothingYet}</p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.topTracks}</div>
            <ol className="space-y-1.5">
              {topTracks.map((tr, i) => (
                <li key={tr.key} className="flex items-center gap-3 text-[13px]">
                  <span className="w-4 font-mono text-[11px] text-muted tnum">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{tr.title}</div>
                    <div className="truncate text-[11.5px] text-muted">{tr.artist}</div>
                  </div>
                  <div className="max-w-[45%] shrink-0 text-right [overflow-wrap:anywhere]">
                    <div className="font-mono text-[11.5px] tnum">{fmtDurationLong(tr.ms, u)}</div>
                    <div className="text-[10.5px] text-muted tnum">
                      {tr.plays} {t.plays.toLowerCase()}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.topArtists}</div>
            <ol className="space-y-2">
              {topArtists.map(([name, ms], i) => {
                const pct = (ms / (topArtists[0]?.[1] || 1)) * 100;
                return (
                  <li key={name} className="text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="w-4 font-mono text-[11px] text-muted tnum">{i + 1}</span>
                        <span className="truncate font-medium">{name}</span>
                      </span>
                      <span className="max-w-[45%] shrink-0 font-mono text-[11.5px] tnum text-muted [overflow-wrap:anywhere]">{fmtDurationLong(ms, u)}</span>
                    </div>
                    <div className="mt-1 ml-7 h-1 rounded-full bg-line">
                      <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-700" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="soft" onClick={clearStats} disabled={empty}>
          {t.clearStats}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line p-3.5 [overflow-wrap:anywhere]">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tracking-tight tnum">{value}</div>
    </div>
  );
}
