import { native } from './device';
import { deviceStorage as localStorage } from './device';
import type { Playlist } from './types';
import { profileKey } from './profile';

const KEY = 'lumen.library.v1';
const LEGACY_KEY = 'lumen.online.v1';
export interface LibrarySnapshot {
  playlists: Playlist[];
  viewPlaylistId: string | null;
  queuePlaylistId: string | null;
  currentId: string | null;
}
export function loadLibrary(scope = 'guest'): LibrarySnapshot {
  const empty: LibrarySnapshot = { playlists: [], viewPlaylistId: null, queuePlaylistId: null, currentId: null };
  try {
    const raw = localStorage.getItem(profileKey(KEY, scope));
    const saved = raw ? JSON.parse(raw) : { playlists: JSON.parse(localStorage.getItem(profileKey(LEGACY_KEY, scope)) || '[]') };
    const seen = new Set<string>();
    const playlists: Playlist[] = (Array.isArray(saved?.playlists) ? saved.playlists : [])
      .filter((p: Playlist) => p && typeof p.id === 'string' && typeof p.name === 'string' && ['folder', 'temp', 'netease'].includes(p.kind) && Array.isArray(p.tracks))
      .filter((p: Playlist) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .map((p: Playlist) => ({ ...p, tracks: p.tracks.filter(t => t && typeof t.id === 'string' && ['local', 'netease'].includes(t.source)).map(t => ({ ...t, file: null, localUrl: undefined, coverUrl: t.coverUrl?.startsWith('blob:') ? null : t.coverUrl })) }));
    const entries = new Set<string>();
    for (const playlist of playlists) for (const track of playlist.tracks) {
      if (track.source === 'local') track.localFileId ||= track.id;
      if (entries.has(track.id)) track.id = crypto.randomUUID();
      entries.add(track.id);
    }
    return {
      playlists,
      viewPlaylistId: playlists.some(p => p.id === saved.viewPlaylistId) ? saved.viewPlaylistId : playlists[0]?.id ?? null,
      queuePlaylistId: playlists.some(p => p.id === saved.queuePlaylistId) ? saved.queuePlaylistId : playlists[0]?.id ?? null,
      currentId: playlists.some(p => p.tracks.some(t => t.id === saved.currentId)) ? saved.currentId : null,
    };
  } catch { return empty; }
}
export function saveLibrary(snapshot: LibrarySnapshot, scope = 'guest') {
  localStorage.setItem(profileKey(KEY, scope), JSON.stringify({ ...snapshot, playlists: snapshot.playlists.map(p => ({ ...p, tracks: p.tracks.map(t => ({ ...t, file: null, localUrl: undefined, coverUrl: t.coverUrl?.startsWith('blob:') ? null : t.coverUrl })) })) }));
}

function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lumen-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export async function storeFiles(files: { id: string; localFileId?: string | null; file: File | null }[], scope = 'guest') {
  if (!files.some(t => t.file)) return;
  const db = await openFiles();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      for (const t of files) if (t.file) tx.objectStore('files').put(t.file, profileKey(t.localFileId || t.id, scope));
    });
  } finally { db.close(); }
}
export async function restoreFiles(ids: string[], scope = 'guest'): Promise<Map<string, File|string>> {
  if(native)return new Map(Object.entries(await native.files({ids,scope})));
  const files = new Map<string, File|string>();
  if (!ids.length) return files;
  const db = await openFiles();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      for (const id of ids) {
        const request = tx.objectStore('files').get(profileKey(id, scope));
        request.onsuccess = () => { if (request.result instanceof File) files.set(id, request.result); };
      }
    });
    return files;
  } finally { db.close(); }
}
export async function removeFiles(ids: string[], scope = 'guest') {
  if(native){if(ids.length)await native.files({ids,scope,remove:true});return;}
  // Record deletions synchronously so closing the page cannot lose a pending
  // IndexedDB operation. The next page resumes cleanup before restoring audio.
  const key = profileKey('lumen.library.removedFiles', scope);
  const pending: string[] = JSON.parse(localStorage.getItem(key) || '[]');
  const removed = [...new Set([...pending, ...ids])];
  if (!removed.length) return;
  localStorage.setItem(key, JSON.stringify(removed));
  const db = await openFiles();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      for (const id of removed) tx.objectStore('files').delete(profileKey(id, scope));
    });
    const latest: string[] = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify(latest.filter(id => !removed.includes(id))));
  } finally { db.close(); }
}
