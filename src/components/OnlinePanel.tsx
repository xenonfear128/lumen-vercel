import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { Player } from "../hooks/usePlayer";
import { Button } from "./Button";
import { Cover } from "./Cover";
import { Plus, QrCode, Refresh, Search, X, LogOut } from "./Icons";
import { cn } from "../utils/cn";
import {
  extractPlaylistId,
  loginQrCheck,
  loginQrImage,
  loginQrKey,
  loginStatus,
  logout,
  makeNeteasePlaylist,
  playlistDetail,
  playlistTracks,
  search,
  songToTrack,
  userPlaylists,
  type NeteaseSong,
  type QualityLevel,
  type NeteaseConfig,
} from "../lib/netease";
import type { Track } from "../lib/types";
import { fmtTime } from "../lib/format";

type Tab = "search" | "import" | "account";

const PAGE = 30;

export function OnlinePanel({ player, onClose }: { player: Player; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("search");
  const cfg = player.netease;

  // search
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NeteaseSong[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const seqRef = useRef(0);

  // import
  const [importId, setImportId] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [myLists, setMyLists] = useState<{ id: number; name: string; trackCount?: number }[] | null>(null);
  const [myListsError, setMyListsError] = useState(false);
  const [myListsRefresh, setMyListsRefresh] = useState(0);
  const myListsSeqRef = useRef(0);

  // login
  const [qrKey, setQrKey] = useState<string | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [qrState, setQrState] = useState<"waiting" | "scanned" | "expired">("waiting");
  const [account, setAccount] = useState<{ nickname: string | null } | null>(null);
  const accountUid = account?.nickname ?? null;
  const qrGeneration = useRef(0);
  const statusGeneration = useRef(0);
  const [qrBusy, setQrBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);

  const stopPoll = useCallback(() => {
    if (pollTimeoutRef.current != null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // `player.netease` is the config object; `setNeteaseConfig` is a stable useCallback.
  // Pulling it out of `player` here keeps the poll effect's deps from changing on every
  // render (e.g. while playback ticks), which would otherwise reset the interval before
  // it ever fires and the scan would never be noticed.
  const setNeteaseConfig = player.setNeteaseConfig;

  /** Query login status against an explicit config. Falls back to the current cfg when omitted. */
  const checkLogin = useCallback(async (target?: NeteaseConfig) => {
    const generation = ++statusGeneration.current;
    try {
      const { nickname } = await loginStatus(target ?? cfg);
      if (generation !== statusGeneration.current) return null;
      setLoginError(null);
      setAccount({ nickname });
      return nickname;
    } catch {
      if (generation !== statusGeneration.current) return null;
      setLoginError(t.apiUnreachable);
      setAccount({ nickname: null });
      return null;
    }
  }, [cfg, t.apiUnreachable]);

  // Start QR flow
  const startQr = useCallback(async () => {
    const generation = ++qrGeneration.current;
    stopPoll();
    setQrBusy(true);
    setLoginError(null);
    setQrState("waiting");
    setQrImg(null);
    setQrKey(null);
    try {
      const key = await loginQrKey(cfg);
      const { qrimg } = await loginQrImage(cfg, key);
      if (generation !== qrGeneration.current) return;
      setQrKey(key);
      setQrImg(qrimg);
    } catch {
      if (generation === qrGeneration.current) setLoginError(t.apiUnreachable);
    } finally {
      if (generation === qrGeneration.current) setQrBusy(false);
    }
  }, [cfg, t.apiUnreachable, stopPoll]);

  // Kick off / restart polling.
  // `active` is per-effect-run: it is set false on cleanup or when the poll ends (scan
  // detected, expired, or too many failures), so a stale chain can never keep going after
  // the user refreshes the QR code. Scheduling uses a single timeout handle stored in
  // `pollTimeoutRef`; the next poll only runs after the current one resolves, so requests
  // never overlap.
  useEffect(() => {
    if (!qrKey || !qrImg) return;
    stopPoll();
    let active = true;
    const generation = qrGeneration.current;
    let failures = 0;
    setLoginError(null);
    const poll = async () => {
      if (!active || generation !== qrGeneration.current) return;
      try {
        const r = await loginQrCheck(cfg, qrKey);
        if (!active || generation !== qrGeneration.current) return;
        failures = 0;
        setLoginError(null);
        if (r.state === "success") {
          active = false;
          stopPoll();
          const next = { ...cfg, cookie: r.cookie };
          setNeteaseConfig(next);
          setQrState("waiting");
          setQrImg(null);
          setQrKey(null);
          // Query status with the NEW config, not the stale closure cfg.
          await checkLogin(next);
          return;
        } else if (r.state === "scanned") {
          setQrState("scanned");
        } else if (r.state === "expired") {
          active = false;
          stopPoll();
          setQrState("expired");
          return;
        }
      } catch {
        if (!active || generation !== qrGeneration.current) return;
        failures += 1;
        if (failures >= 8) {
          active = false;
          stopPoll();
          setLoginError(t.apiUnreachable);
          return;
        }
      }
      if (active) pollTimeoutRef.current = window.setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      active = false;
      stopPoll();
    };
  }, [qrKey, qrImg, cfg, setNeteaseConfig, stopPoll, checkLogin, t.apiUnreachable]);

  // load account status once on mount
  useEffect(() => {
    void checkLogin();
    return () => {
      qrGeneration.current += 1;
      statusGeneration.current += 1;
      stopPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSearch = useCallback(
    async (kw: string, off: number) => {
      const seq = ++seqRef.current;
      if (!kw.trim()) {
        setResults([]);
        setHasMore(false);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await search(cfg, kw.trim(), PAGE, off);
        if (seq !== seqRef.current) return;
        setResults((prev) => (off === 0 ? res.songs : [...prev, ...res.songs]));
        setOffset(off + res.songs.length);
        setHasMore(res.songs.length === PAGE && (res.songCount ?? 0) > off + res.songs.length);
      } catch {
        if (seq === seqRef.current) setError(t.searchFailed);
      } finally {
        if (seq === seqRef.current) setBusy(false);
      }
    },
    [cfg, t.searchFailed],
  );

  const addToTemp = useCallback(
    (songs: NeteaseSong[]) => {
      player.addNeteaseSongsToTemp(songs.map(songToTrack));
    },
    [player],
  );

  const playNow = useCallback(
    async (songs: NeteaseSong[]) => {
      const tracks = songs.map(songToTrack);
      player.addNeteaseSongsToTemp(tracks);
      player.playOnlineTrack(tracks[0], "temp");
      onClose();
    },
    [player, onClose],
  );

  const importById = useCallback(
    async (idRaw: string) => {
      const id = extractPlaylistId(idRaw);
      if (!id) {
        setImportMsg(t.importFailed);
        return;
      }
      setImportBusy(true);
      setImportMsg(null);
      try {
        const meta = await playlistDetail(cfg, id);
        const tracks: Track[] = [];
        let off = 0;
        for (;;) {
          const page = await playlistTracks(cfg, id, 1000, off);
          if (!page.length) break;
          tracks.push(...page.map(songToTrack));
          off += page.length;
        }
        player.addNeteasePlaylist(makeNeteasePlaylist(meta, tracks));
        setImportMsg(t.imported);
        setImportId("");
      } catch {
        setImportMsg(t.importFailed);
      } finally {
        setImportBusy(false);
      }
    },
    [cfg, player, t.imported, t.importFailed],
  );

  const loadMyLists = useCallback(async () => {
    const seq = ++myListsSeqRef.current;
    setMyListsError(false);
    try {
      const st = await loginStatus(cfg);
      if (seq !== myListsSeqRef.current) return;
      if (!st.uid) {
        setMyLists([]);
        return;
      }
      const lists = await userPlaylists(cfg, st.uid);
      if (seq !== myListsSeqRef.current) return;
      setMyLists(lists);
    } catch {
      if (seq !== myListsSeqRef.current) return;
      setMyListsError(true);
    }
  }, [cfg]);

  // Auto-load "my playlists" when the import tab is active and the user is logged in.
  // Re-runs when the account changes, the tab is opened, or the user retries.
  useEffect(() => {
    if (tab !== "import" || !accountUid) return;
    setMyLists(null);
    void loadMyLists();
  }, [tab, accountUid, loadMyLists, myListsRefresh]);

  const doLogout = useCallback(async () => {
    qrGeneration.current += 1;
    statusGeneration.current += 1;
    stopPoll();
    setQrImg(null);
    setQrKey(null);
    try {
      await logout(cfg);
    } catch {}
    player.setNeteaseConfig({ cookie: null });
    setAccount({ nickname: null });
    setMyLists(null);
  }, [cfg, player]);

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] p-1 glass w-fit">
        {(
          [
            { k: "search", label: t.onlineSearch },
            { k: "import", label: t.importPlaylist },
            { k: "account", label: t.onlineMusic },
          ] as { k: Tab; label: string }[]
        ).map((it) => (
          <button
            key={it.k}
            type="button"
            onClick={() => setTab(it.k)}
            className={cn("btn h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium", tab === it.k ? "btn-active" : "btn-ghost text-muted")}
          >
            {it.label}
          </button>
        ))}
      </div>

      {/* ---- Search ---- */}
      {tab === "search" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="glass flex h-9 min-w-0 flex-[1_1_12rem] items-center gap-2 rounded-full px-3">
              <Search size={14} className="shrink-0 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSearch(q, 0);
                }}
                placeholder={t.onlineSearchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
              />
              {q && (
                <button type="button" className="btn shrink-0 rounded-full p-0.5 text-muted" onClick={() => setQ("")}>
                  <X size={13} />
                </button>
              )}
            </label>
            <Button variant="primary" onClick={() => doSearch(q, 0)} disabled={busy || !q.trim()}>
              {t.onlineSearch}
            </Button>
          </div>

          {busy && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {t.searching}
            </div>
          )}
          {error && <div className="text-[12.5px] text-muted">{error}</div>}

          {results.length > 0 && (
            <button type="button" className="btn rounded-xl px-3 py-1.5 text-[12.5px] text-muted w-fit" onClick={() => addToTemp(results)}>
              + {t.addAll} ({results.length})
            </button>
          )}

          <div className="flex max-h-80 flex-col overflow-y-auto rounded-2xl border border-line">
            {results.length === 0 && !busy && !error ? (
              <div className="px-6 py-10 text-center text-[13px] text-muted">{t.searchNoResult}</div>
            ) : (
              results.map((s) => {
                const tr = songToTrack(s);
                return (
                  <div key={s.id} className="group grid grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2 transition-colors hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]">
                    <Cover track={tr} className="h-10 w-10 shrink-0" rounded="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{s.name}</div>
                      <div className="truncate text-[11.5px] text-muted">{s.ar.map((a) => a.name).join(", ")}</div>
                    </div>
                    <div className="font-mono text-[11px] text-muted tnum">{fmtTime(s.dt / 1000)}</div>
                    <button type="button" className="btn rounded-lg p-1.5 text-muted" onClick={() => addToTemp([s])} title={t.addToQueue}>
                      <Plus size={15} />
                    </button>
                    <Button className="col-start-2 col-end-5 justify-self-end" size="sm" variant="soft" onClick={() => void playNow([s])}>
                      {t.playNow}
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button size="sm" variant="soft" onClick={() => doSearch(q, offset)} disabled={busy}>
                {t.loadMore}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- Import ---- */}
      {tab === "import" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={importId}
              onChange={(e) => setImportId(e.target.value)}
              placeholder={t.playlistIdPlaceholder}
              className="glass h-9 min-w-0 flex-[1_1_12rem] rounded-full px-3 text-[13px] outline-none placeholder:text-muted"
            />
            <Button variant="primary" onClick={() => void importById(importId)} disabled={importBusy || !importId.trim()}>
              {t.importPlaylist}
            </Button>
          </div>
          {importBusy && <div className="text-[12.5px] text-muted">{t.importing}</div>}
          {importMsg && <div className="text-[12.5px] text-muted">{importMsg}</div>}

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.myPlaylists}</div>
            {account?.nickname ? (
              myListsError ? (
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span>{t.myPlaylistsError}</span>
                  <Button size="sm" variant="soft" onClick={() => setMyListsRefresh((v) => v + 1)}>
                    {t.retryLogin}
                  </Button>
                </div>
              ) : myLists === null ? (
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  {t.myPlaylistsLoading}
                </div>
              ) : myLists.length === 0 ? (
                <div className="text-[13px] text-muted">{t.myPlaylistsEmpty}</div>
              ) : (
                myLists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="btn flex items-center justify-between rounded-xl px-3 py-2 text-left text-[13px]"
                    onClick={() => void importById(String(l.id))}
                  >
                    <span className="truncate">{l.name}</span>
                    <span className="ml-3 shrink-0 font-mono text-[11px] text-muted tnum">
                      {l.trackCount ?? 0} {t.quantity}
                    </span>
                  </button>
                ))
              )
            ) : (
              <div className="text-[12.5px] text-muted">{t.loginRequired}</div>
            )}
          </div>
        </div>
      )}

      {/* ---- Account / Settings ---- */}
      {tab === "account" && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.audioProxy}</span>
              <input
                value={cfg.audioProxy ?? ""}
                onChange={(e) => player.setNeteaseConfig({ audioProxy: e.target.value || null })}
                placeholder={t.audioProxyHint}
                className="glass h-9 min-w-0 w-full rounded-full px-3 text-[13px] outline-none placeholder:text-muted"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.quality}</span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { v: "standard", label: t.qualityStandard },
                  { v: "exhigh", label: t.qualityExhigh },
                  { v: "lossless", label: t.qualityLossless },
                  { v: "hires", label: t.qualityHires },
                ] as { v: QualityLevel; label: string }[]
              ).map((o) => (
                <Button key={o.v} size="sm" variant="soft" active={cfg.level === o.v} onClick={() => player.setNeteaseConfig({ level: o.v })}>
                  {o.label}
                </Button>
              ))}
            </div>
          </label>

          {loginError && <div role="alert" className="text-[12.5px] text-muted">{loginError}</div>}
          {loginError && cfg.cookie && <Button size="sm" onClick={() => void checkLogin()}>{t.retryLogin}</Button>}
          <div className="border-t border-line pt-3">
            {account?.nickname ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <QrCode size={16} className="text-muted" />
                  <span>
                    {t.loggedInAs} <span className="font-medium">{account.nickname}</span>
                  </span>
                </div>
                <Button size="sm" variant="soft" icon={<LogOut size={15} />} onClick={() => void doLogout()}>
                  {t.logout}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="text-[12.5px] text-muted">{t.loginRequired}</div>
                {qrImg ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={qrImg} alt={t.loginQr} className="h-40 w-40 rounded-xl border border-line" />
                    <div className="text-[12.5px] text-muted">
                      {error ?? (qrState === "scanned" ? t.qrConfirmHint : qrState === "expired" ? t.qrExpired : t.qrScanHint)}
                    </div>
                    <Button size="sm" variant="soft" icon={<Refresh size={15} />} disabled={qrBusy} onClick={() => void startQr()}>
                      {t.qrRefresh}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="soft" icon={<QrCode size={15} />} onClick={() => void startQr()}>
                    {t.loginQr}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
