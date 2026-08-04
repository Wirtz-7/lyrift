import { FolderOpen, FolderX, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isTauri, type FolderDto } from "../lib/backend";
import { useStore } from "../lib/store";

export default function SettingsView() {
  const s = useStore();
  const [folders, setFolders] = useState<FolderDto[]>([]);

  const refresh = () => {
    if (isTauri) api.folders().then(setFolders).catch(() => {});
  };
  useEffect(refresh, [s.library.status]);

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
        <h2 className="text-[14px] font-medium text-white/80">关于</h2>
        <p className="mt-1 text-[12.5px] leading-6 text-white/40">
          Lyrift（流律）v0.1.0 — Tauri 2 + Rust + React 本地音乐播放器。
          <br />
          支持 MP3 / FLAC / WAV / OGG / M4A，本地与内嵌歌词，10 段均衡器与 ReplayGain。
        </p>
      </section>
    </div>
  );
}
