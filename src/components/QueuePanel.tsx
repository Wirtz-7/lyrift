import { History, ListMusic, X } from "lucide-react";
import { useState } from "react";
import { fmtTime } from "../lib/format";
import { useStore } from "../lib/store";
import type { Track } from "../lib/types";
import CoverArt from "./CoverArt";

export default function QueuePanel() {
  const s = useStore();
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const items = tab === "queue" ? s.queue : s.history;

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-40 flex w-80 flex-col border-l border-line bg-panel/95 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex gap-1 rounded-lg bg-white/5 p-1">
          <button
            onClick={() => setTab("queue")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
              tab === "queue" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            <ListMusic className="h-3.5 w-3.5" /> 队列
          </button>
          <button
            onClick={() => setTab("history")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
              tab === "history" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            <History className="h-3.5 w-3.5" /> 历史
          </button>
        </div>
        <button
          onClick={() => s.setQueueOpen(false)}
          title="关闭"
          className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 && (
          <div className="px-4 py-10 text-center text-[12.5px] text-white/35">
            {tab === "queue" ? "队列为空" : "暂无播放历史"}
          </div>
        )}
        {items.map((t, i) => {
          const current =
            tab === "queue" ? i === s.queueIndex : t.id === s.pb.track?.id;
          return (
            <QueueRow key={`${t.id}-${i}`} track={t} current={current} onClick={() => tab === "queue" && s.playQueueAt(i)} />
          );
        })}
      </div>
    </aside>
  );
}

function QueueRow({
  track,
  current,
  onClick,
}: {
  track: Track;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5 ${
        current ? "bg-white/5" : ""
      }`}
    >
      <CoverArt src={track.cover} alt={track.title} className="h-10 w-10 rounded object-cover" />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[13px] ${current ? "font-medium text-accent-soft" : "text-white/85"}`}
        >
          {track.title}
        </div>
        <div className="truncate text-[11.5px] text-white/40">{track.artist}</div>
      </div>
      <span className="text-[11px] tabular-nums text-white/35">{fmtTime(track.duration)}</span>
    </button>
  );
}
