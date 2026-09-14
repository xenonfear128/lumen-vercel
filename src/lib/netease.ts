import { NETEASE_API_ORIGIN } from "../config/services";
import { profileKey } from './profile';
import { siteSession, SiteError } from './siteApi';
import type { Playlist, Track } from "./types";
import { makeId, stripExt } from "./metadata";
import { pickFallbackCover } from "./covers";

/*
 * NetEase Cloud Music client for the self-hosted `api-enhanced` service.
 *
 * Server: https://github.com/neteasecloudmusicapienhanced/api-enhanced
 * Route convention: module filename underscores -> slashes (song_url_v1.js -> /song/url/v1)
 * The session cookie is sent in the POST body (server.js merges req.body over req.query),
 * so the credential never lands in the URL query string or server access logs.
 */

export type QualityLevel = "standard" | "exhigh" | "lossless" | "hires";

export interface NeteaseConfig {
  level: QualityLevel;
  cookie: string | null;
  /** Optional CORS relay for the audio CDN. null -> direct playback. */
  audioProxy: string | null;
}

const CFG_KEY = "lumen.netease.v1";

export function defaultConfig(): NeteaseConfig {
  return { level: "exhigh", cookie: null, audioProxy: null };
}

export function loadConfig(scope = 'guest'): NeteaseConfig {
  try {
    const raw = localStorage.getItem(profileKey(CFG_KEY, scope));
    if (!raw) return defaultConfig();
    const cfg = normalizeConfig(JSON.parse(raw));
    // Remove legacy baseUrl values without discarding login or playback preferences.
    saveConfig(cfg, scope);
    return cfg;
  } catch {
    return defaultConfig();
  }
}

function normalizeConfig(value: unknown): NeteaseConfig {
  const defaults = defaultConfig();
  if (!value || typeof value !== "object") return defaults;
  const saved = value as Partial<NeteaseConfig>;
  return {
    level: saved.level && ["standard", "exhigh", "lossless", "hires"].includes(saved.level) ? saved.level : defaults.level,
    cookie: typeof saved.cookie === "string" ? saved.cookie : null,
    audioProxy: typeof saved.audioProxy === "string" ? saved.audioProxy : null,
  };
}

export function saveConfig(cfg: NeteaseConfig, scope = 'guest') {
  try {
    localStorage.setItem(profileKey(CFG_KEY, scope), JSON.stringify(normalizeConfig(cfg)));
  } catch {}
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

interface ApiEnvelope {
  code: number;
  msg?: string;
  message?: string;
  data?: any;
  [k: string]: any;
}

/** POST form-encoded. The cookie rides in the body. Returns the raw parsed JSON. */
async function call<T = ApiEnvelope>(cfg: NeteaseConfig, path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) body.set(k, String(v));
  }
  const session = siteSession();
  if (path === '/song/url/v1' && !session.user) throw new SiteError('AUTH_REQUIRED', 401);
  if (cfg.cookie && path !== '/song/url/v1') body.set("cookie", cfg.cookie);
  const res = await fetch(`${NETEASE_API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(session.csrf && { 'X-Lumen-CSRF': session.csrf }) },
    body,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    if (path === '/song/url/v1' && res.status === 401) window.dispatchEvent(new Event('lumen-session-expired'));
    throw new SiteError(error.error || 'SOURCE_UNAVAILABLE', res.status);
  }
  return (await res.json()) as T;
}

function assertOk(j: ApiEnvelope | undefined): void {
  if (!j || j.code !== 200) {
    throw new Error(`netEase API error: code ${j?.code ?? "missing"}`);
  }
}

// ---------------------------------------------------------------- types

export interface NeteaseArtist {
  id: number;
  name: string;
}
export interface NeteaseAlbum {
  id: number;
  name: string;
  picUrl?: string | null;
}
export interface NeteaseSong {
  id: number;
  name: string;
  ar: NeteaseArtist[];
  al: NeteaseAlbum;
  dt: number; // ms
  fee?: number;
  /** absent in search responses */
  st?: number;
}
export interface NeteaseSearchResult {
  songs: NeteaseSong[];
  songCount?: number;
}

export interface NeteasePlaylistMeta {
  id: number;
  name: string;
  coverImgUrl?: string | null;
  trackCount?: number;
}

// ---------------------------------------------------------------- endpoints

export async function search(cfg: NeteaseConfig, keywords: string, limit: number, offset: number): Promise<NeteaseSearchResult> {
  const j = await call<ApiEnvelope & { result?: NeteaseSearchResult }>(cfg, "/cloudsearch", {
    keywords,
    type: 1,
    limit,
    offset,
  });
  assertOk(j);
  return j.result ?? { songs: [] };
}

export async function songUrls(cfg: NeteaseConfig, ids: number[]): Promise<Map<number, string | null>> {
  const j = await call<ApiEnvelope & { data?: { id: number; url: string | null; level?: string }[] }>(cfg, "/song/url/v1", {
    id: ids.join(","),
    level: cfg.level,
  });
  assertOk(j);
  const out = new Map<number, string | null>();
  if (!Array.isArray(j.data)) throw new Error("Invalid audio response");
  for (const d of j.data) {
    // The upstream API often returns HTTP CDN URLs; HTTPS keeps hosted players
    // usable behind TLS without mixed-content failures in Web Audio.
    const url = d.url?.replace(/^http:\/\//i, "https://") ?? null;
    out.set(d.id, url);
  }
  return out;
}

export async function playlistDetail(cfg: NeteaseConfig, id: number): Promise<NeteasePlaylistMeta> {
  const j = await call<ApiEnvelope & { playlist?: NeteasePlaylistMeta & { trackIds?: { id: number }[] } }>(cfg, "/playlist/detail", { id });
  assertOk(j);
  if (!j.playlist) throw new Error("netEase playlist not found");
  return j.playlist;
}

/**
 * Fetch all songs of a playlist. `/playlist/track/all` is unreliable (it caps at ~5 songs in some
 * api-enhanced builds), so we take the full `trackIds` from `/playlist/detail` and hydrate the song
 * data in batches via `/song/detail` (which accepts up to ~1000 ids per call).
 */
export async function playlistTracks(cfg: NeteaseConfig, id: number, limit: number, offset: number): Promise<NeteaseSong[]> {
  const j = await call<ApiEnvelope & { playlist?: { trackIds?: { id: number }[]; tracks?: NeteaseSong[] } }>(cfg, "/playlist/detail", { id });
  assertOk(j);
  const trackIds = (j.playlist?.trackIds ?? []).map((x) => x.id);
  const slice = trackIds.slice(offset, offset + limit);
  if (!slice.length) return [];
  const out: NeteaseSong[] = [];
  for (let i = 0; i < slice.length; i += 500) {
    const chunk = slice.slice(i, i + 500);
    const sd = await call<ApiEnvelope & { songs?: NeteaseSong[] }>(cfg, "/song/detail", { ids: chunk.join(",") });
    assertOk(sd);
    out.push(...(sd.songs ?? []));
  }
  return out;
}

export interface NeteaseUserPlaylist {
  id: number;
  name: string;
  trackCount?: number;
  coverImgUrl?: string | null;
}
export async function userPlaylists(cfg: NeteaseConfig, uid: number): Promise<NeteaseUserPlaylist[]> {
  const j = await call<ApiEnvelope & { playlist?: NeteaseUserPlaylist[] }>(cfg, "/user/playlist", { uid, limit: 1000 });
  assertOk(j);
  return j.playlist ?? [];
}

// ---- QR login

export async function loginQrKey(cfg: NeteaseConfig): Promise<string> {
  const j = await call<ApiEnvelope & { data?: { unikey?: string; code?: number } }>(cfg, "/login/qr/key", {});
  assertOk(j);
  const key = j.data?.unikey;
  if (!key) throw new Error("netEase did not return a QR key");
  return key;
}

export async function loginQrImage(cfg: NeteaseConfig, key: string): Promise<{ qrurl: string; qrimg: string }> {
  const j = await call<ApiEnvelope & { data?: { qrurl?: string; qrimg?: string } }>(cfg, "/login/qr/create", { key, qrimg: true });
  assertOk(j);
  if (!j.data?.qrimg) throw new Error("Missing QR image");
  return { qrurl: j.data?.qrurl ?? "", qrimg: j.data.qrimg };
}

export type LoginQrState =
  | { state: "waiting" }
  | { state: "scanned" }
  | { state: "expired" }
  | { state: "success"; cookie: string; nickname: string };

export async function loginQrCheck(cfg: NeteaseConfig, key: string): Promise<LoginQrState> {
  const j = await call<ApiEnvelope & { cookie?: string; profile?: { nickname?: string } }>(cfg, "/login/qr/check", { key });
  const code = j.code;
  if (code === 803) {
    const cookie = typeof j.cookie === "string" && j.cookie.length > 0 ? j.cookie : "";
    if (!cookie.trim()) throw new Error("Missing login credential");
    return { state: "success", cookie, nickname: j.profile?.nickname ?? "" };
  }
  if (code === 802) return { state: "scanned" };
  if (code === 800) return { state: "expired" };
  if (code === 801) return { state: "waiting" };
  throw new Error("Invalid QR response");
}

export async function loginStatus(cfg: NeteaseConfig): Promise<{ nickname: string | null; uid: number | null }> {
  const j = await call<ApiEnvelope & { data?: { profile?: { nickname?: string; userId?: number } } }>(cfg, "/login/status", {});
  assertOk(j.data);
  const profile = j.data?.profile;
  return { nickname: profile?.nickname ?? null, uid: profile?.userId ?? null };
}

export async function logout(cfg: NeteaseConfig): Promise<void> {
  await call(cfg, "/logout", {});
}

// ---------------------------------------------------------------- mapping

/** Number that always seeds the same fallback cover for the same song id. */
/** Wrap a CDN audio URL in the configured proxy (or leave it untouched when none is set). */
export function applyAudioProxy(cfg: NeteaseConfig, url: string): string {
  return cfg.audioProxy ? `${normalizeBase(cfg.audioProxy)}?url=${encodeURIComponent(url)}` : url;
}

export function neteaseIdSeed(id: number): string {
  return `netease:${id}`;
}

export function songToTrack(s: NeteaseSong): Track {
  const title = s.name;
  const artist = s.ar.map((a) => a.name).join(", ");
  const album = s.al.name;
  const coverUrl = s.al.picUrl ? `${s.al.picUrl.replace(/^http:\/\//i, 'https://')}?param=512y512` : null;
  const durSec = s.dt ? s.dt / 1000 : null;
  return {
    id: makeId(),
    source: "netease",
    file: null,
    neteaseId: s.id,
    path: `netease:${s.id}`,
    fileName: `${title}.mp3`,
    title,
    artist,
    album,
    year: null,
    genre: null,
    duration: durSec,
    codec: null,
    bitrate: null,
    sampleRate: null,
    coverUrl,
    fallbackCover: pickFallbackCover(neteaseIdSeed(s.id)),
    metaLoaded: true,
  };
}

/** Extract a playlist id from a link like https://music.163.com/#/playlist?id=12345 or a bare id. */
export function extractPlaylistId(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const m = trimmed.match(/[?&](?:id=)(\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

export function makeNeteasePlaylist(meta: NeteasePlaylistMeta, tracks: Track[]): Playlist {
  return {
    id: makeId(),
    name: meta.name,
    kind: "netease",
    neteaseId: meta.id,
    tracks,
  };
}

export { stripExt, makeId };
