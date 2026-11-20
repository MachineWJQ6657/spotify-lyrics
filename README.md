# Syllable

[English](README.en.md) · 中文

Syllable 是 Windows 上的 Spotify 桌面歌词客户端：打开 Spotify 桌面端播放歌曲，它自动找到同步歌词，在主窗口和一个置顶的透明悬浮窗里逐行显示，可以同时显示原文、中文翻译和日文罗马音。

当前版本：0.4.79

## 功能

- **即开即用**：直接读取 Windows 上 Spotify 桌面端的播放状态，不需要开发者账号；也可以选择连接 Spotify Web API。
- **自动匹配歌词**：同时查询 LRCLIB、网易云音乐和酷狗，按歌名、艺人、时长和歌词内容选出最合适的一份；可以在歌名旁的来源菜单里手动换源。
- **多语言轨道**：原文、中文翻译、罗马音（日文歌词用 Kuromoji 自动生成读音）可以同时显示，翻译会对齐到原文的每一行。
- **桌面歌词**：透明、置顶、可拖动缩放的悬浮窗；锁定后鼠标点击穿透；可调字号、字重、颜色、描边、背景和对齐；可选显示下一句、暂停时自动隐藏。
- **听音自动校准**：播放日语、中文、英文歌曲时听几段声音，自动把歌词整体提前或延后（需要本机的识别模型，模型不随仓库发布）。
- **查歌词**：不用播放也能看歌词。输入歌名或艺人搜索，或者直接打开资料库里的歌。
- **歌词资料库**：播放过的歌的歌词和校准结果保存在本机，可以导出备份、导入恢复。
- **编辑与导入**：搜索候选歌词、逐行改词和校时；把 LRC 文件拖进窗口即可导入。
- **界面语言**：中文或 English，在「偏好设置」里切换，默认跟随系统。

## 使用

1. 打开 Spotify Windows 桌面端并播放一首歌。
2. 启动 Syllable，主窗口显示这首歌的歌词。
3. 在右侧面板里选择要显示的语言，点「显示桌面歌词」打开悬浮窗。
4. 歌词不对时，点歌名右边的来源菜单换一个来源，或点「编辑」手动搜索和校时。

| 快捷键 | 作用 |
|---|---|
| `Ctrl + Alt + S` | 打开主窗口 |
| `Ctrl + Alt + L` | 显示或隐藏桌面歌词 |
| `Ctrl + Alt + M` | 锁定或解锁桌面歌词（锁定后点击穿透） |
| `Ctrl + Alt + U` | 解锁并显示歌词工具栏 |
| `F11` | 专注模式：只显示歌词 |
| `Ctrl + F` | 在歌词中查找 |
| `空格`、`←` `→` | 播放 / 暂停，后退 / 前进 5 秒 |

关闭主窗口后程序留在托盘，桌面歌词继续显示。

## 导入自己的歌词

把 LRC 文件拖进主窗口，导入给正在播放的歌。文件名里的语言后缀决定它是哪条轨道：

```text
song.ja.lrc       日文原文
song.romaji.lrc   罗马音
song.zh.lrc       中文翻译
song.en.lrc       英文翻译
```

各文件的时间戳不必完全相同，显示时按最近的一行对齐。导入和编辑过的歌词不会被自动匹配的结果覆盖。

## 从源码运行

需要 Windows 10 / 11 和 Node.js 22。

```bash
npm ci
npm run dev        # 开发模式
npm test           # 单元和集成测试
npm run build      # 类型检查并构建
npm run dist       # 打包 Windows 程序
```

## 可选：Spotify Web API

需要 Spotify Connect（比如歌在别的设备上播放）时可以连接 Web API：

1. 在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建应用。
2. 添加 Redirect URI：`http://127.0.0.1:43821/callback`。
3. 在 Syllable 右侧面板的「连接」里填入 Client ID 并连接。

使用 PKCE 流程，不需要也不保存 Client Secret。

## 项目结构

```text
Spotify 桌面端（Windows 媒体会话）─┐
Spotify Web API（可选）────────────┴─> 播放状态 ─> 歌词时钟 ─┬─> 主窗口
LRCLIB / 网易云音乐 / 酷狗 ─┐                                │
本地 LRC / 编辑器 ──────────┴─> 歌词匹配与多语言对齐 ─────────┴─> 桌面歌词
```

| 位置 | 内容 |
|---|---|
| `electron/local-spotify.ts` | 读取 Spotify 桌面端的播放状态并控制播放 |
| `electron/lyrics-provider.ts` | 多歌词源查询、选择和翻译对齐 |
| `electron/song-search.ts` | 「查歌词」页的歌曲搜索 |
| `electron/audio-sync/` | 听音校准 |
| `src/components/`、`src/Overlay.tsx` | 主窗口和桌面歌词界面 |
| `src/lib/lyrics.ts`、`src/lib/clock.ts` | LRC 解析、多轨对齐和歌词时钟 |
| `src/i18n/` | 界面语言（说明见 [src/i18n/README.md](src/i18n/README.md)） |
| `scripts/qa/` | 测试实例、性能测量和发布脚本（说明见 [scripts/qa/README.md](scripts/qa/README.md)） |

## 仓库里有什么、没有什么

仓库只包含源码和构建所需的资源。打包产物、识别模型、录音、测试配置和用户数据都不进仓库。`scripts/git-hooks/pre-push` 会在推送前检查这一点，克隆后用下面的命令启用：

```bash
git config core.hooksPath scripts/git-hooks
```

歌词来自 LRCLIB、网易云音乐和酷狗，版权归各自的权利人。
