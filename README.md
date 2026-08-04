# Lyrift（流律）

Lyrift 是面向 Windows 11 的本地音乐播放器，使用 Tauri 2、Rust、React 和 TypeScript 构建。音频、资料库、播放队列与持久化状态由 Rust 后端管理。

当前处于首版开发阶段，Windows 安装包尚未完成真实设备验收。

## 功能

- MP3、FLAC、WAV、OGG/Vorbis、M4A/AAC 本地播放
- 文件夹扫描与监控、标签和封面提取、资料库搜索
- 专辑、歌手、收藏、播放列表、队列与播放历史
- 播放/暂停、seek、音量、随机与循环模式、重启恢复
- 下一首预加载与无缝切换
- ReplayGain Track/Album 模式、10 段均衡器、前级与 limiter
- 同名 `.lrc`、ID3v2 SYLT、可解析的内嵌 LRC 和普通内嵌歌词
- 普通资料库界面与全窗沉浸歌词模式

## 开发

需要 Node.js 24、Rust stable 和 Tauri 2 对应的 Linux 系统依赖。

```bash
npm ci
npm run dev
```

`npm run dev` 启动浏览器开发模式，并使用内置模拟资料库。完整 Tauri 联调使用：

```bash
npm run tauri dev
```

WSLg 的 WebKitGTK/Mesa 兼容性可能影响 Linux Tauri 窗口渲染，但不影响最终 Windows WebView2 构建。

## 检查

```bash
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

完整 Rust 测试会打开默认音频设备。GitHub Actions 的无硬件 runner 会跳过该硬件集成测试，其余测试仍正常运行。

## Windows 构建

[Windows workflow](.github/workflows/windows.yml) 使用 `windows-latest`：

- push 和 pull request 执行前端构建、rustfmt、Clippy 与无硬件测试
- 手动运行 workflow 生成可下载的 NSIS artifact
- 推送 `v*` 标签构建 NSIS 并创建 GitHub Release

Windows 安装包暂不签名，安装时可能出现 Microsoft Defender SmartScreen 提示。正式发布前必须在真实 Windows 11 上验证 WebView2、音频设备、文件夹对话框、窗口控制和安装/卸载。

## 数据与范围

数据库和封面缓存保存在 Tauri 应用数据目录。Lyrift 不启动本地 HTTP 服务，不上传资料库信息，也不联网获取歌词。

首版不包含流媒体、网络 URL、逐字歌词、标签编辑、响度扫描、自动更新、MSI 或代码签名。

## License

尚未选择开源许可证。公开分发源码前需要先确定许可证。
