import { parseBlob } from "music-metadata";
import type { Track } from "./types";
import { pickFallbackCover } from "./covers";

const AUDIO_EXT = /\.(mp3|flac|wav|ogg|oga|opus|m4a|aac|mp4|wma|aiff?|alac|webm|mka)$/i;

export function isAudioFile(file: File): boolean {
  return (file.type && file.type.startsWith("audio/")) || AUDIO_EXT.test(file.name);
}

let counter = 0;
export function makeId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function createTrack(file: File): Track {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const id = makeId();
  return {
    id,
    localFileId: id,
    source: "local",
    file,
    neteaseId: null,
    path,
    fileName: file.name,
    title: null,
    artist: null,
    album: null,
    year: null,
    genre: null,
    duration: null,
    codec: null,
    bitrate: null,
    sampleRate: null,
    coverUrl: null,
    fallbackCover: pickFallbackCover(path + file.size),
    metaLoaded: false,
  };
}

/** Parse embedded metadata; returns a patch to merge into the track. */
export async function readMetadata(track: Track): Promise<Partial<Track>> {
  if (!track.file) return { metaLoaded: true };
  try {
    const meta = await parseBlob(track.file, { duration: false, skipPostHeaders: true });
    const c = meta.common;
    const f = meta.format;
    let coverUrl: string | null = null;
    const pic = c.picture?.[0];
    if (pic && pic.data && pic.data.length > 0) {
      const blob = new Blob([pic.data as BlobPart], { type: pic.format || "image/jpeg" });
      coverUrl = URL.createObjectURL(blob);
    }
    return {
      title: c.title?.trim() || null,
      artist: (c.artist || c.artists?.[0] || c.albumartist)?.trim() || null,
      album: c.album?.trim() || null,
      year: c.year ?? null,
      genre: c.genre?.[0] ?? null,
      duration: f.duration ?? null,
      codec: f.codec ?? f.container ?? null,
      bitrate: f.bitrate ?? null,
      sampleRate: f.sampleRate ?? null,
      coverUrl,
      metaLoaded: true,
    };
  } catch {
    return { metaLoaded: true };
  }
}

/** Run metadata parsing with limited concurrency; calls onUpdate as each finishes. */
export async function parseAll(
  tracks: Track[],
  onUpdate: (id: string, patch: Partial<Track>) => void,
  concurrency = 3,
) {
  let i = 0;
  const worker = async () => {
    while (i < tracks.length) {
      const t = tracks[i++];
      const patch = await readMetadata(t);
      onUpdate(t.id, patch);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, worker));
}

/** Read the actual duration through an <audio> element (fallback when the container reports none). */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      a.src = "";
      resolve(v);
    };
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

/** Resolve the top-level folder name from a webkitRelativePath list. */
export function folderNameFromFiles(files: File[]): string | null {
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (rel && rel.includes("/")) return rel.split("/")[0];
  }
  return null;
}

/** Walk dropped DataTransferItems (supports directories). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<{ files: File[]; folder: string | null }> {
  const out: File[] = [];
  let folder: string | null = null;
  const items = Array.from(dt.items || []);
  const entries = items
    .map((it) => (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter(Boolean) as FileSystemEntry[];

  if (entries.length === 0) {
    return { files: Array.from(dt.files), folder: null };
  }

  const readEntry = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      // attach a synthetic relative path
      Object.defineProperty(file, "webkitRelativePath", { value: prefix + file.name, configurable: true });
      out.push(file);
    } else if (entry.isDirectory) {
      if (!folder) folder = entry.name;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      // readEntries may return partial batches
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        all.push(...batch);
      }
      for (const e of all) await readEntry(e, prefix + entry.name + "/");
    }
  };

  for (const e of entries) await readEntry(e, "");
  return { files: out, folder };
}
