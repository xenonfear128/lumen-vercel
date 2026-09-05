import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine, EQ_PRESETS, computeAutoPreamp, type PresetKey } from "../lib/audioEngine";
import { createTrack, folderNameFromFiles, isAudioFile, makeId, parseAll, stripExt } from "../lib/metadata";
import { addListening, addPlay, emptyStats, loadStats, saveStats, trackKey, type StatsData } from "../lib/stats";
import { loadConfig, saveConfig, songUrls, applyAudioProxy, type NeteaseConfig } from "../lib/netease";
import type { PlayMode, Playlist, Track, VizMode } from "../lib/types";

const LS = {
  volume: "lumen.volume",
  mode: "lumen.mode",
  viz: "lumen.viz",
  eq: "lumen.eq",
};

interface EqState {
  enabled: boolean;
  gains: number[];
  preamp: number;
  autoGain: boolean;
  preset: PresetKey | "custom";
}

function loadEq(): EqState {
  try {
    const raw = localStorage.getItem(LS.eq);
    if (raw) return { ...defaultEq(), ...(JSON.parse(raw) as Partial<EqState>) };
  } catch {}
  return defaultEq();
}
function defaultEq(): EqState {
  return { enabled: true, gains: EQ_PRESETS.flat.slice(), preamp: 0, autoGain: true, preset: "flat" };
}

export function usePlayer() {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;
  const audio = engine.audio;

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [viewPlaylistId, setViewPlaylistId] = useState<string | null>(null);
  const [queuePlaylistId, setQueuePlaylistId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem(LS.volume) || "0.8");
    return isNaN(v) ? 0.8 : v;
  });
  const [muted, setMuted] = useState(false);
  const [mode, setModeState] = useState<PlayMode>(() => (localStorage.getItem(LS.mode) as PlayMode) || "repeat-all");
  const [viz, setVizState] = useState<VizMode>(() => (localStorage.getItem(LS.viz) as VizMode) || "bars");
  const [eq, setEq] = useState<EqState>(loadEq);
  const [stats, setStats] = useState<StatsData>(loadStats);
  const [sessionMs, setSessionMs] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [netease, setNetease] = useState<NeteaseConfig>(loadConfig);

  const historyRef = useRef<string[]>([]);
  const urlRef = useRef<string | null>(null);
  const lastTickRef = useRef<number | null>(null);
  // Monotonic token so an out-of-order async URL resolution can't clobber a newer track.
  const loadSeqRef = useRef(0);
  // Consecutive "no playable URL" strikes; guards against infinite auto-advance.
  const deadStreakRef = useRef(0);
  // Holds the latest `next` so async loadTrack can advance without a self-referential dep.
  const nextRef = useRef<() => void>(() => {});
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const saveTimer = useRef<number | null>(null);

  // Latest-state refs for event handlers
  const stateRef = useRef({ playlists, queuePlaylistId, currentId, mode });
  stateRef.current = { playlists, queuePlaylistId, currentId, mode };

  // ---------- NetEase online library persistence ----------
  const ONLINE_KEY = "lumen.online.v1";
  const hydratedRef = useRef(false);
  useEffect(() => {
    // Hydrate once on mount: re-create online playlists from localStorage.
    // StrictMode re-runs mount effects in dev, so guard with a ref and dedupe by id.
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = localStorage.getItem(ONLINE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Playlist[];
      if (!Array.isArray(saved)) return;
      const online = saved.filter((p) => p.kind === "netease" && Array.isArray(p.tracks));
      // Dedupe within the saved set (a corrupted run may have persisted duplicates) and against current state.
      const seen = new Set<string>();
      const deduped = online.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      if (deduped.length) {
        setPlaylists((pls) => {
          const existing = new Set(pls.map((p) => p.id));
          return [...pls, ...deduped.filter((p) => !existing.has(p.id))];
        });
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Persist online playlists (defer with a timeout so a burst of edits coalesces).
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      try {
        const online = stateRef.current.playlists.filter((p) => p.kind === "netease");
        localStorage.setItem(ONLINE_KEY, JSON.stringify(online));
      } catch {}
    }, 400);
  }, [playlists]);

  useEffect(() => {
    saveConfig(netease);
  }, [netease]);

  // ---------- Derived ----------
  const queue = useMemo(() => playlists.find((p) => p.id === queuePlaylistId)?.tracks ?? [], [playlists, queuePlaylistId]);
  const viewPlaylist = useMemo(() => playlists.find((p) => p.id === viewPlaylistId) ?? null, [playlists, viewPlaylistId]);
  const current = useMemo(() => {
    for (const p of playlists) {
      const t = p.tracks.find((x) => x.id === currentId);
      if (t) return t;
    }
    return null;
  }, [playlists, currentId]);

  // ---------- Audio element wiring ----------
  useEffect(() => {
    audio.volume = volume;
  }, [audio, volume]);
  useEffect(() => {
    audio.muted = muted;
  }, [audio, muted]);

  const applyEqToEngine = useCallback(
    (s: EqState) => {
      engine.setEnabled(s.enabled);
      engine.setGains(s.gains);
      engine.setPreamp(s.autoGain ? computeAutoPreamp(s.gains) : s.preamp);
    },
    [engine],
  );

  useEffect(() => {
    applyEqToEngine(eq);
    localStorage.setItem(LS.eq, JSON.stringify(eq));
  }, [eq, applyEqToEngine]);

  const persistStats = useCallback((s: StatsData) => {
    if (saveTimer.current) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      saveStats(s);
    }, 4000);
  }, []);

  const loadTrack = useCallback(
    async (track: Track, autoplay = true) => {
      const seq = ++loadSeqRef.current;
      engine.ensureContext();
      // Immediately reflect the selection in the UI so a click always gives feedback.
      setCurrentId(track.id);
      setCurrentTime(0);
      setDuration(track.duration ?? 0);
      lastTickRef.current = null;
      setTrackError(null);

      let src: string;
      if (track.source === "local" && track.file) {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        src = URL.createObjectURL(track.file);
        urlRef.current = src;
      } else if (track.source === "netease" && track.neteaseId != null) {
        setResolving(true);
        let url: string | null = null;
        try {
          const map = await songUrls(netease, [track.neteaseId]);
          url = map.get(track.neteaseId) ?? null;
        } catch {
          url = null;
        }
        setResolving(false);
        // A newer load superseded this one while the URL was being fetched.
        if (seq !== loadSeqRef.current) return;
        if (!url) {
          deadStreakRef.current += 1;
          const qid = stateRef.current.queuePlaylistId;
          const queueLen = stateRef.current.playlists.find((p) => p.id === qid)?.tracks.length ?? 0;
          setTrackError(track.title ?? track.fileName);
          if (deadStreakRef.current >= Math.max(1, queueLen)) {
            // The whole queue has no playable URLs — stop rather than loop forever.
            setPlaying(false);
            audio.removeAttribute("src");
            audio.load();
            return;
          }
          nextRef.current();
          return;
        }
        deadStreakRef.current = 0;
        src = applyAudioProxy(netease, url);
      } else {
        return;
      }

      audio.src = src;
      // play count
      const key = trackKey(track.title ?? "Unknown", track.artist ?? "Unknown", track.album ?? "Unknown", track.fileName);
      const nxt = addPlay(statsRef.current, key, track.title ?? track.fileName, track.artist ?? "Unknown");
      setStats(nxt);
      persistStats(nxt);
      if (autoplay) void audio.play().catch(() => {});
    },
    [audio, engine, netease, persistStats],
  );

  const pickNext = useCallback((direction: 1 | -1): Track | null => {
    const { playlists, queuePlaylistId, currentId, mode } = stateRef.current;
    const list = playlists.find((p) => p.id === queuePlaylistId)?.tracks ?? [];
    if (list.length === 0) return null;
    const idx = list.findIndex((t) => t.id === currentId);

    if (mode === "shuffle") {
      if (direction === -1) {
        const hist = historyRef.current;
        hist.pop(); // current
        while (hist.length) {
          const id = hist.pop()!;
          const t = list.find((x) => x.id === id);
          if (t) {
            hist.push(id);
            return t;
          }
        }
        return list[Math.floor(Math.random() * list.length)];
      }
      const recent = new Set(historyRef.current.slice(-Math.min(list.length - 1, 30)));
      const candidates = list.filter((t) => !recent.has(t.id) && t.id !== currentId);
      const pool = candidates.length ? candidates : list.filter((t) => t.id !== currentId);
      const chosen = (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length ? pool.length : list.length))];
      return chosen;
    }
    // repeat-all / repeat-one manual skip
    if (idx === -1) return list[0];
    return list[(idx + direction + list.length) % list.length];
  }, []);

  const playTrackById = useCallback(
    (id: string, playlistId?: string) => {
      const pid = playlistId ?? stateRef.current.queuePlaylistId ?? viewPlaylistId;
      const pl = stateRef.current.playlists.find((p) => p.id === pid);
      const t = pl?.tracks.find((x) => x.id === id);
      if (!t || !pl) return;
      setQueuePlaylistId(pl.id);
      historyRef.current.push(t.id);
      if (historyRef.current.length > 200) historyRef.current.shift();
      void loadTrack(t);
    },
    [loadTrack, viewPlaylistId],
  );

  const next = useCallback(() => {
    const t = pickNext(1);
    if (!t) return;
    historyRef.current.push(t.id);
    void loadTrack(t);
  }, [pickNext, loadTrack]);

  const prev = useCallback(() => {
    if (audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    const t = pickNext(-1);
    if (!t) return;
    if (stateRef.current.mode !== "shuffle") historyRef.current.push(t.id);
    void loadTrack(t);
  }, [audio, pickNext, loadTrack]);

  // Keep nextRef pointing at the latest `next` so the async loadTrack can advance safely.
  useEffect(() => {
    nextRef.current = next;
  });

  useEffect(() => {
    const onPlay = () => {
      setPlaying(true);
      lastTickRef.current = performance.now();
    };
    const onPause = () => {
      setPlaying(false);
      lastTickRef.current = null;
    };
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (!audio.paused && lastTickRef.current != null) {
        const now = performance.now();
        const delta = now - lastTickRef.current;
        lastTickRef.current = now;
        if (delta > 0 && delta < 2500) {
          const { playlists, currentId } = stateRef.current;
          let tr: Track | undefined;
          for (const p of playlists) {
            tr = p.tracks.find((x) => x.id === currentId);
            if (tr) break;
          }
          if (tr) {
            const key = trackKey(tr.title ?? "Unknown", tr.artist ?? "Unknown", tr.album ?? "Unknown", tr.fileName);
            const ns = addListening(statsRef.current, key, tr.title ?? tr.fileName, tr.artist ?? "Unknown", delta);
            statsRef.current = ns;
            setStats(ns);
            setSessionMs((v) => v + delta);
            persistStats(ns);
          }
        }
      }
    };
    const onDur = () => {
      if (isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onEnded = () => {
      const { mode } = stateRef.current;
      if (mode === "repeat-one") {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
        return;
      }
      const t = pickNext(1);
      if (t) {
        historyRef.current.push(t.id);
        void loadTrack(t);
      } else {
        setPlaying(false);
      }
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("durationchange", onDur);
    audio.addEventListener("ended", onEnded);
    const flush = () => saveStats(statsRef.current);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("durationchange", onDur);
      audio.removeEventListener("ended", onEnded);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [audio, loadTrack, pickNext, persistStats]);

  // Media Session
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (current) {
      ms.metadata = new MediaMetadata({
        title: current.title ?? stripExt(current.fileName),
        artist: current.artist ?? "Unknown",
        album: current.album ?? "Unknown",
        artwork: current.coverUrl ? [{ src: current.coverUrl }] : [],
      });
    }
    ms.setActionHandler("play", () => void audio.play());
    ms.setActionHandler("pause", () => audio.pause());
    ms.setActionHandler("previoustrack", prev);
    ms.setActionHandler("nexttrack", next);
  }, [current, audio, prev, next]);

  // ---------- Public actions ----------
  const toggle = useCallback(() => {
    engine.ensureContext();
    if (!audio.src) {
      const list = stateRef.current.playlists.find((p) => p.id === (stateRef.current.queuePlaylistId ?? viewPlaylistId));
      const first = list?.tracks[0];
      if (first && list) {
        setQueuePlaylistId(list.id);
        historyRef.current.push(first.id);
        void loadTrack(first);
      }
      return;
    }
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }, [audio, engine, loadTrack, viewPlaylistId]);

  const seek = useCallback(
    (t: number) => {
      audio.currentTime = Math.max(0, Math.min(t, audio.duration || t));
      setCurrentTime(audio.currentTime);
    },
    [audio],
  );

  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(1, v));
    setVolumeState(c);
    localStorage.setItem(LS.volume, String(c));
    if (c > 0) setMuted(false);
  }, []);

  const setMode = useCallback((m: PlayMode) => {
    setModeState(m);
    localStorage.setItem(LS.mode, m);
  }, []);
  const cycleMode = useCallback(() => {
    const order: PlayMode[] = ["repeat-all", "repeat-one", "shuffle"];
    const m = order[(order.indexOf(stateRef.current.mode) + 1) % order.length];
    setMode(m);
  }, [setMode]);

  const setViz = useCallback((v: VizMode) => {
    setVizState(v);
    localStorage.setItem(LS.viz, v);
  }, []);

  // EQ
  const setEqBand = useCallback((i: number, db: number) => {
    setEq((s) => {
      const gains = s.gains.slice();
      gains[i] = db;
      return { ...s, gains, preset: "custom" };
    });
  }, []);
  const setEqPreset = useCallback((k: PresetKey) => {
    setEq((s) => ({ ...s, gains: EQ_PRESETS[k].slice(), preset: k }));
  }, []);
  const setEqEnabled = useCallback((v: boolean) => setEq((s) => ({ ...s, enabled: v })), []);
  const setEqPreamp = useCallback((db: number) => setEq((s) => ({ ...s, preamp: db, autoGain: false })), []);
  const setEqAutoGain = useCallback((v: boolean) => setEq((s) => ({ ...s, autoGain: v })), []);
  const resetEq = useCallback(() => setEq((s) => ({ ...defaultEq(), enabled: s.enabled })), []);

  // Library
  const patchTrack = useCallback((id: string, patch: Partial<Track>) => {
    setPlaylists((pls) =>
      pls.map((p) => (p.tracks.some((t) => t.id === id) ? { ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : p)),
    );
  }, []);

  const ingest = useCallback(
    async (rawFiles: File[], opts: { folderName?: string | null; asTemp?: boolean }) => {
      const files = rawFiles.filter(isAudioFile);
      if (!files.length) return;
      files.sort((a, b) => {
        const pa = (a as File & { webkitRelativePath?: string }).webkitRelativePath || a.name;
        const pb = (b as File & { webkitRelativePath?: string }).webkitRelativePath || b.name;
        return pa.localeCompare(pb, undefined, { numeric: true, sensitivity: "base" });
      });
      const tracks = files.map(createTrack);
      const folder = opts.asTemp ? null : opts.folderName ?? folderNameFromFiles(files);

      const TEMP_ID = "temp";
      const targetId = folder ? makeId() : TEMP_ID;
      setPlaylists((pls) => {
        if (folder) {
          const pl: Playlist = { id: targetId, name: folder, kind: "folder", neteaseId: null, tracks };
          return [...pls, pl];
        }
        const existing = pls.find((p) => p.id === TEMP_ID);
        if (existing) {
          return pls.map((p) => (p.id === TEMP_ID ? { ...p, tracks: [...p.tracks, ...tracks] } : p));
        }
        const pl: Playlist = { id: TEMP_ID, name: "__temp__", kind: "temp", neteaseId: null, tracks };
        return [...pls, pl];
      });
      setViewPlaylistId(targetId);
      setLoadingCount((c) => c + tracks.length);
      await parseAll(tracks, (id, patch) => {
        patchTrack(id, patch);
        setLoadingCount((c) => Math.max(0, c - 1));
      });
    },
    [patchTrack],
  );

  const addFolder = useCallback((files: File[]) => ingest(files, {}), [ingest]);
  const addFiles = useCallback((files: File[]) => ingest(files, { asTemp: true }), [ingest]);

  // ---------- NetEase online library actions ----------

  /** Import a fetched online playlist as its own playlist. */
  const addNeteasePlaylist = useCallback(
    (pl: Playlist) => {
      setPlaylists((pls) => {
        if (pls.some((p) => p.id === pl.id)) return pls; // already imported
        return [...pls, pl];
      });
      setViewPlaylistId(pl.id);
      if (pl.tracks.length) {
        setQueuePlaylistId((qid) => qid ?? pl.id);
      }
      return pl.id;
    },
    [],
  );

  /** Add online songs into the temp playlist (existing temp list, or create one). */
  const addNeteaseSongsToTemp = useCallback((tracks: Track[]) => {
    if (!tracks.length) return;
    setPlaylists((pls) => {
      const existing = pls.find((p) => p.id === "temp");
      if (existing) {
        return pls.map((p) => (p.id === "temp" ? { ...p, tracks: [...p.tracks, ...tracks] } : p));
      }
      const pl: Playlist = { id: "temp", name: "__temp__", kind: "temp", neteaseId: null, tracks };
      return [...pls, pl];
    });
    setViewPlaylistId("temp");
  }, []);

  /** Play one online song immediately (add to temp, then start it). */
  const playOnlineTrack = useCallback(
    (track: Track, playlistId: string) => {
      setQueuePlaylistId(playlistId);
      historyRef.current.push(track.id);
      if (historyRef.current.length > 200) historyRef.current.shift();
      void loadTrack(track);
    },
    [loadTrack],
  );

  const setNeteaseConfig = useCallback((patch: Partial<NeteaseConfig>) => {
    setNetease((c) => ({ ...c, ...patch }));
  }, []);

  const clearTrackError = useCallback(() => setTrackError(null), []);

  const removePlaylist = useCallback(
    (id: string) => {
      setPlaylists((pls) => {
        const pl = pls.find((p) => p.id === id);
        pl?.tracks.forEach((t) => t.coverUrl?.startsWith("blob:") && URL.revokeObjectURL(t.coverUrl));
        return pls.filter((p) => p.id !== id);
      });
      if (stateRef.current.queuePlaylistId === id) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        setCurrentId(null);
        setQueuePlaylistId(null);
        setCurrentTime(0);
        setDuration(0);
      }
      setViewPlaylistId((v) => (v === id ? null : v));
    },
    [audio],
  );

  const removeTrack = useCallback(
    (playlistId: string, trackId: string) => {
      if (stateRef.current.currentId === trackId) {
        next();
        if (stateRef.current.playlists.find((p) => p.id === playlistId)?.tracks.length === 1) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          setCurrentId(null);
        }
      }
      setPlaylists((pls) =>
        pls.map((p) => {
          if (p.id !== playlistId) return p;
          const t = p.tracks.find((x) => x.id === trackId);
          if (t?.coverUrl?.startsWith("blob:")) URL.revokeObjectURL(t.coverUrl);
          return { ...p, tracks: p.tracks.filter((x) => x.id !== trackId) };
        }),
      );
    },
    [audio, next],
  );

  const clearStats = useCallback(() => {
    const e = emptyStats();
    setStats(e);
    saveStats(e);
    setSessionMs(0);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight" && e.shiftKey) next();
      else if (e.code === "ArrowLeft" && e.shiftKey) prev();
      else if (e.code === "ArrowRight") seek(audio.currentTime + 5);
      else if (e.code === "ArrowLeft") seek(audio.currentTime - 5);
      else if (e.code === "ArrowUp") {
        e.preventDefault();
        setVolume(audio.volume + 0.05);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        setVolume(audio.volume - 0.05);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, next, prev, seek, setVolume, audio]);

  const viewSelectedPlaylistId = viewPlaylistId ?? queuePlaylistId ?? playlists[0]?.id ?? null;
  const effectiveViewPlaylist = viewPlaylist ?? playlists.find((p) => p.id === viewSelectedPlaylistId) ?? null;

  return {
    engine,
    playlists,
    viewPlaylist: effectiveViewPlaylist,
    viewPlaylistId: viewSelectedPlaylistId,
    setViewPlaylistId,
    queuePlaylistId,
    queue,
    current,
    playing,
    currentTime,
    duration,
    volume,
    muted,
    setMuted,
    mode,
    viz,
    eq,
    stats,
    sessionMs,
    loadingCount,
    resolving,
    trackError,
    netease,
    toggle,
    seek,
    setVolume,
    setMode,
    cycleMode,
    setViz,
    setEqBand,
    setEqPreset,
    setEqEnabled,
    setEqPreamp,
    setEqAutoGain,
    resetEq,
    addFolder,
    addFiles,
    addNeteasePlaylist,
    addNeteaseSongsToTemp,
    playOnlineTrack,
    setNeteaseConfig,
    clearTrackError,
    removePlaylist,
    removeTrack,
    playTrackById,
    next,
    prev,
    clearStats,
  };
}

export type Player = ReturnType<typeof usePlayer>;
