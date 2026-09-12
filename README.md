# codex-plugins

给 Codex 桌面版（macOS）用的插件。目前一个：**porter**。

## porter —— 把聊天里的文件真正交到手上

Codex 聊天里的文件链接**拖不出去**，想发给别人只能自己进文件夹手动拖。
porter 换一条路：**把文件打成包写进 macOS 剪贴板**，你在任何窗口 `Cmd+V` 就能粘出文件本体——
微信、邮件、Finder、浏览器上传框都收。

```
你：把 outputs 里那几个报告发给我
Codex：（调 porter_zip）已打包并放进剪贴板，切到目标窗口 Cmd+V 即可。
```

### 工具

| 工具 | 作用 |
|---|---|
| `porter_zip` | **默认**。打成一个 zip 写进剪贴板。单文件是最大公约数，粘到哪儿都收 |
| `porter_clipboard` | 原样多文件进剪贴板。**只适用原生 app**——网页 paste 通道只收得到 1 个 |
| `porter_reveal` | 只在 Finder 里一次全选，不碰剪贴板。留给「我要自己拖」和拒收 zip 的站点 |

### 为什么默认打包

实测（同一份剪贴板）：粘进**原生 app** 是完整 6 个文件；粘进**网页**只到 1 个，
文件名还变成 UUID。这是浏览器 paste 通道的限制，不是剪贴板没写对。

而**单个 zip 正好不触发这个限制**——一个文件就是一个文件。所以打包既解决了网页，
也让原生 app 那边少漏文件。

zip 落在 `$TMPDIR/codex-porter`，24 小时自动清理，不脏桌面；要留存传 `dest_dir`。

## 安装

```sh
git clone https://github.com/edisontaisite/codex-plugins.git
cd codex-plugins
codex plugin marketplace add "$PWD"
codex plugin add porter@codex-plugins
```

改完源码要 `remove` 再 `add` 才生效——实际跑的是 `~/.codex/plugins/cache/` 下的副本。

## 要求

- **macOS only**。用的是 `NSPasteboard` / `ditto` / `open -R`
- Node ≥ 16（插件自带启动脚本，会优先找 Codex 内置的 Node）
- 无第三方依赖

## 已知边界

- **网页要多个独立文件只能拖**，不能粘。用 `porter_reveal` 在 Finder 全选后拖进去
- **会覆盖系统剪贴板**。一次调用做一件事
- 同名 zip 不覆盖，自动加 `-2` 后缀

## 许可

[MIT](LICENSE) © Edison
