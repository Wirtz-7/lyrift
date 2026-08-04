import {
  ChevronDown,
  Heart,
  MicOff,
  Minimize,
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

const inTauri = "__TAURI_INTERNALS__" in window;
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function ImmersiveView() {
  const s = useStore();
  const { pb, lyrics } = s;
  const t = pb.track;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const current =
    lyrics.kind === "synced"
      ? lyrics.lines.reduce((acc, l, i) => (l.time <= pb.position ? i : acc), -1)
      : -1;

  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (current < 0) return;
    const el = lineRefs.current[current];
    el?.scrollIntoView({
      block: "center",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [current]);

  const toggleFullscreen = () => {
    if (!inTauri) return;
    import("@tauri-apps/api/window").then((m) => {
      const w = m.getCurrentWindow();
      w.isFullscreen().then((f) => w.setFullscreen(!f)).catch(() => {});
    });
  };

  const pct = pb.duration ? (pb.position / pb.duration) * 100 : 0;
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
      <div className="absolute left-4 top-11 z-20 flex items-center gap-1">
        <button
          onClick={() => s.setImmersive(false)}
          title="退出沉浸模式"
          className="rounded-full bg-white/10 p-2.5 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
        >
          <ChevronDown className="h-4.5 w-4.5" />
        </button>
        {inTauri && (
          <button
            onClick={toggleFullscreen}
            title="全屏"
            className="rounded-full bg-white/10 p-2.5 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
          >
            <Minimize className="h-4.5 w-4.5" />
          </button>
        )}
      </div>

      <div className="relative z-10 flex h-full gap-14 px-12 pb-10 pt-16">
        {/* left: cover + controls */}
        <div className="flex w-[40%] max-w-[440px] shrink-0 flex-col justify-center">
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
            <span className="w-10 text-right">{fmtTime(pb.position)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, pb.duration)}
              step={0.5}
              value={pb.position}
              style={fill(pct)}
              onChange={(e) => s.seek(Number(e.target.value))}
              aria-label="播放进度"
              className="h-4 flex-1"
            />
            <span className="w-10">-{fmtTime(Math.max(0, pb.duration - pb.position))}</span>
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
              className="h-full overflow-y-auto py-[30vh] pr-6"
              style={{
                maskImage: "linear-gradient(transparent, black 18%, black 82%, transparent)",
                WebkitMaskImage:
                  "linear-gradient(transparent, black 18%, black 82%, transparent)",
              }}
            >
              {lyrics.lines.map((l, i) => {
                const d = i - current;
                const ad = Math.abs(d);
                const opacity = d < 0 ? Math.max(0.14, 0.5 - ad * 0.12) : ad === 0 ? 1 : ad === 1 ? 0.55 : ad === 2 ? 0.32 : 0.16;
                const blur = ad === 0 ? 0 : ad === 1 ? 1.5 : ad === 2 ? 3 : 5;
                return (
                  <button
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    onClick={() => s.seek(l.time)}
                    className="lyric-line mb-8 block text-left"
                    style={{ opacity, filter: blur ? `blur(${blur}px)` : undefined }}
                  >
                    <span
                      className={`block text-[26px] font-semibold leading-snug ${
                        ad === 0 ? "text-white" : "text-white/80"
                      }`}
                    >
                      {l.text}
                    </span>
                    {l.translation && (
                      <span className="mt-2 block text-[13.5px] text-white/60">
                        {l.translation}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {lyrics.kind === "plain" && (
            <div className="h-full overflow-y-auto py-16 pr-6">
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
