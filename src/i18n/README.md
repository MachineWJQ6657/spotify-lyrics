# Interface languages

The interface is written in Chinese in the source and shown in Chinese or
English. `src/lib/i18n.ts` has the whole mechanism:

```ts
t('歌词资料库')                          // 歌词资料库 | Lyrics library
t('共 {count} 首', { count: songs.length }) // placeholders, in either language
tk('正在播放')                           // marks a text of a module-level table; shown later with t(value)
```

The English entries are in `src/i18n/en/*.ts`, one file per area, keyed by the
Chinese source text. A text without an entry is shown in Chinese.
`src/i18n/coverage.test.ts` fails when an interface text is not wrapped or a
wrapped text has no English entry.

## Rules for wrapping

1. Every text a user can see or hear goes through `t()`: JSX text
   (`<h1>{t('查歌词')}</h1>`), attributes (`title={t('返回')}`, `aria-label`,
   `placeholder`), messages put on screen, errors that are shown.
2. The key is a plain string literal. Never a template string, a variable or a
   concatenation inside `t()`: use placeholders, `t('已移除 {count} 首歌', { count })`.
   A text built from several computed parts becomes one sentence with
   placeholders, or separate complete phrases; do not glue fragments whose
   order differs between the languages.
3. A sentence with an element inside it is split around the element into
   complete phrases (`{t('例如')} <code>song.zh.lrc</code>`), or rephrased so
   that each part stands alone in both languages.
4. A table or constant built when the module loads (before the language is
   known) marks its texts with `tk('…')` and calls `t(value)` where the value
   is displayed. Code that runs while rendering, or in a handler, calls `t()`
   directly.
5. Chinese output must not change: with the language at its default the
   interface, and every existing test, read exactly as before. Do not edit
   tests to make them pass.
6. Data is not interface text: what is stored, compared, matched or exported
   (a provider's name inside a saved song, a track label such as `中文原文`, a
   pattern, a file name, a log line). Leave it and end the line with
   `// i18n-ignore: <why>` (in JSX: `{/* i18n-ignore: <why> */}` on that line).
   The line above works too. `qaLog(...)` and `console.*` arguments need no mark.
7. Stored labels that are *displayed* (`track.label`, `track.source`,
   `LYRICS_SOURCES[n].label`, a document's source tag) go through
   `localizeLabel()` from `src/lib/source-label.ts` at the place they are shown.
8. Nothing else changes: no refactoring, renaming, reformatting or behaviour
   change beyond what wrapping needs. Keep the file's line endings.
9. Code that runs outside a window's or the main process's main thread (a
   worker thread, a child process, a function injected into a worker as text)
   has no language set: `t()` there always answers in Chinese. Mark such texts
   with `tk()` where they are written and call `t(message)` where the main
   thread or the window shows them.

## English style

- Plain, short interface English in sentence case: "Lyrics library", "Show
  desktop lyrics", "Nothing found for “{query}”". Buttons and pills are narrow:
  keep a label close to the width of the Chinese one.
- Say what the thing does. No disclaimers, reassurances or precautionary
  wording that the Chinese text does not have.
- Punctuation: ASCII quotes are fine, “curly” quotes around quoted user text,
  an ellipsis character for "Searching…", no full stop on labels and buttons.
- Counts: prefer wording that reads right for any number ("Songs: {count}",
  "{count} of {total}") over "1 songs".
- Keep product and provider names: Syllable, Spotify, LRCLIB, Musixmatch,
  Kuromoji. 网易云音乐 = NetEase Cloud Music, 酷狗 = Kugou.

| Chinese | English |
|---|---|
| 歌词 | lyrics |
| 桌面歌词 | desktop lyrics |
| 悬浮窗 | overlay |
| 歌词资料库 / 资料库 | lyrics library / library |
| 歌词源 | lyric sources |
| 查歌词 | Find lyrics |
| 正在播放 | Now playing |
| 原文 / 翻译 / 罗马音 | original / translation / romaji |
| 听音校准 / 听音自动校准 | listening calibration / automatic listening calibration |
| 校准 / 偏移 | calibration / offset |
| 提前 / 延后 | earlier / later |
| 逐行 / 逐字 | line by line / word by word |
| 锁定 / 解锁 | lock / unlock |
| 点击穿透 | click-through |
| 轨道 | track (a lyric track: original, translation, romaji) |
| 歌曲 | song |
| 时间轴 | timeline (the timing of the lyrics) |
| 纯音乐 | instrumental |
| 专注模式 | focus mode |
| 控制栏 / 工具栏 | toolbar |
| 托盘 | tray |

## Checking

```bash
I18N_ONLY=SettingsPanel.tsx,SourceMenu.tsx npx vitest run src/i18n/coverage.test.ts   # some files
I18N_REPORT=1 npx vitest run src/i18n/coverage.test.ts                               # counts per file
npx vitest run src/i18n/coverage.test.ts                                             # everything
```
