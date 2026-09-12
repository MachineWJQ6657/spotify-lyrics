# Syllable 0.4.15 验收清单

## 0.4.15 当前验收结论

- [x] 版本号 0.4.15；歌词 Provider/cache revision 27。
- [x] `npm test`：141 项通过、29 项真实联网用例默认跳过；完整联网回归 170/170 通过；TypeScript 与生产构建通过。
- [x] 每次歌词结果写入前重新校验曲目、时长桶、Provider 上下文和 retry token；旧 Promise、旧罗马音补全与旧定时重试均不能污染当前歌曲。
- [x] 瞬时结果只进入当前窗口内存视图；稳定缓存和用户编辑不被 429/503/超时覆盖。强制重试仅绕过一次缓存，旧 generation 无法回填。
- [x] Spotify 暂时报 0 时长不会冻结歌词时钟；同曲缓存立即显示，4 秒有界降级后仍可请求歌词。
- [x] 全部播放控制入口共享主进程切歌事务；同 tick 双击、跨窗口重复、不同方向和不同后端命令都被同一门控拒绝，直到新曲稳定 250 ms 或 6 秒上限。
- [x] 上一首在 3 秒阈值内原子选择 seek-to-zero；切歌空 SMTC 快照保持原身份，失败按 transaction id 回滚，不会连跳或抢 Spotify 按钮控制权。
- [x] `Same Blue — Official鬍子男dism` 在线语料确认 237836 ms 版本、正文 >30 行、尾部覆盖 >0.75 和网易云中文 >25 行。
- [x] 150% DPI 副屏六项最终包 QA 通过；控制条悬停/离开/打开/关闭/重开、820×220 拖动恢复、防拖动误开、四档等宽和歌词跟随均有独立证据。
- [x] 字体度量：Yu Gothic ready，500/600/700/800 四档 `晴る会行` 均为 `[64,64,64,64]`；透明歌词截图四角 alpha=0。
- [x] 播放态 20.3 秒：4 个进程、CPU 1.172 秒、私有提交 377.7 MB（−66 MB）、工作集 −73.9 MB、LevelDB 零写入、全部响应且日志无错误告警。
- [x] 当前常驻：`release/verified-0415-final-20260911-113456/Syllable.exe`，日志 `qa-0415-final-live.log`。

## 0.4.15 最终产物

- [x] 免安装 ZIP：`release/Syllable-0.4.15-Portable.zip`
- [x] ZIP SHA-256：`27D1753855DD8F673ACB0B1B33991D3F3355A5AD9DCF4AF8EAA86EEE53257B43`
- [x] 安装包：`release/Syllable-0.4.15-Setup.exe`
- [x] 安装包 SHA-256：`0F970120D853D9F23F555A98EA71B0612CAFD74A85DF8E4E64FA4A5C94F6F6CF`
- [x] 全新解压验证目录：`release/verified-0415-final-20260911-113456/`
- [x] 源码检查点：`checkpoints/Syllable-0.4.15-source-20260911-114152.zip`（65 项），SHA-256 `4AF55D0E4FDA42F6D5D58E9A90AEA226B35EF6A930356DB901DCAC61E464072F`
- [x] QA：`qa-0415-final-main.*`、`qa-0415-final-overlay-controls.*`、`qa-0415-final-overlay-drag-performance.*`、`qa-0415-final-overlay-drag-open-guard.*`、`qa-0415-final-font-metrics.*`、`qa-0415-final-lyrics-scroll.*`

## 0.4.14 当前验收结论

- [x] 版本号 0.4.14；歌词 Provider/cache revision 27。
- [x] `npm test`：122 项通过、28 项真实联网用例默认跳过；完整联网回归 150/150 通过。
- [x] 全局 5.5 秒多源生成预算可中止 fetch 与退避；部分结果立即显示但不缓存，当前歌曲未变且无人编辑时 12 秒后只自动重试一次。
- [x] 空响应不再掩盖同源的瞬时失败；临时缺中文/罗马音或缺候选不会固化为稳定文档。
- [x] 两个彼此吻合的完整时间轴可用有序文本锚点否决整体偏移的 LRCLIB 精确稿；单一来源或稀疏重复锚点不能误伤，Spotify 官方时间轴仍权威。
- [x] 队列边界时长接管受身份、2.2 秒年龄、15 秒最小时长以及新旧进度均不超过 2.5 秒限制；普通同曲修正和已有正时长不会被覆盖。
- [x] 自然边界 `ランタノイド → Thirsty, Anxiety`：新身份到请求 323 ms、结果 1.874 秒、一次请求、30 行、尾部覆盖正常、时钟漂移 ±1 ms。
- [x] `ランタノイド` 的 36 个合并句与 45 个拆分句按归一化文本和尾部覆盖判为同一完整内容，不再把物理行数当作完整性本身。
- [x] 第一条歌词前的同步目标由确定性回归锁定为列表顶部；最终包常规中段目标从 684 回到 504（目标 504.3），恢复按钮随后隐藏。
- [x] 全新解压目录在 150% DPI 副屏完成 6 组 QA，均退出码 0；控制条、拖动、防误开、字体度量与恢复跟随全部通过。
- [x] `晴る会行` 在 500/600/700/800 四档字重均为 `[64,64,64,64]`，Yu Gothic 已加载。
- [x] 最终常驻暂停态 15.2 秒：4 进程、CPU 0.156 秒、私有提交 381.8 MB 且回落 81.7 MB、工作集回落 78.6 MB、LevelDB 零写入、全部响应、fatal 扫描为空。
- [x] 当前常驻：`release/verified-0414-final3-20260911-105611/Syllable.exe`，日志 `qa-0414-final3-live.log`。

## 0.4.14 最终产物

- [x] 免安装 ZIP：`release/Syllable-0.4.14-Portable.zip`
- [x] ZIP SHA-256：`C7BEB9DB2F0D8E313752D7090CA0E37E09AEA9E9B523405A9DA03E27A2ECC123`
- [x] 安装包：`release/Syllable-0.4.14-Setup.exe`
- [x] 安装包 SHA-256：`167A1D1279217D8C19E727EF4F74C48F41026CA22277EF50768A463CE9AA873F`
- [x] 全新解压验证目录：`release/verified-0414-final3-20260911-105611/`
- [x] 源码检查点：`checkpoints/Syllable-0.4.14-source-20260911-110147.zip`（63 项），SHA-256 `22DA76A1F37C1970B1869CC56B45740A8E75FFC90DA99EDD41036319CCEF5919`
- [x] QA：`qa-0414-final3-main.*`、`qa-0414-final3-overlay-controls.*`、`qa-0414-final3-overlay-drag-performance.*`、`qa-0414-final3-overlay-drag-open-guard.*`、`qa-0414-final3-font-metrics.*`、`qa-0414-final3-lyrics-scroll.*`

## 0.4.13 历史验收结论

- [x] 版本号 0.4.13；歌词 Provider/cache revision 仍为 26，因为本次只改变请求启动时机，不改变已缓存歌词的数据语义。
- [x] `npm test`：111 项通过、24 项在线用例默认跳过；完整联网回归 135/135 通过。
- [x] 正时长本机媒体快照即使仍在解析私有转场，也会进入 320 ms 静默合并窗；零/无效时长仍严格不请求。
- [x] 真实自然换歌中新身份到请求为 326 ms；请求早于转场超时 1.643 秒，全程一次请求，歌词在新歌第 3.065 秒就绪。
- [x] 若 320 ms 后仍出现新曲 id、时长桶或源时长，旧 effect 会取消且不能写入文档；Provider 本身按曲名、艺人和时长桶隔离缓存/并发请求。
- [x] 最终解压目录在 150% DPI 副屏完成主界面、控制栏、拖动性能、字体度量和歌词滚动 5 组 QA，均退出码 0。
- [x] 控制栏悬停可见、离开隐藏、打开客户端、关闭歌词和重开均成功；拖动从 `(-1263,716)` 到 `(-1173,680)` 后仍为 820×220。
- [x] Yu Gothic 500/600/700/800 四档 `晴る会行` 均为 `[64,64,64,64]`；歌词滚动从 3048 到 3228 后恢复 3048。
- [x] 最终包 12.02 秒稳定播放：CPU 0.751 秒、私有提交 380.9 MB 且下降 15.1 MB、工作集下降 18.9 MB、LevelDB 零写入；所有进程响应且日志无 fatal。
- [x] 当前常驻：`release/verified-0413-final-20260911-004445/Syllable.exe`，日志 `qa-0413-final-live.log`。

## 0.4.13 最终产物

- [x] 免安装 ZIP：`release/Syllable-0.4.13-Portable.zip`
- [x] ZIP SHA-256：`737E5DF884BCFA7D866F4DA417CA198C2535735FCD0C3EC77649A4E0E4EA47E7`
- [x] 安装包：`release/Syllable-0.4.13-Setup.exe`
- [x] 安装包 SHA-256：`2F622C79C914DEF380E091CC87C2FBCEA0E00E6A0FD6B4D153261B791C467C55`
- [x] 源码检查点：`checkpoints/Syllable-0.4.13-source-20260911-005005.zip`（61 项），SHA-256 `D066E6FF323EF759B859B5DE95356E6101E159ED32D96EBECF3190E26EE3B584`
- [x] QA：`qa-0413-final-main.*`、`qa-0413-final-overlay-controls.*`、`qa-0413-final-overlay-drag-performance.*`、`qa-0413-final-font-metrics.*`、`qa-0413-final-lyrics-scroll.*`

## 0.4.12 当前验收结论

- [x] 版本号 0.4.12，歌词 Provider/cache revision 26；标题栏截图和解压后 EXE ProductVersion 均为 0.4.12。
- [x] `npm test`：111 项通过，24 项在线用例按设计跳过；完整联网回归：135/135（其中 24 项真实歌词源）通过。
- [x] `HIBANA — Fading Sparks and Summer Sky` 的英文 Spotify 标题通过片假名艺人折叠与精确时长指纹匹配到日文原名；返回 27 条有效同步原文，并有中文及罗马音轨。
- [x] 常规曲名查询缺失、低于 88% 或版本时长偏差超过 1.2 秒时才检查 50 项有界艺人页；错误同艺人近时长候选不能凭更多短行越过相差 6 分的健康身份结果。
- [x] `RADWIMPS — Suzume` 不再选 240000 ms 俄语翻唱或 236390 ms 单曲版；选中 238560 ms 原声带并把网易云中文轨对齐到最终主时间轴。
- [x] 主进程使用内建轻量假名折叠而非加载完整 `wanakana`；最终 main bundle 为 123.52 kB。
- [x] 长 CJK 行平衡换行已进入最终 CSS；不修改字体、字号、字宽、歌词时间戳或 Spotify transport。
- [x] 最终解压目录在 150% DPI 副屏完成主界面、控制栏、拖动性能、字体度量和歌词滚动 5 组 QA，均退出码 0。
- [x] 控制栏在真实鼠标移到副屏空白区时，悬停显示与离开隐藏均通过；打开客户端、关闭歌词和重开均成功。
- [x] 拖动从 `(-1263,716)` 到 `(-1173,680)` 后仍为 820×220；四档日文字重仍为 `[64,64,64,64]`。
- [x] 播放态 12.02 秒：4 个进程、CPU 0.750 秒、私有提交 370.1 MB 且下降 14.3 MB、工作集下降 19.9 MB；独立 10 秒 LevelDB 无写入变化，进程均响应，实时漂移维持 ±1 ms。
- [x] 当前运行：`release/verified-0412-final-20260911-003131/Syllable.exe`，副屏参数和日志 `qa-0412-final3-live.log`。

## 0.4.12 最终产物

- [x] 免安装 ZIP：`release/Syllable-0.4.12-Portable.zip`
- [x] ZIP SHA-256：`E9E589E0B28E154DF608B2AAD7433D83BA2316520E3C06268A343D281F696E99`
- [x] 安装包：`release/Syllable-0.4.12-Setup.exe`
- [x] 安装包 SHA-256：`E1DBC7717D5E064E9802EE0FB3A282CE8215B99AB4C758DE6DEDF8C5A075BC9E`
- [x] 源码检查点：`checkpoints/Syllable-0.4.12-source-20260911-003750.zip`（61 项），SHA-256 `6F5A074A8CADCB094E1648A424E1492BB2BE159245137468B557EA66DC700D6D`
- [x] QA：`qa-0412-final3-main.*`、`qa-0412-final3-overlay-controls.*`、`qa-0412-final3-overlay-drag-performance.*`、`qa-0412-final3-font-metrics.*`、`qa-0412-final3-lyrics-scroll-stable.*`

## 0.4.11 当前验收结论

- [x] 版本号为 0.4.11，歌词 Provider/cache revision 为 25。
- [x] `npm test`：107 项通过，22 项联网用例按设计跳过；`SYLLABLE_ONLINE_QA=1`：22/22 通过。
- [x] `npm run build` 和 Windows 安装包/免安装 ZIP 构建通过；全新解压目录完成 5 组副屏 QA。
- [x] 启动旧进度锚点被隔离；检测到权威修正后快速放行，否则使用 3.2 秒有界稳定窗口。
- [x] 同标题下大幅时长变化与接近零进度会先确认媒体归属；真实自然边界日志中 `カラカラ`、`ブルーバード`、`CHAIN` 均未发生跨曲时长污染，且每首只请求一次歌词。
- [x] 跨源完整性检查能识别短重复后缀；`カラカラ` 最后三条 `やれるわ` 全部保留，尾部覆盖率大于 0.95，中文轨来自网易云。
- [x] 录音时长硬门槛同时位于 Provider 内部与最终合并层；`HIBANA — Untrue` 的 376693 ms 错误同名版本不会映射到 207744 ms 播放项。
- [x] 临时无歌词结果不会写入进程级成功缓存，主界面可手动重新匹配。
- [x] 控制条由窗口事件驱动显隐；歌词空白像素穿透、文字/按钮命中、直接拖动、原生四边缩放和副屏坐标均通过实测。
- [x] 最终包控制栏悬停可见、离开隐藏；打开客户端、关闭歌词和重新显示全部成功。拖动 90×−36 逻辑像素后仍保持 820×220。
- [x] Yu Gothic 已加载；500/600/700/800 四档 `晴る会行` 字面宽度均为 `[64,64,64,64]`。中文与拉丁轨分别使用专用字体栈并禁用合成字重。
- [x] 主界面歌词可上下浏览并用“回到当前歌词”恢复同步；最终 QA 从 4354.67 滚到 4534.67 后恢复 4354.67。
- [x] 主客户端位置刷新为 160 ms，桌面歌词保持 80 ms。开发态主界面 18 秒 CPU 0.422 秒；最终解压包播放态 18 秒 CPU 0.781 秒、私有内存 369.5 MB、工作集仅 +0.2 MB、LevelDB 无写入变化。
- [x] 最新常驻副本：`release/verified-0411-final-20260910-234232/Syllable.exe`，日志：`qa-0411-final-live.log`。

## 0.4.11 最终产物

- [x] 免安装 ZIP：`release/Syllable-0.4.11-Portable.zip`
- [x] ZIP SHA-256：`C9A92C91DAED3464703DE6CB701845547A0E7E1A34B78A417BA383CECC0D3449`
- [x] 安装包：`release/Syllable-0.4.11-Setup.exe`
- [x] 安装包 SHA-256：`9D9051C8848236998FD06C665A2DB0BC3ED6D64A28A8B497EE18C26D1D382D8E`
- [x] 全新解压验证目录：`release/verified-0411-final-20260910-234232/`
- [x] 源码检查点：`checkpoints/Syllable-0.4.11-source-20260911-000111.zip`（61 项），SHA-256 `D434E8B78F486FE6F3F6F0E86A8CF77D1F07B655404776ED89E1D0F9620F21A8`
- [x] QA 日志：`qa-0411-final-main.log`、`qa-0411-final-overlay-controls.log`、`qa-0411-final-overlay-drag-performance.log`、`qa-0411-final-font-metrics.log`、`qa-0411-final-lyrics-scroll.log`

## 0.4.10 历史验收记录

## 功能与交互

- [x] Windows 桌面客户端可从安装包或免安装 ZIP 启动；主窗口、任务栏和托盘统一使用绿色音符图标。
- [x] 无需 Spotify Developer 账号即可通过 Windows SMTC 获取当前歌曲、播放状态、真实 position、时长和控制能力。
- [x] 主界面采用 Spotify 黑灰绿视觉；默认 1120×720，副屏测试时主窗口与歌词窗均限制在副屏工作区。
- [x] 原文、中文、English、Romaji 和导入的任意语言可以多选并同时显示。
- [x] 主歌词区可自由滚动浏览，“回到当前歌词”恢复自动跟随。
- [x] 日文使用 Yu Gothic Regular / Medium / Bold 真实字重并保持 CJK 等宽；中文使用 Noto Sans SC / 微软雅黑；英文与 UI 使用 Segoe UI。
- [x] 桌面歌词透明置顶、可直接拖动、四边原生缩放、位置和大小持久化；支持背景开关、透明度、字号、字重、行距、颜色、阴影/描边、圆角和对齐。
- [x] 透明空白像素不占用桌面点击；控制条只在悬停时出现，提供上/下一首、播放/暂停、打开客户端、锁定和关闭。
- [x] 控制条按钮可点击；拖动释放后的跨窗口伪点击不会打开客户端，700 ms 后的明确点击仍有效。
- [x] 主窗口关闭后最小化并保留任务栏入口；托盘、再次启动、控制条和 `Ctrl+Alt+S` 均可找回。

## 歌词正确性与同步

- [x] LRCLIB、网易云和酷狗并行选源；身份、专辑、时长、同步性、覆盖率和跨源时间轴共识共同参与选择。
- [x] 标题含假名时优先保留日文原文；中文交错行拆到独立翻译轨，不再污染原文。
- [x] 网易云中文在覆盖率接近时优先，按最终原文时间轴重映射；一条翻译对应两条拆分原文时可安全延续，长间奏不会滞留。
- [x] 装饰性 `♪` 不参与完整性统计；稳定跨源锚点能识别开头、中段和结尾缺失，只有有界且证据充分的缺口才自动补行。
- [x] 人工罗马音优先；缺行或仍含汉字/假名时，以 Kuromoji + Kuroshiro 按原文时间轴整轨补全。
- [x] 切歌时必须等标题、正时长和转场归属到同一媒体项，再静默合并 320 ms；不会以“新歌名 + 上一首正时长”请求歌词。
- [x] Provider/cache revision 为 21，旧的错误版本、残缺时间轴、交错双语缓存以及受拆行评分影响的结果会自动重新抓取。
- [x] 精确曲目/专辑候选不会因为另一来源把相同内容拆成更多物理行而落选；经跨源稳定锚点证明的真实缺段仍会否决精确候选。
- [x] 开头带时间戳的“歌手 - 歌名”制作元数据会被移除，真实同名歌词不受影响；同一主歌词区间内的多段中文译文不会互相覆盖。
- [x] Spotify position 始终是唯一 transport；cue 只用于诊断，fade-out 不被当作原曲终点。
- [x] 有可信 Spotify speed automation 时分段积分；曲线无效时安全回退。
- [x] 私有 Mix 配方不可读时，若高置信度发行版时长与 Spotify 混合时长之比位于 0.82–1.18 且差异至少 2%，只将歌词时钟做端点映射，不修改 Spotify 播放进度或按钮。
- [x] 一次下一首操作只发送一个定向命令；Spotify 的短暂无会话状态不会提前解除防重复锁。

## 自动与实机证据

- [x] `npm test`：89 项通过，8 项在线用例按设计跳过。
- [x] `SYLLABLE_ONLINE_QA=1`：16/16 真实歌词源用例通过，包括 `ヨルシカ — 言って。` 日中拆轨、`Vaundy — Tokimeki` 自定义 Mix 版本选择，以及 LRCLIB 无同步稿的 `tuki. — Bubble` 网易云降级。
- [x] `npm run build` 与 `npm run dist` 通过，安装包和 ZIP 均完成生成。
- [x] 真实切歌日志先收到 `Tokimeki` 的 0/过渡状态，待稳定后只发出 `spotifyDuration=233081` 的请求；选中网易云 97% 的 212000 ms 发行版、65 行歌词，没有使用上一首 242182 ms。
- [x] Tokimeki 主界面显示 `时长校准 · 0.910×`；Spotify 原生进度仍为 1:40 / 3:53，歌词内部映射约为 1:31。
- [x] 当前曲目 `言って。` 在 Spotify 71.270 秒显示 `あぁいつか人生最後の日`，日文、罗马音、网易云中文为三条独立轨道。
- [x] 读取 Spotify 官方歌词面板做内容对照：官方 38 个合并句与 LRCLIB 48 个细分时间行去除标点/分行后均为 458 字符，逐字完全一致。
- [x] 临时播放 12 个实时采样点进行时序对照：Spotify 官方白色高亮句均包含 Syllable 当前细分行，12/12 命中；随后恢复暂停与 71.270 秒位置。
- [x] 150% DPI 副屏字体度量：500/600/700/800 四档的 `晴る会行` 均为 `[64,64,64,64]`，Yu Gothic 已加载。
- [x] 两张最终悬浮窗 PNG 的四角 Alpha 均为 0；QA 日志未出现 renderer gone、unresponsive、worker failure、fatal 或 uncaught error。
- [x] 最终包暂停 10 秒初始采样：4 个 Electron 进程，CPU 增量 0；私有提交合计 273.5 MB。随后 30 秒稳定采样中私有提交下降 2.96 MB、工作集合下降 2.70 MB、CPU 合计 0.203 秒，没有持续增长或卡住；工作集合含共享 Chromium/GPU 页，不能等同独占内存。
- [x] 0.4.10 稳定期采样：30 秒 CPU 合计 0.109 秒、私有提交仅 +0.39 MB；启动后的 LevelDB 正常压缩完成后，后续 25 秒大小和修改时间均无变化。

## 最终产物

- [x] 免安装 ZIP：`release/Syllable-0.4.10-Portable.zip`
- [x] ZIP SHA-256：`56770224A9566D26E49891C68DC95F9A3D6786307F334E9ABAE94E6DE29FEE4F`
- [x] 安装包：`release/Syllable-0.4.10-Setup.exe`
- [x] 安装包 SHA-256：`851243A54453DF8D2DEF70419AD6C2332EE2BD46168CE7416789AAA21AEC0B90`
- [x] 全新解压并实机验证：`release/verified-0410-final-20260910-195900/Syllable.exe`
- [x] 当前常驻日志：`qa-0410-final-live.log`
- [x] 最终主界面/悬浮窗截图：`qa-0410-font-metrics.png`、`qa-0410-overlay-controls.png`
- [x] 最终交互/字体日志：`qa-0410-font-metrics.log`、`qa-0410-overlay-controls.log`、`qa-0410-overlay-drag-performance.log`
- [x] 源码检查点：`checkpoints/Syllable-0.4.10-source-20260910-200619.zip`（67 项），SHA-256 `05FD091DA41C68650FAA06F1C16B406EB0417EC3BA9CF6AF82B856948BDE41F4`

## 外部限制

- 第三方歌词覆盖率和内容会受地区、网络及社区数据影响；无法匹配时仍可搜索、导入、改词和逐行校时。
- 任意目标语言的机器翻译尚未内置；自动多语言以歌词源已有翻译为主，其他语言可导入 LRC/TXT。
- Spotify 的 `context_player_state_restore` 可能数秒仍停留在上一首；此时使用经过边界限制的发行时长映射，不会强行套用陈旧私有配方。
- 安装包没有商业代码签名证书，Windows SmartScreen 可能显示未知发布者；免安装包已从全新目录验证可启动。
