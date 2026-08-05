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

export interface LyricsDisplaySettings {
  originalFont: string;
  translationFont: string;
  originalSize: number;
  translationSize: number;
  lineGap: number;
  blurEnabled: boolean;
}

export const DEFAULT_LYRICS_DISPLAY_SETTINGS: LyricsDisplaySettings = {
  originalFont: "",
  translationFont: "",
  originalSize: 26,
  translationSize: 13.5,
  lineGap: 32,
  blurEnabled: true,
};

export function normalizeLyricsDisplaySettings(value: unknown): LyricsDisplaySettings {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const number = (key: string, fallback: number, min: number, max: number) => {
    const n = typeof source[key] === "number" ? source[key] : Number.NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    originalFont: typeof source.originalFont === "string" ? source.originalFont : "",
    translationFont: typeof source.translationFont === "string" ? source.translationFont : "",
    originalSize: number("originalSize", DEFAULT_LYRICS_DISPLAY_SETTINGS.originalSize, 16, 56),
    translationSize: number(
      "translationSize",
      DEFAULT_LYRICS_DISPLAY_SETTINGS.translationSize,
      10,
      32,
    ),
    lineGap: number("lineGap", DEFAULT_LYRICS_DISPLAY_SETTINGS.lineGap, 8, 64),
    blurEnabled:
      typeof source.blurEnabled === "boolean"
        ? source.blurEnabled
        : DEFAULT_LYRICS_DISPLAY_SETTINGS.blurEnabled,
  };
}

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackSnapshot {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  lastVolume: number;
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
