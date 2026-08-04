import AlbumsView from "./components/AlbumsView";
import ArtistsView from "./components/ArtistsView";
import EqPanel from "./components/EqPanel";
import FavoritesView from "./components/FavoritesView";
import ImmersiveView from "./components/ImmersiveView";
import LibraryView from "./components/LibraryView";
import PlayerBar from "./components/PlayerBar";
import PlaylistsView from "./components/PlaylistsView";
import QueuePanel from "./components/QueuePanel";
import SettingsView from "./components/SettingsView";
import Sidebar from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import { AppProvider, useStore } from "./lib/store";

function Shell() {
  const s = useStore();
  return (
    <div className="h-full">
      <div className="flex h-full flex-col pt-10">
        <div className="relative flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-y-auto">
            {s.view === "library" && <LibraryView />}
            {s.view === "albums" && <AlbumsView />}
            {s.view === "artists" && <ArtistsView />}
            {s.view === "favorites" && <FavoritesView />}
            {s.view === "playlists" && <PlaylistsView />}
            {s.view === "settings" && <SettingsView />}
          </main>
          {s.queueOpen && <QueuePanel />}
          {s.eqOpen && <EqPanel />}
        </div>
        {!s.immersive && <PlayerBar />}
      </div>
      {s.immersive && <ImmersiveView />}
      {s.playerError && (
        <div className="fixed left-1/2 top-14 z-[60] -translate-x-1/2 rounded-full border border-red-500/40 bg-red-950/90 px-5 py-2 text-[12.5px] text-red-200 shadow-xl backdrop-blur">
          {s.playerError}
        </div>
      )}
      <TitleBar />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
