# Porter — 设计背景

面向用户的说明见[仓库根 README](../../README.md)。这里记录几个「为什么是这样做的」。

## 为什么不去修拖拽

**Codex 插件够不着对话渲染层。** 扩展面只有 `.codex-plugin/plugin.json` +
`.mcp.json`(MCP server) + `skills/`，跑在 UI 进程之外。
所以「让聊天里的文件链接可拖」第三方做不到，那需要宿主自己实现。

Porter 的取向是：**不去修拖拽，而是让拖拽没必要发生。**

## 关于宿主的渲染引擎

Codex 桌面版（`/Applications/ChatGPT.app`，bundle id `com.openai.codex`）
**是 Chromium 内嵌应用**，不是原生 AppKit。证据在
`Codex Framework.framework/Versions/<ver>/`：`Helpers/` 下有 `Codex (Renderer).app`、
`Codex (GPU).app`、`Codex (Service).app`、`browser_crashpad_handler`（Chromium
多进程标准布局），`Resources/` 下有 `chrome_*.pak`、`v8_context_snapshot.arm64.bin`。

> **别用 `otool -L` 判这个 app 的渲染引擎。** 主二进制 `Contents/MacOS/ChatGPT`
> 只链 `libSystem`，那是启动壳 —— 本文档最初据此判成「原生 AppKit」，是错的。

这不改变上面的结论（插件扩展面与引擎无关），但留下一个**未验证**的口子：
既然是 Chromium，能往对话里塞沙箱 iframe 的 skill 理论上可以借
`DownloadURL` 拖拽机制拖出真文件。沙箱多半禁了 downloads，没试过，别当结论用。

## 剪贴板要铺两个通道

macOS 上「文件剪贴板」不是一种格式：

- `public.file-url` —— 每个文件一个 `NSPasteboardItem`，Finder 和现代 App 读这个
- `NSFilenamesPboardType` —— 老一些的 App 读这个

只铺前者，一些 App 只能粘到第一个文件；只铺后者，Finder 侧行为不稳。两个都铺。

### JXA 的坑

`NSPasteboard.writeObjects` 传 NSURL 数组的写法，**在 osascript 脚本文件里会静默
只落一个 item**（同样的代码用 `-e` 内联却是对的）。所以
[`pbcopy-files.js`](pbcopy-files.js) 显式构造 `NSPasteboardItem`，
并且**写完回读校验条目数**，对不上就抛错。

交付工具静默丢文件比直接失败糟得多 —— 用户不会发现，对方也不会说。

## zip 落在暂存区

`porter_zip` 的产物是一次性中转物，落在 `$TMPDIR/codex-porter`，24 小时后自动清理。
早期版本落桌面，结果是用户桌面很快堆满没人删的交付包。
要留存传 `dest_dir`，那时不清理。
