export function fmtTime(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "--:--";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(r).padStart(2, "0")}`;
}

export function fmtDurationLong(ms: number, u: { h: string; m: string; s: string }): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}${u.h} ${m}${u.m}`;
  if (m > 0) return `${m}${u.m} ${s}${u.s}`;
  return `${s}${u.s}`;
}

export function fmtBitrate(bps: number | null): string | null {
  if (!bps) return null;
  return `${Math.round(bps / 1000)} kbps`;
}

export function fmtSampleRate(hz: number | null): string | null {
  if (!hz) return null;
  return `${(hz / 1000).toFixed(1).replace(/\.0$/, "")} kHz`;
}
