import { Heart, ListPlus, Play } from "lucide-react";
import { useState } from "react";
import { fmtTime } from "../lib/format";
import { useStore } from "../lib/store";
import type { Track } from "../lib/types";
import CoverArt from "./CoverArt";

const GRID =
  "grid grid-cols-[2.5rem_minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_4.5rem_4.5rem] items-center gap-3";

export default function TrackList({ tracks }: { tracks: Track[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`${GRID} sticky top-0 z-10 bg-ink/95 px-3 py-2 text-[11.5px] uppercase tracking-wider text-white/35 backdrop-blur`}>
        <span>#</span>
        <span>标题</span>
        <span>专辑</span>
        <span>歌手</span>
        <span className="text-right">时长</span>
        <span />
      </div>
      {tracks.map((t, i) => (
        <Row key={`${t.id}-${i}`} track={t} index={i} context={tracks} />
      ))}
    </div>
  );
}

function Row({ track, index, context }: { track: Track; index: number; context: Track[] }) {
  const s = useStore();
  const current = s.pb.track?.id === track.id;
  const fav = s.favorites.has(track.id);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onDoubleClick={() => s.playTrack(track, context)}
      className={`${GRID} group relative cursor-default rounded-lg px-3 py-2 transition-colors hover:bg-white/5 ${
        current ? "bg-white/5" : ""
      }`}
    >
      <button
        onClick={() => s.playTrack(track, context)}
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
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => s.toggleFavorite(track.id)}
          title="收藏"
          className={`rounded p-1 transition-opacity ${
            fav ? "text-accent-soft opacity-100" : "text-white/40 opacity-0 hover:text-white group-hover:opacity-100"
          }`}
        >
          <Heart className={`h-3.5 w-3.5 ${fav ? "fill-current" : ""}`} />
        </button>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="加入播放列表"
          className="rounded p-1 text-white/40 opacity-0 hover:text-white group-hover:opacity-100"
        >
          <ListPlus className="h-3.5 w-3.5" />
        </button>
      </div>
      {menuOpen && (
        <>
          <button
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setMenuOpen(false)}
            aria-label="关闭菜单"
            tabIndex={-1}
          />
          <div className="absolute right-3 top-10 z-30 w-44 rounded-lg border border-line bg-panel p-1 shadow-xl shadow-black/50">
            <div className="px-2 py-1 text-[11px] text-white/40">加入播放列表</div>
            {s.playlists.length === 0 && (
              <div className="px-2 py-1.5 text-[12px] text-white/35">暂无播放列表</div>
            )}
            {s.playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  s.addToPlaylist(p.id, track);
                  setMenuOpen(false);
                }}
                className="block w-full truncate rounded px-2 py-1.5 text-left text-[12.5px] text-white/75 hover:bg-white/10"
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
