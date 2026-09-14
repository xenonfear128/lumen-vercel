import { profileKey } from './profile';
export interface TrackStat {
  key: string;
  title: string;
  artist: string;
  ms: number;
  plays: number;
  lastPlayed: number;
}

export interface StatsData {
  totalMs: number;
  days: Record<string, number>; // YYYY-MM-DD → ms
  tracks: Record<string, TrackStat>;
  artists: Record<string, number>; // artist → ms
}

const KEY = "lumen.stats.v1";

export function emptyStats(): StatsData {
  return { totalMs: 0, days: {}, tracks: {}, artists: {} };
}

export function loadStats(scope = 'guest'): StatsData {
  try {
    const raw = localStorage.getItem(profileKey(KEY, scope));
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw) as StatsData;
    return { ...emptyStats(), ...parsed };
  } catch {
    return emptyStats();
  }
}

export function saveStats(s: StatsData, scope = 'guest') {
  try {
    localStorage.setItem(profileKey(KEY, scope), JSON.stringify(s));
  } catch {}
}

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function trackKey(title: string, artist: string, album: string, fileName: string): string {
  return title !== "Unknown" || artist !== "Unknown" ? `${artist}::${album}::${title}` : `file::${fileName}`;
}

export function addListening(s: StatsData, key: string, title: string, artist: string, ms: number): StatsData {
  const day = dayKey();
  const next: StatsData = {
    totalMs: s.totalMs + ms,
    days: { ...s.days, [day]: (s.days[day] || 0) + ms },
    tracks: { ...s.tracks },
    artists: { ...s.artists, [artist]: (s.artists[artist] || 0) + ms },
  };
  const prev = next.tracks[key] || { key, title, artist, ms: 0, plays: 0, lastPlayed: 0 };
  next.tracks[key] = { ...prev, ms: prev.ms + ms, lastPlayed: Date.now() };
  return next;
}

export function addPlay(s: StatsData, key: string, title: string, artist: string): StatsData {
  const prev = s.tracks[key] || { key, title, artist, ms: 0, plays: 0, lastPlayed: 0 };
  return { ...s, tracks: { ...s.tracks, [key]: { ...prev, plays: prev.plays + 1, lastPlayed: Date.now() } } };
}

export function lastNDays(s: StatsData, n: number): { key: string; ms: number; date: Date }[] {
  const out: { key: string; ms: number; date: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    out.push({ key: k, ms: s.days[k] || 0, date: d });
  }
  return out;
}
