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
    return dtos.map((d) => ({
      id: String(d.id),
      path: d.path,
      title: d.title,
      artist: d.artist,
      album: d.album,
      duration: d.duration,
      trackNumber: d.trackNumber ?? undefined,
      year: d.year ?? undefined,
      cover: d.cover ? convertFileSrc(d.cover) : undefined,
    }));
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
