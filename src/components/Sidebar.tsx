import {
  Disc3,
  LibraryBig,
  ListMusic,
  Heart,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "../lib/store";
import type { ViewId } from "../lib/types";

const NAV: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "library", label: "资料库", icon: LibraryBig },
  { id: "albums", label: "专辑", icon: Disc3 },
  { id: "artists", label: "歌手", icon: Users },
  { id: "favorites", label: "收藏", icon: Heart },
  { id: "playlists", label: "播放列表", icon: ListMusic },
  { id: "settings", label: "设置", icon: Settings },
];

export default function Sidebar() {
  const { view, setView } = useStore();
  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-line bg-panel max-[1100px]:w-16">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-7 max-[1100px]:justify-center max-[1100px]:px-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-800 shadow-lg shadow-violet-900/40">
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 text-white" fill="currentColor">
            <rect x="4" y="9" width="2.6" height="6" rx="1.3" />
            <rect x="8.4" y="6" width="2.6" height="12" rx="1.3" />
            <rect x="12.8" y="3.5" width="2.6" height="17" rx="1.3" />
            <rect x="17.2" y="8" width="2.6" height="8" rx="1.3" />
          </svg>
        </div>
        <div className="max-[1100px]:hidden">
          <div className="text-[15px] font-semibold leading-tight text-white">Lyrift</div>
          <div className="text-[11px] leading-tight text-white/40">流律</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 max-[1100px]:px-2">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            title={label}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors max-[1100px]:justify-center max-[1100px]:px-0 ${
              view === id
                ? "bg-white/10 font-medium text-white"
                : "text-white/55 hover:bg-white/5 hover:text-white/90"
            }`}
          >
            <Icon className={`h-4.5 w-4.5 shrink-0 ${view === id ? "text-accent-soft" : ""}`} />
            <span className="max-[1100px]:hidden">{label}</span>
          </button>
        ))}
      </div>
      <div className="px-5 pb-4 text-[11px] text-white/30 max-[1100px]:hidden">v0.1.0</div>
    </nav>
  );
}
