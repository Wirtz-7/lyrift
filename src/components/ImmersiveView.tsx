import {
  ChevronDown,
  Heart,
  MicOff,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fmtTime } from "../lib/format";
import { useStore } from "../lib/store";
import CoverArt from "./CoverArt";

const fill = (pct: number) => ({ "--fill": `${pct}%` }) as CSSProperties;

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function ImmersiveView() {
  const s = useStore();
  const { pb, lyrics } = s;
  const t = pb.track;
  const [shown, setShown] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [autoFocusPaused, setAutoFocusPaused] = useState(false);
  const scrollTimer = useRef<number | undefined>(undefined);
  const focusTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(scrollTimer.current);
      window.clearTimeout(focusTimer.current);
    };
  }, []);

  const onLyricsScroll = () => {
    setScrolling(true);
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => setScrolling(false), 2000);
  };

  const pauseAutoFocus = () => {
    setAutoFocusPaused(true);
    window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setAutoFocusPaused(false), 5000);
  };

  const current =
    lyrics.kind === "synced"
      ? lyrics.lines.reduce((acc, l, i) => (l.time <= pb.position ? i : acc), -1)
      : -1;

  const lyricsRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (autoFocusPaused) return;
    const container = lyricsRef.current;
    const line = lineRefs.current[current];
    if (!container || !line) return;
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    container.scrollTo({
      top: Math.max(
        0,
        container.scrollTop +
          lineRect.top -
          containerRect.top -
          (container.clientHeight - lineRect.height) / 2,
      ),
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [autoFocusPaused, current]);

  const seeking = useRef(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const position = seekPreview ?? pb.position;
  const pct = pb.duration ? (position / pb.duration) * 100 : 0;
  const fav = t ? s.favorites.has(t.id) : false;

  return (
    <div
      className={`fixed inset-0 z-40 overflow-hidden bg-ink transition-opacity duration-300 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* blurred cover backdrop */}
      {t?.cover && (
        <img
          src={t.cover}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full scale-150 object-cover opacity-90 blur-3xl brightness-[.6] saturate-150"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/20 to-black/50" />

      {/* top-left controls (title bar keeps window buttons top-right) */}
      <div className="absolute left-4 top-9 z-20 flex items-center gap-1">
        <button
          onClick={() => s.setImmersive(false)}
          title="退出沉浸模式"
          className="rounded-full bg-white/10 p-2.5 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
        >
          <ChevronDown className="h-4.5 w-4.5" />
        </button>
      </div>

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1800px] gap-14 px-12 pb-10 pt-16">
        {/* left: cover + controls */}
        <div className="flex w-[42%] shrink-0 flex-col justify-center [&>*]:w-full [&>*]:max-w-[440px]">
          <CoverArt
            src={t?.cover}
            alt={t?.title ?? "无曲目"}
            className="aspect-square w-full rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/15"
          />
          <div className="mt-7 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-semibold text-white">
                {t?.title ?? "未在播放"}
              </div>
              <div className="mt-1 truncate text-[13.5px] text-white/55">
                {t?.artist ?? "从资料库选择一首曲目开始"}
              </div>
            </div>
            <button
              onClick={() => t && s.toggleFavorite(t.id)}
              disabled={!t}
              title="收藏"
              className={`rounded-full bg-white/10 p-2.5 backdrop-blur transition-colors hover:bg-white/20 disabled:opacity-30 ${
                fav ? "text-accent-soft" : "text-white/70"
              }`}
            >
              <Heart className={`h-4 w-4 ${fav ? "fill-current" : ""}`} />
            </button>
          </div>

          <div className="mt-6 flex items-center gap-3 text-[11.5px] tabular-nums text-white/50">
            <span className="w-10 text-right">{fmtTime(position)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, pb.duration)}
              step={0.5}
              value={position}
              style={fill(pct)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                seeking.current = true;
                setSeekPreview(e.currentTarget.valueAsNumber);
              }}
              onChange={(e) => {
                const value = e.currentTarget.valueAsNumber;
                if (seeking.current) setSeekPreview(value);
                else s.seek(value);
              }}
              onPointerUp={(e) => {
                seeking.current = false;
                s.seek(e.currentTarget.valueAsNumber);
                setSeekPreview(null);
              }}
              onPointerCancel={() => {
                seeking.current = false;
                setSeekPreview(null);
              }}
              aria-label="播放进度"
              className="h-4 flex-1"
            />
            <span className="w-10">{fmtTime(pb.duration)}</span>
          </div>

          <div className="mt-5 flex items-center justify-center gap-7">
            <button
              onClick={s.toggleShuffle}
              title="随机播放"
              className={pb.shuffle ? "text-accent-soft" : "text-white/50 hover:text-white"}
            >
              <Shuffle className="h-4.5 w-4.5" />
            </button>
            <button onClick={s.prev} title="上一首" className="text-white/85 hover:text-white">
              <SkipBack className="h-6 w-6 fill-current" />
            </button>
            <button
              onClick={s.togglePlay}
              title={pb.playing ? "暂停" : "播放"}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-xl shadow-black/40 transition-transform hover:scale-105 active:scale-95"
            >
              {pb.playing ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              )}
            </button>
            <button onClick={s.next} title="下一首" className="text-white/85 hover:text-white">
              <SkipForward className="h-6 w-6 fill-current" />
            </button>
            <button
              onClick={s.cycleRepeat}
              title="重复模式"
              className={pb.repeat !== "off" ? "text-accent-soft" : "text-white/50 hover:text-white"}
            >
              {pb.repeat === "one" ? (
                <Repeat1 className="h-4.5 w-4.5" />
              ) : (
                <Repeat className="h-4.5 w-4.5" />
              )}
            </button>
          </div>
        </div>

        {/* right: lyrics */}
        <div className="relative min-w-0 flex-1">
          {lyrics.kind === "synced" && (
            <div
              ref={lyricsRef}
              onScroll={onLyricsScroll}
              onWheel={pauseAutoFocus}
              onTouchMove={pauseAutoFocus}
              className={`lyrics-scroll h-full overflow-x-hidden overflow-y-auto py-[30vh] pr-6 ${
                scrolling ? "lyrics-scrolling" : ""
              }`}
              style={{
                maskImage: "linear-gradient(transparent, black 18%, black 82%, transparent)",
                WebkitMaskImage:
                  "linear-gradient(transparent, black 18%, black 82%, transparent)",
              }}
            >
              {lyrics.lines.map((l, i) => {
                const d = i - current;
                const ad = Math.abs(d);
                const opacity = ad === 0 ? 1 : ad === 1 ? 0.68 : ad === 2 ? 0.48 : 0.32;
                const blur = ad === 0 ? 0 : ad === 1 ? 0.35 : ad === 2 ? 0.75 : 1.25;
                return (
                  <button
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    onClick={() => s.seek(l.time)}
                    className="lyric-line mb-8 block w-full max-w-full text-left"
                    style={{ opacity, filter: blur ? `blur(${blur}px)` : undefined }}
                  >
                    <span
                      className={`block break-words text-[26px] font-semibold leading-snug ${
                        ad === 0 ? "text-white" : "text-white/80"
                      }`}
                    >
                      {l.text}
                    </span>
                    {l.translation && (
                      <span className="mt-2 block whitespace-pre-line break-words text-[13.5px] text-white/60">
                        {l.translation}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {lyrics.kind === "plain" && (
            <div className="lyrics-scroll h-full overflow-y-auto py-16 pr-6">
              <div className="whitespace-pre-wrap text-[17px] leading-8 text-white/80">
                {lyrics.text}
              </div>
            </div>
          )}
          {lyrics.kind === "none" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white/45">
              <MicOff className="h-8 w-8" />
              <div className="text-[14px]">暂无歌词</div>
              <div className="text-[12px] text-white/30">
                将同名 .lrc 文件放在音频旁，或内嵌歌词到音频标签
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
