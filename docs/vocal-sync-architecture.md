# Local vocal alignment

This is an implemented alternative clock, not a claim of universal musical ASR accuracy.

本文当前实现说明以2026年10月19日的0.4.40源码候选为准；固定入口部署版本仍为0.4.39。下方带日期的实录保留为历史证据，不能将旧实现限制当成当前行为，也不能将候选的离线通过当成已部署或已准确同步。

## 本地内嵌模型方案

结论：可以把识别引擎作为客户端的可选本地组件，但不能直接把语音转写时间戳当作精确的歌唱时间。Spotify 的播放进度和自带歌词可能共享同一个转场误差，因此只适合提供曲目身份、暂停和跳转事件，不适合作为声音校准的正确答案。0.4.37 已移除未经证实的私有转场速度曲线换算；媒体时间只是没有可靠声音证据时的回退。

建议的目标链路是：系统声音环形缓冲 → 识别正在唱的完整短句 → 在整首原文中定位段落 → 独立的发音对齐验证起唱时间 → 短期声音特征跟踪位置和局部速度 → 歌词专用时钟。这里的发音对齐是检查已知文字在音频中的位置，不是重新生成歌词。它仍可能把错误文字强行对齐，所以必须同时检查拒绝分数、重复段落歧义和前后连续性。

| 组件 | 选择与边界 |
| --- | --- |
| 本地推理运行时 | 生产使用独立 whisper.cpp 子进程；本机CPU及CUDA12运行时均已实测。发现已有本地运行时时优先GPU，GPU失败后只在同一15秒预算内尝试一次CPU回退。默认程序不携带Python，也不会自动下载引擎或模型。[官方项目](https://github.com/ggml-org/whisper.cpp) |
| 多语言识别 | 现有 large-v3-turbo Q5 可作基线，而不是已通过验收的最终模型。模型包应独立下载、显示大小和校验值，用户启用后才加载。 |
| 日语候选 | Kotoba Whisper v2.0官方Q5模型已做本地独立基准，尚未接入生产或替换默认模型。它只有两层decoder，不能套用Turbo的DTW preset；实验用独立DLL进程的N_TOP_MOST/top1配置，结果仍不足以建立跨录音时钟。其语音训练指标不能保证歌唱效果。v2.2的说话人区分和标点不属于本任务必需组件。[v2.0 模型卡](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0)、[v2.2 模型卡](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.2) |
| 发音时间验证 | WhisperX 的“识别后再对齐”值得借鉴，其官方实现包含日语和中文对齐模型。先作为离线评测工具验证歌唱起始误差，再决定是否移植；不直接把整个 Python 服务塞入常驻客户端。[官方对齐实现](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py) |
| 连续进度跟踪 | 获得可信的绝对歌词锚点后，短时声学匹配负责跟踪；没有参考音频或可辨认短句时，声学指纹本身不能凭空给出整首歌的绝对秒数。 |

当前生产至多运行一个可终止推理任务，不积压旧录音，模型随每次CLI子进程结束释放。启用期间复用模型与较轻的连续声学跟踪仍是后续性能方案，尚未实现。GPU已测推理耗时，但长期显存、功耗、界面响应和游戏干扰仍须测量；CPU降级不无限重试。模型识别、声音对齐和播放时钟分别报告状态，不能把“引擎就绪”写成“同步成功”。

重复副歌不得通过靠近 Spotify 秒数来消除歧义；两个重叠窗口也不能当作两份独立证据。转场时应重新判断当前主唱属于哪首歌，旧歌录音不能校正新歌。音频只在本机处理，日常环形缓冲不落盘；现有实验临时文件的清理规则见下文。音源当前为全部系统输出，Spotify 进程单独捕获尚待实现。

## 实录结果和推广门槛

2026年10月8日，在緑黄色社会《これからのこと、それからのこと》上完成一次有上限的重播对照，前12秒与重播后36秒中的同一声音匹配成功，两半独立匹配一致。相同声音对应的媒体时间差约42毫秒；这次未复现大幅漂移。跳转后不一定取消 Spotify 转场，因此这一结果不能证明任一时间轴与原始录音、LRC 或真实起唱时间一致，也不构成全局偏移修正。测试最后恢复了原本预计的同曲进度。

2026年10月8日同一12秒实录的历史CPU测试：large-v3-turbo Q5 的 beam1 用时10.4秒，仅输出2个字符；beam5 用时9.7秒，得到部分接近原文的日语，但首尾截断且有错字，未满足完整歌词和时间证据要求。base beam5 用时1.2秒，错字更多，同样拒绝。30秒 turbo beam5 测试超过15秒预算后终止。单次用时不是稳定基准，也不能由字符数推断准确率。模型 SHA1 与官方文件清单一致，不能把失败归因于已证实的模型损坏。

2026年10月18日同两段12秒录音的CUDA/DTW基准：turbo beam5分别3.593秒、1.500秒，base分别4.829秒、0.943秒；base部分转写更差，并非小模型必然更快或更准确。另一次2026年10月19日副屏打包测试完成五次12秒采音和本地响应，单次约1.6–3.2秒，五次均因证据不足而没有锁定。这些数据证明实测过GPU及运行链路，不能证明歌词已同步。

2026年10月19日本地发音回放覆盖31转写、6歌词源，24种不同WAV按已知裁剪合并后为23来源组。直接匹配4点、组合发音后6点，新增两点来自同一音频，仅增加一个独立行首；直接零点变发音成功的情况仍为零。155原始交叉负例，去同音频后120对、再合并已知裁剪后115对均无误收，真实三块时钟回放仍未锁定。报告保存在忽略目录`.qa-asr/phonetic-corpus-0440/`；原始及生产`parseLrc`过滤credits后的规范化来源哈希均保留。

2026年10月19日Kotoba本地基准包含六段独立音频及另一个已知3秒裁剪对照，报告在`.qa-asr/kotoba-benchmark-1019/summary.json`。六段耗时约1.196–1.342秒，得到两个满足当前生产文字门槛的点，**都在同一段早期录音**，30个跨歌负例零误收；中段和末段仍无可用行首。裁剪对照七个共同token最大差280毫秒，不是独立证据或真实起唱误差。未证明三段独立录音锁定，因而保留为隔离实验、不接入生产。模型537819875字节，SHA256`4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658`。

后续样本仍须覆盖未转场、变速转场、两首重叠、间奏、重复副歌、错误歌词源和缺段。分开统计定位覆盖率、误接管率、起唱误差、首次锁定延迟、推理耗时与资源峰值。研究验收可使用人工标注起唱误差，但日常用户不需要逐句点击校准或提供参考音频。P95小于300毫秒、测试集中零错误接管是尚待达到的初步门槛；拒绝定位不算同步成功。

## Why another clock

Spotify's own lyric cursor and media position can disagree with audible singing after custom transitions. Copying that position cannot establish correctness. The new path searches the entire current original lyric using independently recognized words. It does not use Spotify's seconds to choose between repeated choruses.

System output → fresh 12-second mono/16 kHz block → local whisper.cpp child with bounded real audio context → model-specific DTW token estimates → whole-lyric text/pronunciation landmarks → at least three independent capture blocks over 20 seconds → short-lived lyric-only anchor.

Spotify remains responsible for song identity, pause/seek invalidation and transport controls. An accepted audio anchor bypasses Spotify Mix mapping; it never changes the actual playback position or issues playback commands.

## Implementation and safety

- `electron/audio-sync/local-asr.ts`: one child at a time, 4 threads, 15-second inference budget including at most one GPU→CPU retry; no shell, ffmpeg dependency, network or lyric prompt. Model paths are selected through native dialogs and persisted separately. Existing local runtime/model locations are discoverable on this machine; binaries/models are NOT bundled or downloaded automatically. Fast inference may retain at most 12 seconds of actual preceding PCM in memory; only onsets belonging to the fresh capture contribute new clock evidence. Inference taking more than 6 seconds does not retain context for the next task.
- Temporary WAV and token JSON live in a unique subdirectory of `os temp/syllable-local-asr`; removed in `finally`. Abrupt process/OS termination may leave files. The app does not upload recordings or use the microphone. It captures all system output, not exclusively Spotify.
- `lyric-aligner.ts` parses model-specific DTW points; `lyric-landmarks.ts` searches for unique original-line starts rather than requiring two complete lines in each short clip. DTW is an approximate token output moment, not certified sung onset; its inferred end is explicitly an upper bound. Segment-only timestamps and uniform word-time interpolation do not establish precise line onset. Whole-song competition rejects repeated or near-identical alternatives without choosing whichever is closest to Spotify's absolute position.
- `phonetic-landmarks.ts` is a bounded Japanese fallback when direct matching found fewer than two points and has not already found ambiguity. Source readings are cached. It shares the single romanizer dictionary queue, releases the roughly 300 MB temporary dictionary after work, and uses an AbortSignal limit of at most 6 seconds within the overall 15-second processing budget. Unknown Han readings, low-probability onset words and whole-song homophone/near-homophone ambiguity remain rejected; extra spelling equivalence does not lower clock evidence requirements.
- `onset-clock.ts` is the production vocal clock; the earlier two-block `LyricClock` path is historical. It requires at least three independent non-overlapping capture blocks, three ordered different lyric lines and 20 seconds between actual observed onsets. Each onset wall time is capture-end minus PCM duration plus its heard offset; inference latency never becomes a new observation. History is limited to 72 seconds/seven blocks, inter-block gaps above 36 seconds reset evidence, fitted rate is 0.85–1.15 and maximum residual 300 ms. Every independent block pair has one median-slope vote; no rate-1 endpoints or Spotify absolute seconds are invented to fill missing evidence.
- A locked anchor's uncertainty determines holdover, capped at 48 seconds from the latest actual heard point, not inference completion. Missing words may preserve an unexpired anchor without renewing it; ambiguity, timing conflicts, pause, seek, song/source replacement and expiry revoke it. Expired evidence must establish three blocks again. `diagnosticReason` distinguishes insufficient baseline, expired evidence and inconsistent timing, while the UI keeps held evidence separate from a new match.
- `vocal-sync.ts`: current-track ownership, serialized observations, lyric-version hashing, stale-result and cancellation guards. Pause, seek, track change, renderer failure and quit invalidate evidence.
- `acoustic-controller.ts`: lazy capture, no concurrent fingerprint/ASR jobs and no queue of old recordings. Automatic opt-in is persisted; once enabled, track changes, pause/resume, seek, original-source changes and suspended AudioContext recovery invalidate old evidence and reacquire fresh capture automatically. No per-song restart or per-line user click is required. Errors use bounded backoff; missing engine/denied permission waits for explicit re-enabling rather than repeatedly asking. Default opt-in remains off; a user's saved enabled setting can resume after launch.

## Current limitations / next validation

### 0.4.41 phoneme-frame experiment (not connected to playback)

The ignored local RomajiASR experiment exposes the original ONNX ArgMax input
as an extra output, verifies exact ID equivalence and preserves frame logits.
`ctc-tokens.ts` decodes these bounded frames without conflating CTC emission
peaks with Whisper DTW or sung-word onset. On the tested no-padding frontend,
stride320/receptive-field400 samples at16k gives599 frames for12seconds;
timestamps are not obtained by uniformly dividing the recording duration.
Unknown/special winning labels or malformed tensors reject the observation.
Repeated labels separated by blank remain distinct and a multi-frame run keeps
its weakest posterior. No CTC result presently drives the production clock.

Six initial clips, one dependent crop and14 historical coffee captures have
been tested locally. The provisional spelling/phoneme matcher still produced
no independent clock lock, despite some improved recognized phrases. Numeric
readings, phoneme tokenization, posterior calibration, repeated-source
competition and actual onset error remain required work. The independent
TypeScript decoder matched21 saved tensor outputs numerically; that is export
correctness, not proof of audible lyric synchronization.

The same investigation reproduced a separate production romaji defect:
converting dictionary chunks such as 待っ / て separately dropped small-tsu
before joining. Readings are now joined before romanization. Generated-cache
revision changes do not invalidate provider originals/translations or overwrite
explicit user romaji edits.

Packaged live check on 2026-09-25 (secondary monitor, Byoushinwo Kamu): the full
capture/child/IPC/UI path ran and returned `insufficient-words`; no lock was
claimed. Observed child working set approximately733MB. Stop removed the child
and temporary files; Spotify returned to paused. This is evidence of a working
experimental pipeline and safe abstention, NOT evidence of synchronization accuracy.

- Recognition of Japanese singing is not proven by synthetic alignment tests. Whisper token probabilities are not calibrated confidence in lyric synchronization. Singing, accompaniment, repeated choruses, spelling/kanji differences and inaccurate LRC onsets can all force abstention.
- A 12-second sample plus inference cannot provide immediate first-word lock; the three-block/20-second baseline adds acquisition time. CLI model startup and the temporary Japanese dictionary have substantial transient memory cost. Default opt-in is OFF, model processes release after each job, and a previously saved automatic opt-in may resume on app start. Resident-model reuse and long-term resource acceptance remain unfinished.
- If there is no reliable match, keep the existing media clock and state that calibration failed. Do not claim this fallback is audibly correct.
- No song-specific magic offsets. No automatic retention of inferred offsets across recordings/transitions.
- Real vocal runs must measure false acceptance and audible onset error across held-out songs and custom transitions before promoting this path out of experimental mode.

Whisper CLI token JSON / arguments were checked against the [official v1.9.2 CLI source](https://github.com/ggml-org/whisper.cpp/blob/v1.9.2/examples/cli/cli.cpp). The timing estimates still require real-song validation.
