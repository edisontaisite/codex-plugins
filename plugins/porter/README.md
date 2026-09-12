# porter

Codex 桌面版（`/Applications/ChatGPT.app`，bundle id `com.openai.codex`）**是 Chromium 内嵌应用**，
不是原生 AppKit。证据在 `Codex Framework.framework/Versions/152.0.7977.83/`：
`Helpers/` 下有 `Codex (Renderer).app`、`Codex (GPU).app`、`Codex (Service).app`、
`browser_crashpad_handler`（Chromium 多进程标准布局），`Resources/chrome_100_percent.pak` 660K，
版本号 `152.0.7977.83` 就是 Chrome 的版本体系。

> **别用 `otool -L` 判这个 app 的渲染引擎。** 主二进制 `Contents/MacOS/ChatGPT` 只链 `libSystem`，
> 那是启动壳——本文档最初据此判成「原生 AppKit」，是错的。真相在 Framework 目录里。

不管底层是什么，**Codex 插件都够不着对话渲染层**：扩展面只有
`.codex-plugin/plugin.json` + `.mcp.json`(MCP server) + `skills/`，跑在 UI 进程之外。
所以「让聊天里的文件链接可拖」第三方做不到。

> 未验的口子：既然是 Chromium，`visualize` 那类能往对话里塞沙箱 iframe 的 skill，
> 理论上可以借 Chromium 的 `DownloadURL` 拖拽机制拖出真文件。但沙箱多半禁了 downloads，
> **没试过**，别当结论用。

这个插件绕开了这个问题：**不去修拖拽，而是让拖拽没必要发生。**
macOS 剪贴板可以承载真文件（`public.file-url` + `NSFilenamesPboardType`），
所以把文件写进剪贴板，在目标窗口 `Cmd+V` 就能粘出文件本体。

## 工具

- `porter_zip` —— 打成 zip + 进剪贴板（默认）。zip 落在暂存区 `$TMPDIR/codex-porter`，
  24 小时后自动清理，不脏桌面；要留存传 `dest_dir`。
- `porter_clipboard` —— 原样进剪贴板，不打包
- `porter_reveal` —— 只在 Finder 里全选，不碰剪贴板

## 安装

```sh
git clone https://github.com/edisontaisite/codex-plugins.git
cd codex-plugins
codex plugin marketplace add "$PWD"
codex plugin add porter@codex-plugins
```

改完源码要 `codex plugin remove porter@codex-plugins` 再 `add` 才生效——
实际跑的是 `~/.codex/plugins/cache/` 下的副本。

## 已知边界：网页目标别粘贴

粘进**原生 app**（微信、邮件、Finder）是完整的多个文件；
粘进**网页**（ChatGPT 输入框等）只到 1 个，文件名还会变成 UUID ——
浏览器的 paste 通道拿不全文件列表和文件名。

网页有两条路：

- **`porter_zip`（推荐）** —— 一个 zip 就是一个文件，正好不触发 paste 的数量限制，直接粘。
  唯一风险是目标站点可能拒收 `.zip`。
- **`porter_reveal` + 拖拽** —— 在 Finder 里全选后拖进去，数量和名字都对。
  网页的**拖拽**通道是好的，坏的只有 paste。

## 只有 macOS

用的是 `NSPasteboard` / `ditto` / `open -R`，Windows、Linux 上不工作。
