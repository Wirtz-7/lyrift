import { AlertTriangle, Disc3, FolderOpen, Play, RefreshCw, Search, Heart } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtTime } from "../lib/format";
import { useStore } from "../lib/store";
import type { Track } from "../lib/types";
import CoverArt from "./CoverArt";

const GRID =
  "grid grid-cols-[2.5rem_minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_4.5rem_2.5rem] items-center gap-3";

export default function LibraryView() {
  const s = useStore();
  const [query, setQuery] = useState("");

  const tracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return s.library.tracks;
    return s.library.tracks.filter((t) =>
      [t.title, t.artist, t.album].some((v) => v.toLowerCase().includes(q)),
    );
  }, [s.library.tracks, query]);

  return (
    <div className="flex h-full flex-col px-7 pt-6">
      <div className="flex items-end justify-between gap-4 pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white">资料库</h1>
          <p className="mt-1 text-[12.5px] text-white/40">
            {s.library.status === "ready"
              ? `${s.library.tracks.length} 首曲目`
              : "本地音乐"}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、歌手、专辑"
            className="h-9 w-64 rounded-full border border-white/10 bg-white/5 pl-9 pr-4 text-[13px] text-white placeholder:text-white/30 focus:border-accent/60 focus:outline-none"
          />
        </div>
      </div>

      {s.library.status === "loading" && (
        <>
          {s.scanProgress && s.scanProgress.total > 0 && (
            <div className="pb-3 text-[12.5px] text-white/45">
              正在扫描 {s.scanProgress.done}/{s.scanProgress.total}
            </div>
          )}
          <LoadingRows />
        </>
      )}
      {s.library.status === "error" && (
        <ErrorState message={s.library.error ?? "未知错误"} onRetry={s.reloadLibrary} />
      )}
      {s.library.status === "empty" && <EmptyState onAdd={() => void s.addFolder()} />}
      {s.library.status === "ready" &&
        (tracks.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-white/35">没有匹配的曲目</div>
        ) : (
          <div className="flex-1 overflow-y-auto pb-6">
            <div className={`${GRID} sticky top-0 z-10 bg-ink/95 px-3 py-2 text-[11.5px] uppercase tracking-wider text-white/35 backdrop-blur`}>
              <span>#</span>
              <span>标题</span>
              <span>专辑</span>
              <span>歌手</span>
              <span className="text-right">时长</span>
              <span />
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              {tracks.map((t, i) => (
                <Row key={t.id} track={t} index={i} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function Row({ track, index }: { track: Track; index: number }) {
  const s = useStore();
  const current = s.pb.track?.id === track.id;
  const fav = s.favorites.has(track.id);
  return (
    <div
      onDoubleClick={() => s.playTrack(track, s.library.tracks)}
      className={`${GRID} group cursor-default rounded-lg px-3 py-2 transition-colors hover:bg-white/5 ${
        current ? "bg-white/5" : ""
      }`}
    >
      <button
        onClick={() => s.playTrack(track, s.library.tracks)}
        title="播放"
        className="relative flex h-6 w-6 items-center justify-center text-[12.5px] tabular-nums text-white/40"
      >
        <span className={`group-hover:opacity-0 ${current ? "text-accent-soft" : ""}`}>
          {index + 1}
        </span>
        <Play className="absolute h-3.5 w-3.5 fill-current text-white opacity-0 group-hover:opacity-100" />
      </button>
      <div className="flex min-w-0 items-center gap-3">
        <CoverArt src={track.cover} alt={track.title} className="h-9 w-9 rounded object-cover" />
        <span className={`truncate text-[13.5px] ${current ? "font-medium text-accent-soft" : "text-white/90"}`}>
          {track.title}
        </span>
      </div>
      <span className="truncate text-[12.5px] text-white/50">{track.album}</span>
      <span className="truncate text-[12.5px] text-white/50">{track.artist}</span>
      <span className="text-right text-[12.5px] tabular-nums text-white/40">
        {fmtTime(track.duration)}
      </span>
      <button
        onClick={() => s.toggleFavorite(track.id)}
        title="收藏"
        className={`justify-self-end rounded p-1 transition-opacity ${
          fav ? "text-accent-soft opacity-100" : "text-white/40 opacity-0 hover:text-white group-hover:opacity-100"
        }`}
      >
        <Heart className={`h-3.5 w-3.5 ${fav ? "fill-current" : ""}`} />
      </button>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex animate-pulse flex-col gap-2 pb-6" aria-label="加载中">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="h-9 w-9 rounded bg-white/8" />
          <div className="h-3.5 flex-1 rounded bg-white/8" style={{ maxWidth: `${55 - (i % 4) * 9}%` }} />
          <div className="h-3.5 w-24 rounded bg-white/8" />
          <div className="h-3.5 w-10 rounded bg-white/8" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/30 to-indigo-900/30 ring-1 ring-white/10">
        <Disc3 className="h-9 w-9 text-white/50" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-white/85">资料库还是空的</div>
        <div className="mt-1.5 text-[12.5px] text-white/40">
          添加一个音乐文件夹，Lyrift 会扫描其中的音频与歌词
        </div>
      </div>
      <button
        onClick={onAdd}
        className="mt-1 flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-medium text-white shadow-lg shadow-violet-900/40 transition-transform hover:scale-[1.03] active:scale-95"
      >
        <FolderOpen className="h-4 w-4" /> 添加音乐文件夹
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/30">
        <AlertTriangle className="h-7 w-7 text-red-400" />
      </div>
      <div>
        <div className="text-[14.5px] font-medium text-white/85">资料库加载失败</div>
        <div className="mt-1.5 text-[12.5px] text-white/40">{message}</div>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-2 text-[13px] text-white/80 transition-colors hover:bg-white/10"
      >
        <RefreshCw className="h-3.5 w-3.5" /> 重试
      </button>
    </div>
  );
}
