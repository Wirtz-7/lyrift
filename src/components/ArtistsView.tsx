import { ChevronLeft, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isTauri, type ArtistDto } from "../lib/backend";
import { MOCK_TRACKS } from "../lib/mock";
import { useStore } from "../lib/store";
import type { Track } from "../lib/types";
import CoverArt from "./CoverArt";
import TrackList from "./TrackList";

function mockArtists(): ArtistDto[] {
  const m = new Map<string, ArtistDto>();
  for (const t of MOCK_TRACKS) {
    const e = m.get(t.artist);
    if (e) {
      e.tracks++;
      if (!e.albums.toString().includes(t.album)) e.albums++;
    } else m.set(t.artist, { name: t.artist, albums: 1, tracks: 1, cover: t.cover ?? null });
  }
  return [...m.values()];
}

export default function ArtistsView() {
  const s = useStore();
  const [artists, setArtists] = useState<ArtistDto[]>([]);
  const [selected, setSelected] = useState<ArtistDto | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    if (isTauri) api.artists().then(setArtists).catch(() => {});
    else setArtists(mockArtists());
  }, [s.library.status]);

  const open = async (a: ArtistDto) => {
    setSelected(a);
    if (isTauri) setTracks(await api.artistTracks(a.name).catch(() => []));
    else setTracks(MOCK_TRACKS.filter((t) => t.artist === a.name));
  };

  if (selected)
    return (
      <div className="px-7 pt-6 pb-6">
        <button
          onClick={() => setSelected(null)}
          className="mb-4 flex items-center gap-1 text-[12.5px] text-white/50 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> 返回歌手
        </button>
        <div className="mb-5 flex items-center gap-5">
          <CoverArt src={selected.cover ?? undefined} alt={selected.name} className="h-28 w-28 rounded-full object-cover shadow-xl shadow-black/40" />
          <div>
            <div className="text-xl font-semibold text-white">{selected.name}</div>
            <div className="mt-1 text-[13px] text-white/50">
              {selected.albums} 张专辑 · {selected.tracks} 首
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
      <h1 className="text-2xl font-semibold text-white">歌手</h1>
      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
        {artists.map((a) => (
          <button key={a.name} onClick={() => open(a)} className="group text-left">
            <CoverArt
              src={a.cover ?? undefined}
              alt={a.name}
              className="aspect-square w-full rounded-full object-cover shadow-lg shadow-black/30 ring-1 ring-white/10 transition-transform group-hover:scale-[1.03]"
            />
            <div className="mt-2.5 truncate text-center text-[13.5px] font-medium text-white/90">
              {a.name}
            </div>
            <div className="truncate text-center text-[12px] text-white/45">
              {a.tracks} 首
            </div>
          </button>
        ))}
        {artists.length === 0 && (
          <div className="col-span-full py-16 text-center text-[13px] text-white/35">暂无歌手</div>
        )}
      </div>
    </div>
  );
}
