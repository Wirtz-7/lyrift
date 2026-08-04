import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

const inTauri = "__TAURI_INTERNALS__" in window;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    let un: (() => void) | undefined;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      win.isMaximized().then(setMaximized).catch(() => {});
      win.onResized(() => win.isMaximized().then(setMaximized).catch(() => {})).then((f) => {
        un = f;
      });
    });
    return () => un?.();
  }, []);

  if (!inTauri) return null;

  const win = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());

  return (
    <header
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 z-50 flex h-10 items-center justify-end"
    >
      <div className="flex h-full items-stretch" onDoubleClick={() => win().then((w) => w.toggleMaximize())}>
        <button
          title="最小化"
          onClick={() => win().then((w) => w.minimize())}
          className="flex w-11 items-center justify-center text-white/60 hover:bg-white/10 hover:text-white"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          title={maximized ? "还原" : "最大化"}
          onClick={() => win().then((w) => w.toggleMaximize())}
          className="flex w-11 items-center justify-center text-white/60 hover:bg-white/10 hover:text-white"
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          title="关闭"
          onClick={() => win().then((w) => w.close())}
          className="flex w-11 items-center justify-center text-white/60 hover:bg-red-500 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
