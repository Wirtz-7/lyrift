import { ListMusic, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import type { Track } from "../lib/types";
import TrackList from "./TrackList";

export default function PlaylistsView() {
  const s = useStore();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    if (selectedId == null) return;
    s.getPlaylistTracks(selectedId).then(setTracks);
  }, [selectedId, s.playlists, s]);

  const selected = s.playlists.find((p) => p.id === selectedId);

  return (
    <div className="flex h-full">
      <div className="flex w-60 shrink-0 flex-col border-r border-line px-3 pt-6">
        <div className="flex items-center justify-between px-2 pb-3">
          <h1 className="text-[15px] font-semibold text-white">播放列表</h1>
        </div>
        <div className="flex gap-1.5 px-2 pb-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新列表名称"
            className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 text-[12.5px] text-white placeholder:text-white/30 focus:border-accent/60 focus:outline-none"
          />
          <button
            onClick={() => {
              if (name.trim()) {
                s.createPlaylist(name.trim());
                setName("");
              }
            }}
            title="创建"
            className="rounded-md bg-accent px-2.5 text-white hover:scale-105"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          {s.playlists.map((p) => (
            <div
              key={p.id}
              className={`group flex items-center rounded-lg px-3 py-2 ${
                selectedId === p.id ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <button
                onClick={() => setSelectedId(p.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <ListMusic className="h-4 w-4 shrink-0 text-white/40" />
                <span className="truncate text-[13px] text-white/85">{p.name}</span>
              </button>
              <button
                onClick={() => s.deletePlaylist(p.id)}
                title="删除列表"
                className="rounded p-1 text-white/30 opacity-0 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {s.playlists.length === 0 && (
            <div className="px-3 py-8 text-center text-[12px] text-white/35">
              创建你的第一个播放列表
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto px-7 pt-6 pb-6">
        {selected ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white">{selected.name}</h1>
              <button
                onClick={() => tracks[0] && s.playTrack(tracks[0], tracks)}
                className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:scale-[1.03]"
              >
                <Play className="h-3 w-3 fill-current" /> 播放
              </button>
            </div>
            {tracks.length === 0 ? (
              <div className="py-16 text-center text-[13px] text-white/35">
                空列表——在资料库曲目上点“加入播放列表”
              </div>
            ) : (
              <TrackList tracks={tracks} />
            )}
          </>
        ) : (
          <div className="py-20 text-center text-[13px] text-white/35">选择一个播放列表</div>
        )}
      </div>
    </div>
  );
}
