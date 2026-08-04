import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Track } from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

interface TrackDto {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  trackNumber: number | null;
  year: number | null;
  cover: string | null;
}

export interface FolderDto {
  id: number;
  path: string;
}

export const api = {
  folders(): Promise<FolderDto[]> {
    return invoke("list_folders");
  },
  async tracks(): Promise<Track[]> {
    const dtos = await invoke<TrackDto[]>("list_tracks");
    return dtos.map(mapTrack);
  },
  search(q: string): Promise<Track[]> {
    return invoke<TrackDto[]>("search", { q }).then((d) => d.map(mapTrack));
  },
  albums(): Promise<AlbumDto[]> {
    return invoke("albums");
  },
  artists(): Promise<ArtistDto[]> {
    return invoke("artists");
  },
  albumTracks(album: string, artist: string): Promise<Track[]> {
    return invoke<TrackDto[]>("album_tracks", { album, artist }).then((d) => d.map(mapTrack));
  },
  artistTracks(artist: string): Promise<Track[]> {
    return invoke<TrackDto[]>("artist_tracks", { artist }).then((d) => d.map(mapTrack));
  },
  toggleFavorite(id: number): Promise<boolean> {
    return invoke("toggle_favorite", { id });
  },
  favoriteIds(): Promise<number[]> {
    return invoke("favorite_ids");
  },
  favorites(): Promise<Track[]> {
    return invoke<TrackDto[]>("favorites").then((d) => d.map(mapTrack));
  },
  createPlaylist(name: string): Promise<number> {
    return invoke("create_playlist", { name });
  },
  deletePlaylist(id: number) {
    return invoke("delete_playlist", { id });
  },
  playlists(): Promise<{ id: number; name: string }[]> {
    return invoke("playlists");
  },
  playlistTracks(id: number): Promise<Track[]> {
    return invoke<TrackDto[]>("playlist_tracks", { id }).then((d) => d.map(mapTrack));
  },
  playlistAdd(pid: number, tid: number) {
    return invoke("playlist_add", { pid, tid });
  },
  playlistRemove(pid: number, tid: number) {
    return invoke("playlist_remove", { pid, tid });
  },
  async restore(): Promise<RestoreDto> {
    const r = await invoke<{
      queue: TrackDto[];
      index: number;
      history: TrackDto[];
      position: number;
      volume: number;
    }>("restore");
    return {
      queue: r.queue.map(mapTrack),
      index: r.index,
      history: r.history.map(mapTrack),
      position: r.position,
      volume: r.volume,
    };
  },

  async addFolder(): Promise<boolean> {
    const sel = await open({ directory: true, multiple: false });
    if (!sel) return false;
    await invoke("add_folder", { path: sel });
    return true;
  },
  removeFolder(id: number) {
    return invoke("remove_folder", { id });
  },
  rescan() {
    return invoke("rescan");
  },
  onLibraryChanged(cb: () => void) {
    return listen("library-changed", () => cb());
  },
  onScanProgress(cb: (p: { done: number; total: number }) => void) {
    return listen<{ done: number; total: number }>("scan-progress", (e) => cb(e.payload));
  },
  playQueue(items: { id: number; path: string }[], index: number): Promise<PlaybackEvent> {
    return invoke("play_queue", { items, index });
  },
  queueNext(): Promise<PlaybackEvent> {
    return invoke("queue_next");
  },
  queuePrev(): Promise<PlaybackEvent> {
    return invoke("queue_prev");
  },
  setShuffle(on: boolean) {
    return invoke("set_shuffle", { on });
  },
  setRepeat(mode: string) {
    return invoke("set_repeat", { mode });
  },
  setEq(settings: EqSettings) {
    return invoke("set_eq", { settings });
  },
  setReplayGain(mode: string) {
    return invoke("set_replay_gain", { mode });
  },
  audioSettings(): Promise<{ eq: EqSettings; replayGain: string }> {
    return invoke("audio_settings");
  },
  lyricsFor(path: string): Promise<import("./types").LyricState> {
    return invoke("lyrics_for", { path });
  },
  onTrackChanged(cb: (e: { index: number; id: number }) => void) {
    return listen<{ index: number; id: number }>("track-changed", (e) => cb(e.payload));
  },
  toggle(): Promise<PlaybackEvent> {
    return invoke("toggle_play");
  },
  seek(pos: number): Promise<PlaybackEvent> {
    return invoke("seek", { pos });
  },
  setVolume(volume: number): Promise<PlaybackEvent> {
    return invoke("set_volume", { volume });
  },
  onPlayback(cb: (e: PlaybackEvent) => void) {
    return listen<PlaybackEvent>("playback", (e) => cb(e.payload));
  },
  onTrackEnded(cb: () => void) {
    return listen("track-ended", () => cb());
  },
};

function mapTrack(d: TrackDto): Track {
  return {
    id: String(d.id),
    path: d.path,
    title: d.title,
    artist: d.artist,
    album: d.album,
    duration: d.duration,
    trackNumber: d.trackNumber ?? undefined,
    year: d.year ?? undefined,
    cover: d.cover ? convertFileSrc(d.cover) : undefined,
  };
}

export interface AlbumDto {
  name: string;
  artist: string;
  year: number | null;
  cover: string | null;
  count: number;
}

export interface ArtistDto {
  name: string;
  albums: number;
  tracks: number;
  cover: string | null;
}

export interface RestoreDto {
  queue: Track[];
  index: number;
  history: Track[];
  position: number;
  volume: number;
}

export interface PlaybackEvent {
  trackId: number | null;
  position: number;
  duration: number;
  playing: boolean;
}

export interface EqSettings {
  enabled: boolean;
  preamp: number;
  gains: number[];
}
