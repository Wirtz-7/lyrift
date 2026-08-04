import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isTauri } from "../lib/backend";
import { MOCK_TRACKS } from "../lib/mock";
import { useStore } from "../lib/store";
import type { Track } from "../lib/types";
import TrackList from "./TrackList";

export default function FavoritesView() {
  const s = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    if (isTauri) api.favorites().then(setTracks).catch(() => {});
    else setTracks(MOCK_TRACKS.filter((t) => s.favorites.has(t.id)));
  }, [s.favorites, s.library.status]);

  return (
    <div className="px-7 pt-6 pb-6">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
        <Heart className="h-6 w-6 fill-accent-soft text-accent-soft" /> 收藏
      </h1>
      <p className="mt-1 text-[12.5px] text-white/40">{tracks.length} 首</p>
      <div className="mt-4">
        {tracks.length === 0 ? (
          <div className="py-20 text-center text-[13px] text-white/35">
            还没有收藏，点击曲目右侧的心形即可收藏
          </div>
        ) : (
          <TrackList tracks={tracks} />
        )}
      </div>
    </div>
  );
}
