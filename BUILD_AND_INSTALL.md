# Lyrift 编译与 Windows 安装流程

本文件供后续会话直接执行。项目在 WSL 中开发和检查，Windows 安装包由 GitHub Actions 编译；不要在本机 Windows 安装 Rust/MSVC，也不要用 WSLg 的 Linux Tauri 窗口判断最终 Windows 效果。

## 固定位置

- WSL 仓库：`/home/keqing/vibe/rust music/lyrift`
- GitHub：`https://github.com/Wirtz-7/lyrift`
- Workflow：`.github/workflows/windows.yml`，名称为 `Windows`
- Windows 安装目录：`D:\Program\Music\lyrift`
- GitHub CLI：`~/.local/bin/gh`
- 构建产物保存目录：`/home/keqing/vibe/rust music/artifacts/windows-<RUN_ID>`（仓库外）

## 发布原则

1. 先完成全部本地检查，再提交和推送。
2. push 检查与手动打包必须使用同一个 commit，并且全部成功后才能安装。
3. 测试版本使用手动 `workflow_dispatch`，不要创建标签。`v*` 标签会创建公开 GitHub Release，仅在明确要求正式发布时使用。
4. 覆盖安装前确认 `lyrift.exe` 没有运行；如果正在运行，让用户自行关闭，不要强制结束进程。
5. 安装后不要由代理自动启动应用。音频设备、播放和 WebView2 行为由用户在真实 Windows 上验收。
6. 不要删除或重置用户的资料库数据。NSIS 覆盖安装只替换程序文件，应用数据位于 Tauri 应用数据目录。

## 1. 本地检查

进入仓库并先确认工作区状态：

```bash
cd "/home/keqing/vibe/rust music/lyrift"
git status --short
git diff --check
```

确认没有误改或覆盖用户已有变更，然后运行完整检查：

```bash
npm ci
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

完整 Rust 测试会打开 WSLg 默认音频设备。GitHub Actions 没有音频硬件，只跳过 `plays_and_seeks_through_default_device`，其余测试仍必须通过。

如果修改了沉浸歌词、滚动、模糊、进度条或响应式布局，还要运行浏览器回归。一个终端启动：

```bash
npm run dev
```

另一个终端执行：

```bash
node scripts/shot-imm.mjs
```

完成后停止 Vite。WSLg 的 Linux Tauri 窗口存在 WebKitGTK/Mesa 黑屏问题，UI 开发使用浏览器模式；Windows 专属渲染问题必须在安装后的 WebView2 中验证。

## 2. 同步版本号

每次生成新的覆盖安装包都要递增版本，否则 Windows 可能把新包当成已安装版本。版本号固定存在以下七处，必须全部一致：

1. `package.json`
2. `package-lock.json`（根版本及根 package 版本，不要误改 `lockfileVersion`）
3. `src-tauri/Cargo.toml`
4. `src-tauri/Cargo.lock` 中 `name = "lyrift"` 对应的版本
5. `src-tauri/tauri.conf.json`
6. `src/components/Sidebar.tsx`
7. `src/components/SettingsView.tsx`

版本修改后重新运行：

```bash
npm ci
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

检查 `package-lock.json` 顶部仍为合法 JSON，且 `lockfileVersion` 仍是 `3`：

```bash
node -e 'const p=require("./package.json"),l=require("./package-lock.json"),t=require("./src-tauri/tauri.conf.json"); console.log({package:p.version,lock:l.version,lockRoot:l.packages[""].version,tauri:t.version,lockfileVersion:l.lockfileVersion})'
```

## 3. 提交并推送

先审查范围，只暂存本次有意修改的文件，不要顺手提交无关变更：

```bash
git status --short
git diff --stat
git diff --check
git add path/to/changed-file  # 替换为本次有意修改的实际路径，可列出多个
git commit -m "describe the change"
git push origin main
```

确认本地、远端和即将打包的 commit 一致：

```bash
git rev-parse HEAD
git rev-parse origin/main
```

## 4. 运行 Windows CI 和 NSIS 打包

push 会自动触发只读检查。另行手动触发同一 commit 的 NSIS 打包：

```bash
cd "/home/keqing/vibe/rust music/lyrift"
GH="$HOME/.local/bin/gh"
"$GH" workflow run Windows --ref main
"$GH" run list --workflow Windows --limit 5 --json databaseId,event,status,conclusion,headSha,createdAt,url
```

找到同一 `headSha` 的 push run 与 `workflow_dispatch` run，分别等待完成：

```bash
PUSH_RUN_ID=12345678900    # 替换为实际 push run ID
MANUAL_RUN_ID=12345678901  # 替换为实际 workflow_dispatch run ID
"$GH" run watch "$PUSH_RUN_ID" --exit-status
"$GH" run watch "$MANUAL_RUN_ID" --exit-status
```

手动运行必须同时满足：

- `check` job 成功
- `package` job 成功
- `headSha` 等于 `git rev-parse HEAD`

可再次核对：

```bash
"$GH" run view "$MANUAL_RUN_ID" --json status,conclusion,headSha,url
```

任何检查失败都不要下载或安装，先修复并从新的 commit 重新执行。

## 5. 下载并校验安装包

```bash
RUN_ID=12345678901  # 替换为实际 workflow_dispatch run ID
ARTIFACT_DIR="/home/keqing/vibe/rust music/artifacts/windows-$RUN_ID"
mkdir -p "$ARTIFACT_DIR"
cd "/home/keqing/vibe/rust music/lyrift"
"$HOME/.local/bin/gh" run download "$RUN_ID" --dir "$ARTIFACT_DIR"
rg --files "$ARTIFACT_DIR"
```

安装包通常位于：

```text
artifacts/windows-<RUN_ID>/lyrift-windows-x64-nsis/Lyrift_<VERSION>_x64-setup.exe
```

设置实际路径并校验。记录 SHA-256，`file` 应识别为 Windows NSIS 可执行文件；NSIS 启动器本身显示为 PE32 是正常的，安装后的 `lyrift.exe` 必须是 PE32+ x86-64。

```bash
VERSION=0.1.5  # 替换为本次实际版本
INSTALLER="$ARTIFACT_DIR/lyrift-windows-x64-nsis/Lyrift_${VERSION}_x64-setup.exe"
test -f "$INSTALLER"
sha256sum "$INSTALLER"
file "$INSTALLER"
```

## 6. 安装前检查 Windows 状态

从 WSL 执行：

```bash
powershell.exe -NoProfile -NonInteractive -Command '$p = Get-Process -Name lyrift -ErrorAction SilentlyContinue; if ($p) { "RUNNING=" + (($p.Id | Sort-Object) -join ",") } else { "RUNNING=none" }; $exe = "D:\Program\Music\lyrift\lyrift.exe"; if (Test-Path $exe) { "EXE_VERSION=" + (Get-Item $exe).VersionInfo.ProductVersion } else { "EXE_VERSION=missing" }; $keys = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq "Lyrift" }; if ($keys) { "UNINSTALL_VERSION=" + $keys.DisplayVersion; "INSTALL_LOCATION=" + $keys.InstallLocation } else { "UNINSTALL_VERSION=missing" }'
```

只有输出 `RUNNING=none` 才继续。安装位置应为 `D:\Program\Music\lyrift`。

## 7. 静默覆盖安装

下面的变量应沿用上一步的实际值；如果换了终端，先重新设置：

```bash
RUN_ID=12345678901  # 替换为实际 workflow_dispatch run ID
VERSION=0.1.5       # 替换为本次实际版本
ARTIFACT_DIR="/home/keqing/vibe/rust music/artifacts/windows-$RUN_ID"
INSTALLER="$ARTIFACT_DIR/lyrift-windows-x64-nsis/Lyrift_${VERSION}_x64-setup.exe"
WIN_INSTALLER_WSL="/mnt/c/Users/29622/AppData/Local/Temp/Lyrift_${VERSION}_x64-setup.exe"
WIN_INSTALLER_PS="C:\Users\29622\AppData\Local\Temp\Lyrift_${VERSION}_x64-setup.exe"
cp "$INSTALLER" "$WIN_INSTALLER_WSL"
powershell.exe -NoProfile -NonInteractive -Command "\$p = Start-Process -FilePath '$WIN_INSTALLER_PS' -ArgumentList @('/S', '/D=D:\Program\Music\lyrift') -Wait -PassThru; 'INSTALL_EXIT=' + \$p.ExitCode; exit \$p.ExitCode"
```

必须得到 `INSTALL_EXIT=0`。不要在安装命令中加入启动应用的参数。

## 8. 安装后核验与清理

```bash
powershell.exe -NoProfile -NonInteractive -Command '$p = Get-Process -Name lyrift -ErrorAction SilentlyContinue; if ($p) { "RUNNING=" + (($p.Id | Sort-Object) -join ",") } else { "RUNNING=none" }; $exe = "D:\Program\Music\lyrift\lyrift.exe"; "EXE_EXISTS=" + (Test-Path $exe); if (Test-Path $exe) { $v=(Get-Item $exe).VersionInfo; "EXE_VERSION=" + $v.ProductVersion; "FILE_VERSION=" + $v.FileVersion }; $keys = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq "Lyrift" }; if ($keys) { "UNINSTALL_VERSION=" + $keys.DisplayVersion; "INSTALL_LOCATION=" + $keys.InstallLocation } else { "UNINSTALL_VERSION=missing" }'
file "/mnt/d/Program/Music/lyrift/lyrift.exe"
```

确认：

- `RUNNING=none`
- exe、文件元数据和卸载项版本均为新版本
- 安装位置仍为 `D:\Program\Music\lyrift`
- `lyrift.exe` 是 PE32+ x86-64

成功后只删除 Windows 临时安装包，保留仓库外的已校验 artifact 供回滚：

```bash
rm -f "$WIN_INSTALLER_WSL"
```

最后确认仓库干净、没有遗留开发进程：

```bash
cd "/home/keqing/vibe/rust music/lyrift"
git status --short
pgrep -af '/lyrift/node_modules/.bin/vite|src-tauri/target/.*/lyrift' || true
```

## 9. 真实 Windows 验收

让用户自行启动 Lyrift，至少检查：

- 原资料库、播放列表和队列仍存在
- 播放、暂停、切歌、点击和拖动进度条正常
- 播放中切换 Windows 默认输出设备后，最多约 1 秒自动跟随
- 音量、静音、关闭后重启恢复正常
- 歌词滚动、点击歌词 seek、全屏与窗口化正常
- 文件夹选择、窗口控制和卸载项正常

Rust 音频行为和 Windows WebView2 合成问题不能只靠 WSL 或浏览器测试确认。涉及这些路径的修改，在用户完成真实 Windows 验收前不要宣称问题已完全解决。

## 回滚

如果新版本在 Windows 验收失败，先让用户关闭 Lyrift，再从前一个 `artifacts/windows-<RUN_ID>` 目录取出已校验的 NSIS 安装包，按相同 `/S /D=D:\Program\Music\lyrift` 流程覆盖安装。不要删除应用数据。
