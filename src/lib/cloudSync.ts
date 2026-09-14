import type { Playlist, Track } from './types';
import { emptyStats, type StatsData } from './stats';
import { profileKey } from './profile';
import { siteApi } from './siteApi';

export type SyncStatus = 'syncing' | 'synced' | 'retry';
interface Operation { id: string; type: string; playlistId?: string; entryId?: string; epoch?: string; nextEpoch?: string; importId?: string; data?: any }
interface CloudState { playlists: Playlist[]; stats: StatsData; epoch: string }
interface Cache { cursor: number; state: CloudState; pending: Operation[] }
interface Exchange { acknowledged: string[]; cursor: number; changes: Operation[]; hasMore: boolean; snapshot?: { playlists: Playlist[]; events: Operation[]; epoch: string } }
const fresh = (): CloudState => ({ playlists: [], stats: emptyStats(), epoch: 'initial' });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function cloudTrack(track: Track) {
  return {
    source: track.source, localFileId: track.source === 'local' ? track.localFileId || track.id : null,
    neteaseId: track.neteaseId, fileName: track.fileName.split(/[\\/]/).pop() || 'Audio',
    title: track.title, artist: track.artist, album: track.album, genre: track.genre,
    year: track.year, duration: track.duration, codec: track.codec, bitrate: track.bitrate,
    sampleRate: track.sampleRate, fallbackCover: track.fallbackCover,
    coverUrl: track.source === 'netease' && /^https:\/\/[^/]+\.music\.126\.net\//.test(track.coverUrl || '') ? track.coverUrl : null,
    metaLoaded: true,
  };
}
function playlistData(p: Playlist) { return { name: p.name, kind: p.kind, neteaseId: p.neteaseId }; }
function hydrate(data: any, id: string): Track {
  return { ...data, id, file: null, path: '', metaLoaded: true, coverUrl: data.coverUrl || null };
}
function apply(state: CloudState, op: Operation) {
  const pl = state.playlists.find(p => p.id === op.playlistId);
  if (op.type === 'playlist.put') {
    if (pl) Object.assign(pl, op.data);
    else state.playlists.push({ ...op.data, id: op.playlistId!, tracks: [] });
  } else if (op.type === 'playlist.delete') state.playlists = state.playlists.filter(p => p.id !== op.playlistId);
  else if (op.type === 'entry.put' && pl) {
    const i = pl.tracks.findIndex(t => t.id === op.entryId);
    const track = hydrate(op.data, op.entryId!);
    if (i < 0) pl.tracks.push(track); else pl.tracks[i] = track;
  } else if (op.type === 'entry.delete' && pl) pl.tracks = pl.tracks.filter(t => t.id !== op.entryId);
  else if (op.type === 'stats.clear' && op.epoch === state.epoch) { state.epoch = op.nextEpoch!; state.stats = emptyStats(); }
  else if (op.type === 'stats.add' && op.epoch === state.epoch) {
    const d = op.data, s = state.stats;
    const old = Object.prototype.hasOwnProperty.call(s.tracks, d.key) ? s.tracks[d.key] : { key: d.key, title: d.title, artist: d.artist, ms: 0, plays: 0, lastPlayed: 0 };
    s.tracks = { ...s.tracks, [d.key]: { ...old, ms: old.ms + d.ms, plays: old.plays + d.plays, lastPlayed: Math.max(old.lastPlayed, d.lastPlayed) } };
    s.totalMs += d.ms;
    s.days = { ...s.days, [d.day]: (s.days[d.day] || 0) + d.ms };
    s.artists = { ...s.artists, [d.artist]: (Object.prototype.hasOwnProperty.call(s.artists, d.artist) ? s.artists[d.artist] : 0) + d.ms };
  } else if (op.type === 'stats.import' && op.epoch === state.epoch) {
    const d = op.data as StatsData, s = state.stats;
    s.totalMs += d.totalMs;
    for (const [k,v] of Object.entries(d.days)) s.days = { ...s.days,[k]:(s.days[k] || 0)+v };
    for (const [k,v] of Object.entries(d.artists)) s.artists = { ...s.artists,[k]:(Object.prototype.hasOwnProperty.call(s.artists,k)?s.artists[k]:0)+v };
    for (const [k,v] of Object.entries(d.tracks)) {
      const prev = Object.prototype.hasOwnProperty.call(s.tracks,k) ? s.tracks[k] : null;
      s.tracks = { ...s.tracks,[k]:prev ? { ...v,plays:prev.plays+v.plays,ms:prev.ms+v.ms,lastPlayed:Math.max(prev.lastPlayed,v.lastPlayed) } : v };
    }
  }
}
export class CloudSync {
  private cache: Cache;
  private observed: Playlist[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private revision = 0;
  private active = false;
  private buffered: Operation | null = null;
  private readonly key: string;
  private listener: ((state: CloudState) => void) | null = null;
  private status: ((status: SyncStatus) => void) | null = null;
  constructor(private userId: string, initial: Playlist[]) {
    this.key = profileKey('lumen.cloud.v1', userId);
    try {
      const value = JSON.parse(localStorage.getItem(this.key) || 'null');
      this.cache = value && Array.isArray(value.pending) && value.state ? value : { cursor: 0, state: fresh(), pending: [] };
    } catch { this.cache = { cursor: 0, state: fresh(), pending: [] }; }
    this.observed = clone(initial.map(p => ({ ...p, tracks: p.tracks.map(t => hydrate(cloudTrack(t), t.id)) })));
    // Crash-recovered unsent time is durable independently of network state.
    try { this.buffered = JSON.parse(localStorage.getItem(`${this.key}.time`) || 'null'); } catch { /* no pending time */ }
  }
  private persist() {
    try { localStorage.setItem(this.key, JSON.stringify(this.cache)); }
    catch { this.status?.('retry'); return false; }
    return true;
  }
  private add(op: Omit<Operation, 'id'>) {
    this.cache.pending.push({ ...op, id: crypto.randomUUID() });
    this.persist(); this.schedule();
  }
  private visible() { const state = clone(this.cache.state); for (const op of this.cache.pending) apply(state, op); return state; }
  private wake = () => { if (document.visibilityState !== 'hidden') void this.exchange(); };
  private leaving = () => { this.flushTime(); void this.exchange(); };
  start(listener: (state: CloudState) => void, status: (status: SyncStatus) => void) {
    this.listener = listener; this.status = status; this.active = true;
    window.addEventListener('online', this.wake); document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('pagehide', this.leaving);
    this.interval = setInterval(this.wake, 30000); void this.exchange();
  }
  stop() {
    this.flushTime(); this.active = false; this.revision++; this.running = false;
    if (this.timer) clearTimeout(this.timer); if (this.interval) clearInterval(this.interval);
    window.removeEventListener('online', this.wake); document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('pagehide', this.leaving);
    this.listener = null; this.status = null;
  }
  private schedule() {
    this.status?.('syncing');
    if (this.timer) clearTimeout(this.timer);
    if (this.active) this.timer = setTimeout(() => { void this.exchange(); }, 350);
  }
  observe(playlists: Playlist[]) {
    const current = playlists.map(p => ({ ...p, tracks: p.tracks.map(t => hydrate(cloudTrack(t), t.id)) }));
    const previous = this.observed; this.observed = clone(current);
    for (const p of previous) if (!current.some(n => n.id === p.id)) this.add({ type: 'playlist.delete', playlistId: p.id });
    for (const p of current) {
      const old = previous.find(n => n.id === p.id);
      if (!old || JSON.stringify(playlistData(old)) !== JSON.stringify(playlistData(p))) this.add({ type: 'playlist.put', playlistId: p.id, data: playlistData(p) });
      for (const t of old?.tracks || []) if (!p.tracks.some(n => n.id === t.id)) this.add({ type: 'entry.delete', playlistId: p.id, entryId: t.id });
      for (const t of p.tracks) {
        const oldTrack = old?.tracks.find(n => n.id === t.id);
        if (!oldTrack || JSON.stringify(cloudTrack(oldTrack)) !== JSON.stringify(cloudTrack(t))) this.add({ type: 'entry.put', playlistId: p.id, entryId: t.id, data: cloudTrack(t) });
      }
    }
  }
  record(data: { key: string; title: string; artist: string; day: string; ms: number; plays: number; lastPlayed: number }) {
    const epoch = this.visible().epoch;
    if (data.plays) { this.add({ type:'stats.add', epoch, data }); return; }
    if (this.buffered && (this.buffered.epoch !== epoch || this.buffered.data.key !== data.key || this.buffered.data.day !== data.day)) this.flushTime();
    if (!this.buffered) this.buffered = { id:crypto.randomUUID(),type:'stats.add',epoch,data:{...data,ms:0} };
    this.buffered.data.ms += data.ms; this.buffered.data.lastPlayed = data.lastPlayed;
    try { localStorage.setItem(`${this.key}.time`,JSON.stringify(this.buffered)); } catch { this.status?.('retry'); }
    if (this.buffered.data.ms >= 15000) this.flushTime();
  }
  flushTime() {
    if (!this.buffered) return;
    // Keep the original id if a crash occurs between saving and removing time.
    if (!this.cache.pending.some(o => o.id === this.buffered!.id)) this.cache.pending.push(this.buffered);
    const persisted = this.persist();
    this.buffered = null;
    if (persisted) {
      try { localStorage.removeItem(`${this.key}.time`); } catch { this.status?.('retry'); }
    }
    this.schedule();
  }
  clearStats() { this.flushTime(); this.add({ type:'stats.clear',epoch:this.visible().epoch,nextEpoch:crypto.randomUUID() }); }
  importStats(stats: StatsData, importId: string) {
    const epoch=this.visible().epoch;
    this.add({type:'stats.import',epoch,importId:`${importId}:total`,data:{...emptyStats(),totalMs:stats.totalMs}});
    // Each chunk has a stable id so interrupted migrations can be retried,
    // including libraries too large for one API request.
    for(const field of ['days','artists','tracks'] as const) {
      const entries=Object.entries(stats[field]).sort(([a],[b])=>a.localeCompare(b));
      for(let i=0;i<entries.length;i+=40) this.add({type:'stats.import',epoch,importId:`${importId}:${field}:${i}`,data:{...emptyStats(),[field]:Object.fromEntries(entries.slice(i,i+40))}});
    }
  }
  async exchange() {
    if (!this.active || this.running) return;
    this.running = true; this.status?.('syncing');
    const revision = this.revision;
    try {
      this.flushTime();
      do {
        let batch = this.cache.pending.slice(0,10);
        while(batch.length > 1 && JSON.stringify(batch).length > 200000) batch = batch.slice(0,Math.ceil(batch.length/2));
        const r = await siteApi<Exchange>('/sync/exchange',{cursor:this.cache.cursor,operations:batch},this.userId);
        if (!this.active || revision !== this.revision) return;
        if (r.snapshot) {
          this.cache.state = {playlists:r.snapshot.playlists.map(p=>({...p,tracks:p.tracks.map(t=>hydrate(t,t.id))})),stats:emptyStats(),epoch:r.snapshot.epoch};
          for(const event of r.snapshot.events) apply(this.cache.state,event);
        } else for(const op of r.changes) apply(this.cache.state,op);
        this.cache.cursor = r.cursor;
        const ack = new Set(r.acknowledged); this.cache.pending = this.cache.pending.filter(o=>!ack.has(o.id));
        this.persist();
        if (!r.hasMore && !this.cache.pending.length) break;
      } while(this.active);
      if(this.active && revision === this.revision) {
        const visible = this.visible();
        if(this.buffered) apply(visible,this.buffered);
        this.observed = clone(visible.playlists);
        this.listener?.(visible); this.status?.(this.persist() ? 'synced' : 'retry');
      }
    } catch { if(this.active && revision === this.revision)this.status?.('retry'); }
    finally {if(revision === this.revision)this.running=false;}
  }
}
