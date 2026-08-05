import { FolderOpen, FolderX, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isTauri, type FolderDto } from "../lib/backend";
import { useStore } from "../lib/store";

const FALLBACK_FONTS = ["Arial", "Segoe UI", "Microsoft YaHei", "Inter", "Noto Sans SC"];
const SELECT_CLASS =
  "h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 text-[12px] text-white focus:border-accent/60 focus:outline-none";
const RANGE_CLASS = "h-4 min-w-0 flex-1";

export default function SettingsView() {
  const s = useStore();
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [fonts, setFonts] = useState<string[]>(isTauri ? [] : FALLBACK_FONTS);

  const refresh = () => {
    if (isTauri) api.folders().then(setFolders).catch(() => {});
  };
  useEffect(refresh, [s.library.status]);
  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    api
      .systemFonts()
      .then((names) => {
        if (active) setFonts(names);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const fontOptions = Array.from(
    new Set([fonts, [s.lyricsDisplay.originalFont, s.lyricsDisplay.translationFont]].flat()),
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-2xl px-7 pt-6 pb-10">
      <h1 className="text-2xl font-semibold text-white">设置</h1>

      <section className="mt-6">
        <h2 className="text-[14px] font-medium text-white/80">音乐文件夹</h2>
        <p className="mt-1 text-[12px] text-white/40">
          监控中的文件夹会在文件变化时自动重新扫描。
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {folders.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-2.5"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-accent-soft" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/80">{f.path}</span>
              <button
                onClick={() => {
                  api.removeFolder(f.id).then(() => {
                    refresh();
                    s.reloadLibrary();
                  });
                }}
                title="移除文件夹"
                className="rounded p-1.5 text-white/40 hover:bg-white/10 hover:text-red-400"
              >
                <FolderX className="h-4 w-4" />
              </button>
            </div>
          ))}
          {folders.length === 0 && (
            <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-white/35">
              尚未添加文件夹
            </div>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void s.addFolder()}
            className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[12.5px] font-medium text-white hover:scale-[1.03]"
          >
            <FolderOpen className="h-3.5 w-3.5" /> 添加文件夹
          </button>
          <button
            onClick={() => {
              if (isTauri) api.rescan().catch(() => {});
            }}
            className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-[12.5px] text-white/75 hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 重新扫描
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-medium text-white/80">音频</h2>
        <p className="mt-1 text-[12.5px] leading-6 text-white/40">
          均衡器与 ReplayGain 在播放栏的“均衡器”面板中调整，设置会自动保存并在下次启动时恢复。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-medium text-white/80">歌词显示</h2>
        <p className="mt-1 text-[12.5px] leading-6 text-white/40">
          字体来自 Windows 已安装的字体，修改会立即应用并自动保存。
        </p>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-3 text-[12.5px] text-white/70">
            <span className="w-24 shrink-0">原文字体</span>
            <select
              aria-label="原文字体"
              value={s.lyricsDisplay.originalFont}
              onChange={(e) => s.updateLyricsDisplay({ originalFont: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">应用默认</option>
              {fontOptions.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-3 text-[12.5px] text-white/70">
            <span className="w-24 shrink-0">翻译字体</span>
            <select
              aria-label="翻译字体"
              value={s.lyricsDisplay.translationFont}
              onChange={(e) => s.updateLyricsDisplay({ translationFont: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">应用默认</option>
              {fontOptions.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-3 text-[12.5px] text-white/70">
            <span className="w-24 shrink-0">原文字号</span>
            <input
              aria-label="原文字号"
              type="range"
              min={16}
              max={56}
              step={1}
              value={s.lyricsDisplay.originalSize}
              onChange={(e) => s.updateLyricsDisplay({ originalSize: e.currentTarget.valueAsNumber })}
              className={RANGE_CLASS}
            />
            <output className="w-12 text-right tabular-nums text-white/45">
              {s.lyricsDisplay.originalSize}px
            </output>
          </label>
          <label className="flex items-center gap-3 text-[12.5px] text-white/70">
            <span className="w-24 shrink-0">翻译字号</span>
            <input
              aria-label="翻译字号"
              type="range"
              min={10}
              max={32}
              step={0.5}
              value={s.lyricsDisplay.translationSize}
              onChange={(e) =>
                s.updateLyricsDisplay({ translationSize: e.currentTarget.valueAsNumber })
              }
              className={RANGE_CLASS}
            />
            <output className="w-12 text-right tabular-nums text-white/45">
              {s.lyricsDisplay.translationSize}px
            </output>
          </label>
          <label className="flex items-center gap-3 text-[12.5px] text-white/70">
            <span className="w-24 shrink-0">歌词行距</span>
            <input
              aria-label="歌词行距"
              type="range"
              min={8}
              max={64}
              step={1}
              value={s.lyricsDisplay.lineGap}
              onChange={(e) => s.updateLyricsDisplay({ lineGap: e.currentTarget.valueAsNumber })}
              className={RANGE_CLASS}
            />
            <output className="w-12 text-right tabular-nums text-white/45">
              {s.lyricsDisplay.lineGap}px
            </output>
          </label>
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-white/70">
            <span>歌词文字模糊</span>
            <input
              aria-label="歌词文字模糊"
              type="checkbox"
              checked={s.lyricsDisplay.blurEnabled}
              onChange={(e) => s.updateLyricsDisplay({ blurEnabled: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
          </label>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-medium text-white/80">关于</h2>
        <p className="mt-1 text-[12.5px] leading-6 text-white/40">
          Lyrift（流律）v0.1.4 — Tauri 2 + Rust + React 本地音乐播放器。
          <br />
          支持 MP3 / FLAC / WAV / OGG / M4A，本地与内嵌歌词，10 段均衡器与 ReplayGain。
        </p>
      </section>
    </div>
  );
}
