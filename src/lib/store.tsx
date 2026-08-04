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
import { api, isTauri } from "./backend";
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

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("store missing");
  return s;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewId>("library");
  const [immersive, setImmersive] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const [library, setLibrary] = useState<LibraryState>({ status: "loading", tracks: [] });
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [pb, setPb] = useState<PlaybackSnapshot>({
    track: null,
    playing: false,
    position: 0,
    duration: 0,
    volume: 0.8,
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

  const loadTimer = useRef<number | undefined>(undefined);

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
    api
      .onPlayback((ev) =>
        setPb((p) => ({ ...p, position: ev.position, duration: ev.duration || p.duration, playing: ev.playing })),
      )
      .then((f) => uns.push(f));
    return () => uns.forEach((f) => f());
  }, [refreshTracks]);

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
      setLyrics(isTauri ? { kind: "none" } : mockLyrics(t.id));
      setHistory((h) => [t, ...h.filter((x) => x.id !== t.id)].slice(0, 100));
      if (isTauri && t.path) {
        api
          .play(Number(t.id), t.path)
          .then((ev) =>
            setPb((p) => ({
              ...p,
              track: t,
              playing: ev.playing,
              position: ev.position,
              duration: ev.duration || t.duration,
            })),
          )
          .catch((e) => flashError(String(e)));
        return;
      }
      setPb((p) => ({ ...p, track: t, playing: true, position: 0, duration: t.duration }));
    },
    [flashError],
  );

  const playTrack = useCallback(
    (t: Track, context?: Track[]) => {
      const list = context && context.length ? context : library.tracks.length ? library.tracks : [t];
      const idx = list.findIndex((x) => x.id === t.id);
      setQueue(list);
      setQueueIndex(idx < 0 ? 0 : idx);
      startTrack(t);
    },
    [library.tracks, startTrack],
  );

  const playQueueAt = useCallback(
    (index: number) => {
      const t = queue[index];
      if (t) {
        setQueueIndex(index);
        startTrack(t);
      }
    },
    [queue, startTrack],
  );

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const idxRef = useRef(queueIndex);
  idxRef.current = queueIndex;
  const pbRef = useRef(pb);
  pbRef.current = pb;

  const next = useCallback(() => {
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
  }, [startTrack]);

  const prev = useCallback(() => {
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
  }, [startTrack]);

  // auto-advance when the Rust player finishes a track
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    api.onTrackEnded(() => next()).then((f) => (un = f));
    return () => un?.();
  }, [next]);

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
    setPb((p) => ({ ...p, volume: vol }));
  }, []);
  const toggleShuffle = useCallback(() => setPb((p) => ({ ...p, shuffle: !p.shuffle })), []);
  const cycleRepeat = useCallback(
    () =>
      setPb((p) => ({
        ...p,
        repeat: p.repeat === "off" ? "all" : p.repeat === "all" ? "one" : "off",
      })),
    [],
  );
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
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
      library,
      scanProgress,
      reloadLibrary,
      addFolder,
      pb,
      playerError,
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
      view, immersive, queueOpen, library, scanProgress, reloadLibrary, addFolder, pb, playerError, lyrics,
      queue, queueIndex, history, favorites, playTrack, playQueueAt, togglePlay, next, prev,
      seek, setVolume, toggleShuffle, cycleRepeat, toggleFavorite,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
