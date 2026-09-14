export type TrackSource = "local" | "netease";

export interface Track {
  id: string;
  /** Stable device-file reference, independent of this playlist entry. */
  localFileId?: string | null;
  source: TrackSource;
  file: File | null;
  /** Opaque device capability, never synchronized. */
  localUrl?: string;
  neteaseId: number | null;
  path: string;
  fileName: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  coverUrl: string | null;
  fallbackCover: number;
  metaLoaded: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  kind: "folder" | "temp" | "netease";
  neteaseId: number | null;
  tracks: Track[];
}

export type PlayMode = "shuffle" | "repeat-all" | "repeat-one";
export type VizMode = "off" | "bars" | "wave" | "ring";
