import {
  Expand,
  Heart,
  SlidersHorizontal,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { fmtTime } from "../lib/format";
import { useStore } from "../lib/store";
import CoverArt from "./CoverArt";

const fill = (pct: number) => ({ "--fill": `${pct}%` }) as CSSProperties;

export default function PlayerBar() {
  const s = useStore();
  const { pb } = s;
  const t = pb.track;
  const seeking = useRef(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const position = seekPreview ?? pb.position;
  const pct = pb.duration ? (position / pb.duration) * 100 : 0;
  const fav = t ? s.favorites.has(t.id) : false;

  return (
    <footer
      onClick={(e) => {
        if (!(e.target as Element).closest("button, input")) s.setImmersive(true);
      }}
      className="grid h-[92px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-6 border-t border-line bg-panel px-4"
    >
      {/* left: track info */}
      <div className="flex min-w-0 items-center gap-3">
        <CoverArt
          src={t?.cover}
          alt={t?.title ?? "无曲目"}
          className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-white/10"
        />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-white">
            {t?.title ?? "未在播放"}
          </div>
          <div className="truncate text-[12px] text-white/45">{t?.artist ?? "—"}</div>
        </div>
        <button
          onClick={() => t && s.toggleFavorite(t.id)}
          disabled={!t}
          title="收藏"
          className={`ml-1 shrink-0 rounded-full p-2 transition-colors disabled:opacity-30 ${
            fav ? "text-accent-soft" : "text-white/50 hover:text-white"
          }`}
        >
          <Heart className={`h-4 w-4 ${fav ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* center: controls + progress */}
      <div className="flex w-[420px] max-w-[46vw] flex-col items-center gap-1.5">
        <div className="flex items-center gap-5">
          <button
            onClick={s.toggleShuffle}
            title="随机播放"
            className={`transition-colors ${pb.shuffle ? "text-accent-soft" : "text-white/50 hover:text-white"}`}
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button onClick={s.prev} title="上一首" className="text-white/80 hover:text-white">
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          <button
            onClick={s.togglePlay}
            title={pb.playing ? "暂停" : "播放"}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
          >
            {pb.playing ? (
              <Pause className="h-4.5 w-4.5 fill-current" />
            ) : (
              <Play className="ml-0.5 h-4.5 w-4.5 fill-current" />
            )}
          </button>
          <button onClick={s.next} title="下一首" className="text-white/80 hover:text-white">
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
          <button
            onClick={s.cycleRepeat}
            title="重复模式"
            className={`transition-colors ${pb.repeat !== "off" ? "text-accent-soft" : "text-white/50 hover:text-white"}`}
          >
            {pb.repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex w-full items-center gap-2 text-[11px] tabular-nums text-white/45">
          <span className="w-9 text-right">{fmtTime(position)}</span>
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
          <span className="w-9">{fmtTime(pb.duration)}</span>
        </div>
      </div>

      {/* right: queue / immersive / volume */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => s.setEqOpen(!s.eqOpen)}
          title="均衡器"
          className={`rounded-md p-2 transition-colors ${
            s.eqOpen ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
          }`}
        >
          <SlidersHorizontal className="h-4.5 w-4.5" />
        </button>
        <button
          onClick={() => s.setQueueOpen(!s.queueOpen)}
          title="播放队列"
          className={`rounded-md p-2 transition-colors ${
            s.queueOpen ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
          }`}
        >
          <ListMusic className="h-4.5 w-4.5" />
        </button>
        <button
          onClick={() => s.setImmersive(true)}
          title="沉浸模式"
          className="rounded-md p-2 text-white/50 transition-colors hover:text-white"
        >
          <Expand className="h-4.5 w-4.5" />
        </button>
        <button
          onClick={() => s.setVolume(pb.volume === 0 ? pb.lastVolume : 0)}
          title={pb.volume === 0 ? "取消静音" : "静音"}
          className="rounded-md p-2 text-white/50 hover:text-white"
        >
          {pb.volume === 0 ? (
            <VolumeX className="h-4.5 w-4.5" />
          ) : (
            <Volume2 className="h-4.5 w-4.5" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={pb.volume}
          style={fill(pb.volume * 100)}
          onChange={(e) => s.setVolume(Number(e.target.value))}
          aria-label="音量"
          className="h-4 w-24"
        />
      </div>
    </footer>
  );
}
