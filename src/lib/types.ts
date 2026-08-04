export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  cover?: string;
  path?: string;
  trackNumber?: number;
  year?: number;
}

export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

export type LyricState =
  | { kind: "synced"; lines: LyricLine[] }
  | { kind: "plain"; text: string }
  | { kind: "none" };

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackSnapshot {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export type LibraryStatus = "empty" | "loading" | "ready" | "error";

export interface LibraryState {
  status: LibraryStatus;
  tracks: Track[];
  error?: string;
}

export type ViewId =
  | "library"
  | "albums"
  | "artists"
  | "favorites"
  | "playlists"
  | "settings";
