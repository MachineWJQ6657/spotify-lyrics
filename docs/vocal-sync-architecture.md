# Local vocal alignment

This is an implemented alternative clock, not a claim of universal musical ASR accuracy.

## 本地内嵌模型方案

结论：可以把识别引擎作为客户端的可选本地组件，但不能直接把语音转写时间戳当作精确的歌唱时间。Spotify 的播放进度和自带歌词可能共享同一个转场误差，因此只适合提供曲目身份、暂停和跳转事件，不适合作为声音校准的正确答案。0.4.37 已移除未经证实的私有转场速度曲线换算；媒体时间只是没有可靠声音证据时的回退。

建议的目标链路是：系统声音环形缓冲 → 识别正在唱的完整短句 → 在整首原文中定位段落 → 独立的发音对齐验证起唱时间 → 短期声音特征跟踪位置和局部速度 → 歌词专用时钟。这里的发音对齐是检查已知文字在音频中的位置，不是重新生成歌词。它仍可能把错误文字强行对齐，所以必须同时检查拒绝分数、重复段落歧义和前后连续性。

| 组件 | 选择与边界 |
| --- | --- |
| 本地推理运行时 | 优先延续 whisper.cpp，独立于 Electron 主进程和界面。官方支持 Windows、量化及 CUDA/Vulkan；默认程序不必携带 Python。当前安装的是 CPU 引擎，尚未测试 GPU 加速。[官方项目](https://github.com/ggml-org/whisper.cpp) |
| 多语言识别 | 现有 large-v3-turbo Q5 可作基线，而不是已通过验收的最终模型。模型包应独立下载、显示大小和校验值，用户启用后才加载。 |
| 日语候选 | Kotoba Whisper v2.0 值得与通用模型对照，官方提供 whisper.cpp 权重入口，训练和指标主要是日语语音，不能据此保证歌唱效果。v2.2 增加说话人区分和标点，本任务不需要这些额外组件。[v2.0 模型卡](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0)、[v2.2 模型卡](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.2) |
| 发音时间验证 | WhisperX 的“识别后再对齐”值得借鉴，其官方实现包含日语和中文对齐模型。先作为离线评测工具验证歌唱起始误差，再决定是否移植；不直接把整个 Python 服务塞入常驻客户端。[官方对齐实现](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py) |
| 连续进度跟踪 | 获得可信的绝对歌词锚点后，短时声学匹配负责跟踪；没有参考音频或可辨认短句时，声学指纹本身不能凭空给出整首歌的绝对秒数。 |

性能设计应是单独的可终止进程、至多一个推理任务、不积压旧录音、启用期间复用模型、停止或空闲后释放。低频识别用于重新定位，较轻的声学计算维持短时跟踪。GPU 方案必须测量显存、功耗、界面响应和游戏干扰；CPU 降级不能无限重试。模型识别、声音对齐和播放时钟分别报告状态，不能把“引擎就绪”写成“同步成功”。

重复副歌不得通过靠近 Spotify 秒数来消除歧义；两个重叠窗口也不能当作两份独立证据。转场时应重新判断当前主唱属于哪首歌，旧歌录音不能校正新歌。音频只在本机处理，日常环形缓冲不落盘；现有实验临时文件的清理规则见下文。音源当前为全部系统输出，Spotify 进程单独捕获尚待实现。

## 实录结果和推广门槛

2026年10月8日，在緑黄色社会《これからのこと、それからのこと》上完成一次有上限的重播对照，前12秒与重播后36秒中的同一声音匹配成功，两半独立匹配一致。相同声音对应的媒体时间差约42毫秒；这次未复现大幅漂移。跳转后不一定取消 Spotify 转场，因此这一结果不能证明任一时间轴与原始录音、LRC 或真实起唱时间一致，也不构成全局偏移修正。测试最后恢复了原本预计的同曲进度。

同一12秒实录的 CPU 测试：large-v3-turbo Q5 的 beam1 用时10.4秒，仅输出2个字符；beam5 用时9.7秒，得到部分接近原文的日语，但首尾截断且有错字，未满足完整歌词和时间证据要求。base beam5 用时1.2秒，错字更多，同样拒绝。30秒 turbo beam5 测试超过15秒预算后终止。单次用时不是稳定基准，也不能由字符数推断准确率；生产默认仍关闭人声对齐。当前模型 SHA1 与官方文件清单一致，不能把失败归因于已证实的模型损坏。

后续先用同一批本地录音比较 CPU/GPU、turbo/Kotoba 和是否加入发音对齐；样本要包含未转场、变速转场、两首重叠、间奏、重复副歌、错误歌词源和缺段。分开统计定位覆盖率、误接管率、起唱误差、首次锁定延迟、推理耗时与资源峰值。建议把人工标注起唱误差 P95 小于300毫秒、测试集中零错误接管作为初步发布门槛，而不是声称已达到。拒绝定位不算同步成功。

## Why another clock

Spotify's own lyric cursor and media position can disagree with audible singing after custom transitions. Copying that position cannot establish correctness. The new path searches the entire current original lyric using independently recognized words. It does not use Spotify's seconds to choose between repeated choruses.

System output → 12-second mono/16 kHz block → local whisper.cpp child → timestamped tokens → whole-lyric text matches → onset regression → two-block confirmation → short-lived lyric-only anchor.

Spotify remains responsible for song identity, pause/seek invalidation and transport controls. An accepted audio anchor bypasses Spotify Mix mapping; it never changes the actual playback position or issues playback commands.

## Implementation and safety

- `electron/audio-sync/local-asr.ts`: one child at a time, 4 threads, 15-second inference timeout; no shell, ffmpeg dependency, network or lyric prompt. Model paths are selected through native dialogs and persisted separately. The existing ignored developer cache is discoverable on this machine; binaries/models are NOT bundled or downloaded automatically.
- Temporary WAV and token JSON live in a unique subdirectory of `os temp/syllable-local-asr`; removed in `finally`. Abrupt process/OS termination may leave files. The app does not upload recordings or use the microphone. It captures all system output, not exclusively Spotify.
- `lyric-aligner.ts`: normalized spelling match, probabilities, token onset validation, line-order checks, bounded work, local tempo regression and repeated-passage ambiguity rejection. Segment-only timestamps cannot establish a line onset. No uniform word-time interpolation.
- `lyric-clock.ts`: two non-overlapping blocks with at least four distinct complete lines; rates must agree and source position predictions must agree within 550 ms. Recording capture time is retained throughout inference so compute latency does not become lyric delay. Anchor expires 28 seconds after the latest captured block, not after inference finishes.
- `vocal-sync.ts`: current-track ownership, serialized observations, lyric-version hashing, stale-result and cancellation guards. Pause, seek, track change, renderer failure and quit invalidate evidence.
- `acoustic-controller.ts`: lazy capture, no concurrent fingerprint/ASR jobs, no queue of old recordings. Switching/pause stops the session; subsequent songs require explicit restart during this experimental phase.

## Current limitations / next validation

Packaged live check on 2026-09-25 (secondary monitor, Byoushinwo Kamu): the full
capture/child/IPC/UI path ran and returned `insufficient-words`; no lock was
claimed. Observed child working set approximately733MB. Stop removed the child
and temporary files; Spotify returned to paused. This is evidence of a working
experimental pipeline and safe abstention, NOT evidence of synchronization accuracy.

- Recognition of Japanese singing is not proven by synthetic alignment tests. Whisper token probabilities are not calibrated confidence in lyric synchronization. Singing, accompaniment, repeated choruses, spelling/kanji differences and inaccurate LRC onsets can all force abstention.
- A 12-second sample plus model inference cannot provide immediate first-word lock. CPU model startup has a substantial transient memory cost; default is OFF and the process releases its model after each job. Do not enable continuous capture on app start.
- If there is no reliable match, keep the existing media clock and state that calibration failed. Do not claim this fallback is audibly correct.
- No song-specific magic offsets. No automatic retention of inferred offsets across recordings/transitions.
- Real vocal runs must measure false acceptance and audible onset error across held-out songs and custom transitions before promoting this path out of experimental mode.

Whisper CLI token JSON / arguments were checked against the [official v1.9.2 CLI source](https://github.com/ggml-org/whisper.cpp/blob/v1.9.2/examples/cli/cli.cpp). The timing estimates still require real-song validation.
