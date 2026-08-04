import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { useStore } from "../lib/store";

const FREQ_LABELS = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

const PRESETS: { name: string; gains: number[] }[] = [
  { name: "平坦", gains: Array(10).fill(0) },
  { name: "低音", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: "人声", gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: "明亮", gains: [0, 0, 0, 0, 1, 2, 4, 5, 6, 6] },
];

const fill = (pct: number) => ({ "--fill": `${pct}%` }) as CSSProperties;
const pctOf = (db: number) => ((db + 12) / 24) * 100;

export default function EqPanel() {
  const s = useStore();
  const { eq } = s;

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-40 flex w-96 flex-col border-l border-line bg-panel/95 backdrop-blur-xl">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-medium text-white">均衡器</span>
          <button
            onClick={() => s.updateEq({ enabled: !eq.enabled })}
            title={eq.enabled ? "关闭" : "开启"}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              eq.enabled ? "bg-accent" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                eq.enabled ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
        <button
          onClick={() => s.setEqOpen(false)}
          title="关闭"
          className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-1 px-5 pb-3">
        {PRESETS.map((p) => {
          const active = eq.gains.every((g, i) => g === p.gains[i]) && eq.preamp === 0;
          return (
            <button
              key={p.name}
              onClick={() => s.updateEq({ gains: p.gains, preamp: 0 })}
              className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                active ? "bg-accent text-white" : "bg-white/8 text-white/60 hover:bg-white/15"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <SliderRow
          label="前级"
          value={eq.preamp}
          onChange={(v) => s.updateEq({ preamp: v })}
        />
        <div className="my-2 border-t border-line" />
        {eq.gains.map((g, i) => (
          <SliderRow
            key={i}
            label={FREQ_LABELS[i]}
            value={g}
            onChange={(v) => {
              const gains = [...eq.gains];
              gains[i] = v;
              s.updateEq({ gains });
            }}
          />
        ))}

        <div className="mt-5">
          <div className="mb-2 text-[12px] text-white/45">ReplayGain</div>
          <div className="flex gap-1 rounded-lg bg-white/5 p-1">
            {[
              ["off", "关闭"],
              ["track", "单曲"],
              ["album", "专辑"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => s.setRg(mode)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[12px] transition-colors ${
                  s.rg === mode ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-white/30">
            仅读取文件内已有标签；增益按峰值限制防止削波。
          </p>
        </div>
      </div>
    </aside>
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-8 text-right text-[11px] tabular-nums text-white/45">{label}</span>
      <input
        type="range"
        min={-12}
        max={12}
        step={0.5}
        value={value}
        style={fill(pctOf(value))}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} 增益`}
        className="h-4 flex-1"
      />
      <span className="w-10 text-[11px] tabular-nums text-white/45">
        {value > 0 ? `+${value}` : value} dB
      </span>
    </div>
  );
}
