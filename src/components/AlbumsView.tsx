import { ChevronLeft, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isTauri, type AlbumDto } from "../lib/backend";
import { MOCK_TRACKS } from "../lib/mock";
import { useStore } from "../lib/store";
import type { Track } from "../lib/types";
import CoverArt from "./CoverArt";
import TrackList from "./TrackList";

function mockAlbums(): AlbumDto[] {
  const m = new Map<string, AlbumDto>();
  for (const t of MOCK_TRACKS) {
    const k = `${t.album}::${t.artist}`;
    const e = m.get(k);
    if (e) e.count++;
    else
      m.set(k, {
        name: t.album,
        artist: t.artist,
        year: t.year ?? null,
        cover: t.cover ?? null,
        count: 1,
      });
  }
  return [...m.values()];
}

export default function AlbumsView() {
  const s = useStore();
  const [albums, setAlbums] = useState<AlbumDto[]>([]);
  const [selected, setSelected] = useState<AlbumDto | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    if (isTauri) api.albums().then(setAlbums).catch(() => {});
    else setAlbums(mockAlbums());
  }, [s.library.status]);

  const open = async (a: AlbumDto) => {
    setSelected(a);
    if (isTauri) setTracks(await api.albumTracks(a.name, a.artist).catch(() => []));
    else setTracks(MOCK_TRACKS.filter((t) => t.album === a.name && t.artist === a.artist));
  };

  if (selected)
    return (
      <div className="px-7 pt-6 pb-6">
        <button
          onClick={() => setSelected(null)}
          className="mb-4 flex items-center gap-1 text-[12.5px] text-white/50 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> 返回专辑
        </button>
        <div className="mb-5 flex items-center gap-5">
          <CoverArt
            src={selected.cover ?? undefined}
            alt={selected.name}
            className="h-32 w-32 rounded-xl object-cover shadow-xl shadow-black/40 ring-1 ring-white/10"
          />
          <div>
            <div className="text-xl font-semibold text-white">{selected.name}</div>
            <div className="mt-1 text-[13px] text-white/50">
              {selected.artist}
              {selected.year ? ` · ${selected.year}` : ""} · {selected.count} 首
            </div>
            <button
              onClick={() => tracks[0] && s.playTrack(tracks[0], tracks)}
              className="mt-3 flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:scale-[1.03]"
            >
              <Play className="h-3.5 w-3.5 fill-current" /> 播放
            </button>
          </div>
        </div>
        <TrackList tracks={tracks} />
      </div>
    );

  return (
    <div className="px-7 pt-6 pb-6">
      <h1 className="text-2xl font-semibold text-white">专辑</h1>
      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
        {albums.map((a) => (
          <button
            key={`${a.name}::${a.artist}`}
            onClick={() => open(a)}
            className="group rounded-xl p-3 text-left transition-colors hover:bg-white/5"
          >
            <CoverArt
              src={a.cover ?? undefined}
              alt={a.name}
              className="aspect-square w-full rounded-lg object-cover shadow-lg shadow-black/30 ring-1 ring-white/10 transition-transform group-hover:scale-[1.02]"
            />
            <div className="mt-2.5 truncate text-[13.5px] font-medium text-white/90">{a.name}</div>
            <div className="truncate text-[12px] text-white/45">{a.artist}</div>
          </button>
        ))}
        {albums.length === 0 && (
          <div className="col-span-full py-16 text-center text-[13px] text-white/35">暂无专辑</div>
        )}
      </div>
    </div>
  );
}
