import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, isTauri, type EqSettings } from "./backend";
import { MOCK_TRACKS, mockLyrics } from "./mock";
import type {
  LibraryState,
  LyricState,
  PlaybackSnapshot,
  Track,
  ViewId,
} from "./types";

// ponytail: browser/dev scenarios for state coverage; only used outside Tauri.
const scenario = location.hash.includes("empty")
  ? "empty"
  : location.hash.includes("error")
    ? "error"
    : "normal";

interface Store {
  view: ViewId;
  setView: (v: ViewId) => void;
  immersive: boolean;
  setImmersive: (b: boolean) => void;
  queueOpen: boolean;
  setQueueOpen: (b: boolean) => void;
  eqOpen: boolean;
  setEqOpen: (b: boolean) => void;

  library: LibraryState;
  scanProgress: { done: number; total: number } | null;
  reloadLibrary: () => void;
  addFolder: () => Promise<void>;

  pb: PlaybackSnapshot;
  playerError: string | null;
  lyrics: LyricState;
  queue: Track[];
  queueIndex: number;
  history: Track[];
  favorites: Set<string>;

  eq: EqSettings;
  rg: string;
  updateEq: (patch: Partial<EqSettings>) => void;
  setRg: (mode: string) => void;
  playlists: { id: number; name: string }[];
  createPlaylist: (name: string) => void;
  deletePlaylist: (id: number) => void;
  addToPlaylist: (pid: number, track: Track) => void;
  getPlaylistTracks: (pid: number) => Promise<Track[]>;

  playTrack: (t: Track, context?: Track[]) => void;
  playQueueAt: (index: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleFavorite: (id: string) => void;
}

// ponytail: browser-mode playlists live in module memory; Tauri uses SQLite
let mockPlaylists: { id: number; name: string }[] = [];
let mockPlaylistTracks = new Map<number, Track[]>();
let mockNextPid = 1;

function idxOf(list: Track[], id: string): number {
  return list.findIndex((x) => x.id === id);
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("store missing");
  return s;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewId>("library");
  const [immersive, setImmersive] = useState(false);
  const [queueOpen, setQueueOpenRaw] = useState(false);
  const [eqOpen, setEqOpenRaw] = useState(false);
  const setQueueOpen = (b: boolean) => { setQueueOpenRaw(b); if (b) setEqOpenRaw(false); };
  const setEqOpen = (b: boolean) => { setEqOpenRaw(b); if (b) setQueueOpenRaw(false); };

  const [library, setLibrary] = useState<LibraryState>({ status: "loading", tracks: [] });
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [pb, setPb] = useState<PlaybackSnapshot>({
    track: null,
    playing: false,
    position: 0,
    duration: 0,
    volume: 0.8,
    lastVolume: 0.8,
    shuffle: false,
    repeat: "off",
  });
  const [lyrics, setLyrics] = useState<LyricState>({ kind: "none" });
  const [playerError, setPlayerError] = useState<string | null>(null);
  const errTimer = useRef<number | undefined>(undefined);
  const flashError = useCallback((msg: string) => {
    setPlayerError(msg);
    window.clearTimeout(errTimer.current);
    errTimer.current = window.setTimeout(() => setPlayerError(null), 4000);
  }, []);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [history, setHistory] = useState<Track[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [playlistsState, setPlaylistsState] = useState<{ id: number; name: string }[]>([]);
  const [eq, setEq] = useState<EqSettings>({ enabled: false, preamp: 0, gains: Array(10).fill(0) });
  const [rg, setRgState] = useState("off");

  const loadTimer = useRef<number | undefined>(undefined);
  const lyricRequest = useRef(0);
  const loadTrackLyrics = useCallback((track: Track) => {
    const request = ++lyricRequest.current;
    setLyrics({ kind: "none" });
    if (!isTauri) {
      setLyrics(mockLyrics(track.id));
      return;
    }
    if (!track.path) return;
    api
      .lyricsFor(track.path)
      .then((next) => {
        if (request === lyricRequest.current) setLyrics(next);
      })
      .catch(() => {
        if (request === lyricRequest.current) setLyrics({ kind: "none" });
      });
  }, []);

  const refreshTracks = useCallback(async () => {
    const tracks = await api.tracks();
    setLibrary((l) => ({ ...l, status: tracks.length ? "ready" : "empty", tracks }));
  }, []);

  const reloadLibrary = useCallback(() => {
    window.clearTimeout(loadTimer.current);
    if (isTauri) {
      setLibrary({ status: "loading", tracks: [] });
      (async () => {
        try {
          const folders = await api.folders();
          if (folders.length === 0) {
            setLibrary({ status: "empty", tracks: [] });
            return;
          }
          await refreshTracks();
        } catch (e) {
          setLibrary({ status: "error", tracks: [], error: String(e) });
        }
      })();
      return;
    }
    // browser mock
    setLibrary({ status: "loading", tracks: [] });
    loadTimer.current = window.setTimeout(() => {
      if (scenario === "error")
        setLibrary({ status: "error", tracks: [], error: "无法访问音乐文件夹（模拟错误）" });
      else if (scenario === "empty") setLibrary({ status: "empty", tracks: [] });
      else setLibrary({ status: "ready", tracks: MOCK_TRACKS });
    }, 700);
  }, [refreshTracks]);

  useEffect(() => {
    reloadLibrary();
    return () => window.clearTimeout(loadTimer.current);
  }, [reloadLibrary]);

  useEffect(() => {
    if (!isTauri) return;
    const uns: (() => void)[] = [];
    api.onLibraryChanged(() => refreshTracks()).then((f) => uns.push(f));
    api.onScanProgress((p) => setScanProgress(p)).then((f) => uns.push(f));
    api.audioSettings().then((s) => {
      setEq(s.eq);
      setRgState(s.replayGain);
    }).catch(() => {});
    api.onTrackChanged((e) => {
      setQueueIndex(e.index);
      setQueue((q) => {
        const t = q[e.index];
        if (t?.id === String(e.id)) {
          setPb((p) => ({ ...p, track: t, position: 0, duration: t.duration }));
          loadTrackLyrics(t);
        }
        return q;
      });
    }).then((f) => uns.push(f));
    api
      .onPlayback((ev) =>
        setPb((p) => ({ ...p, position: ev.position, duration: ev.duration || p.duration, playing: ev.playing })),
      )
      .then((f) => uns.push(f));
    return () => uns.forEach((f) => f());
  }, [refreshTracks, loadTrackLyrics]);

  const addFolder = useCallback(async () => {
    if (isTauri) {
      try {
        const added = await api.addFolder();
        if (added) await refreshTracks();
        else reloadLibrary();
      } catch (e) {
        setLibrary({ status: "error", tracks: [], error: String(e) });
      }
      return;
    }
    reloadLibrary();
  }, [refreshTracks, reloadLibrary]);

  const startTrack = useCallback(
    (t: Track) => {
      loadTrackLyrics(t);
      setHistory((h) => [t, ...h.filter((x) => x.id !== t.id)].slice(0, 100));
      setPb((p) => ({ ...p, track: t, playing: true, position: 0, duration: t.duration }));
    },
    [loadTrackLyrics],
  );

  const playTrack = useCallback(
    (t: Track, context?: Track[]) => {
      const list = context && context.length ? context : library.tracks.length ? library.tracks : [t];
      const idx = idxOf(list, t.id);
      setQueue(list);
      setQueueIndex(idx < 0 ? 0 : idx);
      startTrack(t);
      if (isTauri) {
        api
          .playQueue(list.map((x) => ({ id: Number(x.id), path: x.path ?? "" })), idx < 0 ? 0 : idx)
          .catch((e) => flashError(String(e)));
      }
    },
    [library.tracks, startTrack, flashError],
  );

  const playQueueAt = useCallback(
    (index: number) => {
      const t = queue[index];
      if (!t) return;
      setQueueIndex(index);
      startTrack(t);
      if (isTauri) {
        api
          .playQueue(queue.map((x) => ({ id: Number(x.id), path: x.path ?? "" })), index)
          .catch((e) => flashError(String(e)));
      }
    },
    [queue, startTrack, flashError],
  );

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const idxRef = useRef(queueIndex);
  idxRef.current = queueIndex;
  const pbRef = useRef(pb);
  pbRef.current = pb;

  const next = useCallback(() => {
    if (isTauri) {
      api.queueNext().catch((e) => flashError(String(e)));
      return;
    }
    const q = queueRef.current;
    const i = idxRef.current;
    const p = pbRef.current;
    if (!q.length) return;
    let ni: number;
    if (p.shuffle && q.length > 1) {
      do {
        ni = Math.floor(Math.random() * q.length);
      } while (ni === i);
    } else {
      ni = i + 1;
      if (ni >= q.length) {
        if (p.repeat === "all") ni = 0;
        else {
          setPb((pp) => ({ ...pp, playing: false }));
          return;
        }
      }
    }
    setQueueIndex(ni);
    const t = q[ni];
    if (t) startTrack(t);
  }, [startTrack, flashError]);

  const prev = useCallback(() => {
    if (isTauri) {
      api.queuePrev().catch((e) => flashError(String(e)));
      return;
    }
    if (pbRef.current.position > 3) {
      setPb((pp) => ({ ...pp, position: 0 }));
      return;
    }
    const q = queueRef.current;
    const ni = idxRef.current - 1;
    if (ni >= 0 && q[ni]) {
      setQueueIndex(ni);
      startTrack(q[ni]);
    } else {
      setPb((pp) => ({ ...pp, position: 0 }));
    }
  }, [startTrack, flashError]);

  // mock playback clock (replaced by Rust player events in step 6)
  useEffect(() => {
    if (!pb.playing || isTauri) return;
    const t = window.setInterval(() => {
      setPb((p) =>
        p.track ? { ...p, position: Math.min(p.position + 0.25, p.duration) } : p,
      );
    }, 250);
    return () => window.clearInterval(t);
  }, [pb.playing]);

  // track end handling (mock mode only)
  useEffect(() => {
    if (isTauri || !pb.track || !pb.playing || pb.position < pb.duration) return;
    if (pb.repeat === "one") {
      setPb((p) => ({ ...p, position: 0 }));
      return;
    }
    next();
  }, [pb.position, pb.duration, pb.playing, pb.track, pb.repeat, next]);

  const togglePlay = useCallback(() => {
    if (isTauri) {
      api.toggle().catch((e) => flashError(String(e)));
      return;
    }
    setPb((p) => (p.track ? { ...p, playing: !p.playing } : p));
  }, [flashError]);
  const seek = useCallback(
    (t: number) => {
      if (isTauri) {
        api.seek(t).catch((e) => flashError(String(e)));
        return;
      }
      setPb((p) => ({ ...p, position: Math.min(Math.max(0, t), p.duration) }));
    },
    [flashError],
  );
  const setVolume = useCallback((v: number) => {
    const vol = Math.min(Math.max(0, v), 1);
    if (isTauri) api.setVolume(vol).catch(() => {});
    setPb((p) => ({
      ...p,
      volume: vol,
      lastVolume: vol > 0 ? vol : p.lastVolume,
    }));
  }, []);
  const toggleShuffle = useCallback(() => {
    setPb((p) => {
      if (isTauri) api.setShuffle(!p.shuffle).catch(() => {});
      return { ...p, shuffle: !p.shuffle };
    });
  }, []);
  const cycleRepeat = useCallback(() => {
    setPb((p) => {
      const nextMode = p.repeat === "off" ? "all" : p.repeat === "all" ? "one" : "off";
      if (isTauri) api.setRepeat(nextMode).catch(() => {});
      return { ...p, repeat: nextMode as typeof p.repeat };
    });
  }, []);

  const updateEq = useCallback((patch: Partial<EqSettings>) => {
    setEq((e) => {
      const nextEq = { ...e, ...patch, gains: patch.gains ?? e.gains };
      if (isTauri) api.setEq(nextEq).catch(() => {});
      return nextEq;
    });
  }, []);

  const setRg = useCallback((mode: string) => {
    setRgState(mode);
    if (isTauri) api.setReplayGain(mode).catch(() => {});
  }, []);
  const toggleFavorite = useCallback(
    (id: string) => {
      if (isTauri) {
        api
          .toggleFavorite(Number(id))
          .then((now) =>
            setFavorites((f) => {
              const n = new Set(f);
              if (now) n.add(id);
              else n.delete(id);
              return n;
            }),
          )
          .catch((e) => flashError(String(e)));
        return;
      }
      setFavorites((f) => {
        const n = new Set(f);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    },
    [flashError],
  );

  // favorites init from backend
  useEffect(() => {
    if (!isTauri) return;
    api.favoriteIds().then((ids) => setFavorites(new Set(ids.map(String)))).catch(() => {});
  }, []);

  // restore last session (queue/position/settings) at startup
  useEffect(() => {
    if (!isTauri) return;
    api
      .restore()
      .then((r) => {
        setPb((p) => ({
          ...p,
          volume: r.volume,
          lastVolume: r.lastVolume,
        }));
        if (!r.queue.length) return;
        setQueue(r.queue);
        setHistory(r.history);
        const index = Math.min(Math.max(0, r.index), r.queue.length - 1);
        setQueueIndex(index);
        const t = r.queue[index];
        if (t) {
          setPb((p) => ({
            ...p,
            track: t,
            position: r.position,
            duration: t.duration,
            playing: false,
          }));
          loadTrackLyrics(t);
        }
      })
      .catch(() => {});
  }, [loadTrackLyrics]);

  const refreshPlaylists = useCallback(() => {
    if (isTauri) api.playlists().then(setPlaylistsState).catch(() => {});
  }, []);
  useEffect(() => {
    refreshPlaylists();
  }, [refreshPlaylists]);

  const createPlaylist = useCallback(
    (name: string) => {
      if (isTauri) {
        api.createPlaylist(name).then(refreshPlaylists).catch((e) => flashError(String(e)));
        return;
      }
      const p = { id: mockNextPid++, name };
      mockPlaylists = [...mockPlaylists, p];
      setPlaylistsState(mockPlaylists);
    },
    [refreshPlaylists, flashError],
  );

  const deletePlaylist = useCallback(
    (id: number) => {
      if (isTauri) {
        api.deletePlaylist(id).then(refreshPlaylists).catch((e) => flashError(String(e)));
        return;
      }
      mockPlaylists = mockPlaylists.filter((p) => p.id !== id);
      mockPlaylistTracks.delete(id);
      setPlaylistsState(mockPlaylists);
    },
    [refreshPlaylists, flashError],
  );

  const addToPlaylist = useCallback(
    (pid: number, track: Track) => {
      if (isTauri) {
        api.playlistAdd(pid, Number(track.id)).catch((e) => flashError(String(e)));
        return;
      }
      const list = mockPlaylistTracks.get(pid) ?? [];
      mockPlaylistTracks.set(pid, [...list, track]);
    },
    [flashError],
  );

  const getPlaylistTracks = useCallback(async (pid: number): Promise<Track[]> => {
    if (isTauri) return api.playlistTracks(pid).catch(() => []);
    return mockPlaylistTracks.get(pid) ?? [];
  }, []);

  // space toggles play unless typing
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [togglePlay]);

  const value = useMemo<Store>(
    () => ({
      view,
      setView,
      immersive,
      setImmersive,
      queueOpen,
      setQueueOpen,
      eqOpen,
      setEqOpen,
      library,
      scanProgress,
      reloadLibrary,
      addFolder,
      pb,
      playerError,
      eq,
      rg,
      updateEq,
      setRg,
      playlists: playlistsState,
      createPlaylist,
      deletePlaylist,
      addToPlaylist,
      getPlaylistTracks,
      lyrics,
      queue,
      queueIndex,
      history,
      favorites,
      playTrack,
      playQueueAt,
      togglePlay,
      next,
      prev,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      toggleFavorite,
    }),
    [
      view, immersive, queueOpen, eqOpen, library, scanProgress, reloadLibrary, addFolder, pb, playerError, eq, rg, updateEq, setRg, playlistsState, createPlaylist, deletePlaylist, addToPlaylist, getPlaylistTracks, lyrics,
      queue, queueIndex, history, favorites, playTrack, playQueueAt, togglePlay, next, prev,
      seek, setVolume, toggleShuffle, cycleRepeat, toggleFavorite, updateEq, setRg, createPlaylist, deletePlaylist, addToPlaylist, getPlaylistTracks,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
