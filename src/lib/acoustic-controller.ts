import { useAppStore } from '../store/useAppStore'
import type { AcousticMatch } from '../../electron/audio-sync/fingerprint'

export interface AcousticUiState {
  mode: 'reference' | 'vocal'; referenceName: string; trackId: string; running: boolean; busy: boolean
  message: string; score?: number; rate?: number
  // Summary only; never retain audio, transcript or lyric text in UI history.
  lastResult?: { message: string; elapsedMs: number; decision: 'locked' | 'confirming' | 'rejected' }
}
let state: AcousticUiState = { mode: 'vocal', referenceName: '', trackId: '', running: false, busy: false, message: '未启用。可用本地人声识别匹配原文，无需整首参考音频。' }
const listeners = new Set<() => void>()
let worker: Worker | null = null
let sequence = 0
let generation = 0
let capturing = false
let stream: MediaStream | null = null
let context: AudioContext | null = null
let processor: AudioWorkletNode | null = null
let unsubscribe: (() => void) | null = null
let requestPending: { id: number; resolve(value: unknown): void; reject(error: Error): void; timer: number } | null = null
const update = (patch: Partial<AcousticUiState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }

function work(type: 'reference' | 'query', pcm: Float32Array, sampleRate: number) {
  if (requestPending) return Promise.reject(new Error('音频分析仍在进行'))
  if (!worker) {
    worker = new Worker(new URL('./acoustic-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = event => {
      if (!requestPending || event.data.id !== requestPending.id) return
      const pending = requestPending; requestPending = null
      window.clearTimeout(pending.timer)
      if (event.data.error) pending.reject(new Error(event.data.error))
      else pending.resolve(event.data.value)
    }
    worker.onerror = () => { const pending = requestPending; destroyWorker(); pending?.reject(new Error('音频分析进程异常')) }
  }
  const id = ++sequence
  return new Promise<unknown>((resolve, reject) => {
    const timer = window.setTimeout(() => { destroyWorker(); reject(new Error('音频分析超时，请缩短参考文件')) }, 15000)
    requestPending = { id, resolve, reject, timer }
    worker!.postMessage({ id, type, pcm, sampleRate }, [pcm.buffer])
  })
}

function destroyWorker() {
  worker?.terminate(); worker = null
  if (requestPending) { window.clearTimeout(requestPending.timer); requestPending.reject(new Error('音频分析已取消')); requestPending = null }
}

async function stop(message = '已停止音频校准，恢复媒体时间轴。') {
  const token = ++generation
  capturing = false
  processor?.disconnect(); processor = null
  stream?.getTracks().forEach(track => track.stop()); stream = null
  const old = context; context = null
  // Issue invalidation before yielding; a slow close must not clear a newer session.
  const clear = window.syllable.audioSync.clear().catch(() => {})
  update({ running: false, busy: true, message })
  await Promise.all([old?.close().catch(() => {}), clear])
  if (token === generation) update({ running: false, busy: false, message, score: undefined, rate: undefined })
}

async function loadReference(file: File) {
  await stop()
  destroyWorker()
  const owner = useAppStore.getState().playback?.track
  if (!owner) throw new Error('请先在 Spotify 播放歌曲')
  if (file.size > 60 * 1024 * 1024) throw new Error('实验版参考文件不能超过 60 MB')
  const token = ++generation
  update({ busy: true, referenceName: '', trackId: owner.id, lastResult: undefined, message: '正在本地解码并提取音频特征…' })
  const decoder = new AudioContext({ sampleRate: 8000 })
  try {
    const audio = await decoder.decodeAudioData(await file.arrayBuffer())
    if (audio.duration < 12 || audio.duration > 600) throw new Error('参考音频应为 12 秒至 10 分钟的完整同版本歌曲')
    if (token !== generation) return
    const mono = new Float32Array(audio.length)
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const values = audio.getChannelData(channel)
      for (let i = 0; i < mono.length; i++) mono[i] += values[i] / audio.numberOfChannels
    }
    await work('reference', mono, audio.sampleRate)
    if (token !== generation) return
    if (useAppStore.getState().playback?.track?.id !== owner.id) { destroyWorker(); return }
    update({ referenceName: file.name, busy: false, message: `已绑定「${owner.name}」。参照仅在内存中保留，换歌即清除。` })
  } catch (error) {
    if (token === generation) { destroyWorker(); update({ busy: false, referenceName: '', message: error instanceof Error ? error.message : String(error) }) }
  } finally { await decoder.close() }
}

async function start(mode: 'reference' | 'vocal' = 'reference') {
  if (state.running || state.busy) return
  const store = useAppStore.getState(), playback = store.playback
  if (!playback?.track || !playback.isPlaying) throw new Error('请先播放歌曲')
  const original = store.lyrics?.trackId === playback.track.id ? store.lyrics.tracks.find(track => track.kind === 'original') : undefined
  if (mode === 'reference' && (!worker || !state.referenceName || playback.track.id !== state.trackId)) throw new Error('请导入当前歌曲的参考音频')
  if (mode === 'vocal' && (!original || original.lines.length < 4)) throw new Error('请等待当前歌曲的原文歌词加载完成')
  const token = ++generation
  capturing = true
  update({ mode, trackId: playback.track.id, busy: true, message: '正在连接系统输出音频…', score: undefined, rate: undefined, lastResult: undefined })
  try {
    if (mode === 'vocal' && !(await window.syllable.audioSync.engineStatus()).ready) throw new Error('请先配置本地人声识别引擎')
    if (token !== generation) return
    await window.syllable.audioSync.prepare(mode)
    if (token !== generation) return
    useAppStore.getState().clearSessionCalibration?.()
    const captured = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } })
    if (token !== generation) { captured.getTracks().forEach(track => track.stop()); return }
    stream = captured
    captured.getVideoTracks().forEach(track => track.stop())
    if (!captured.getAudioTracks().length) throw new Error('系统没有返回输出音频')
    captured.getAudioTracks()[0].onended = () => { if (token === generation) void stop('音频捕获已结束。') }
    const audio = new AudioContext({ sampleRate: mode === 'vocal' ? 16000 : 8000 })
    context = audio
    await audio.audioWorklet.addModule(new URL('audio-sync-worklet.js', document.baseURI).href)
    await audio.resume()
    if (token !== generation) { await audio.close().catch(() => {}); return }
    processor = new AudioWorkletNode(audio, 'syllable-audio-capture')
    audio.createMediaStreamSource(captured).connect(processor)
    processor.connect(audio.destination) // Worklet outputs silence, not the captured sound.
    let processing = false
    let resetting = false
    let captureEpoch = 0
    const resetCapture = async () => {
      if (token !== generation || resetting) return
      resetting = true; captureEpoch++
      processor?.port.postMessage({ type: 'reset' })
      update({ busy: true, score: undefined, rate: undefined, message: '声音采集中断，已撤销旧校准；正在重新收集连续声音…' })
      try {
        await window.syllable.audioSync.clear()
        if (token !== generation) return
        await window.syllable.audioSync.prepare(mode)
        if (token !== generation) return
        // Only evidence captured after backend invalidation may confirm anew.
        processor?.port.postMessage({ type: 'reset' })
        update({ busy: false })
      } catch (error) {
        if (token === generation) await stop(`声音采集恢复失败：${error instanceof Error ? error.message : String(error)}`)
      } finally { resetting = false }
    }
    captured.getAudioTracks()[0].onmute = () => { void resetCapture() }
    captured.getAudioTracks()[0].onunmute = () => { void resetCapture() }
    audio.onstatechange = () => { if (token === generation) void resetCapture() }
    processor.port.onmessage = async event => {
      if (token !== generation) return
      // Handle gaps even while inference is busy; its eventual result is stale.
      if (event.data?.type === 'gap') { await resetCapture(); return }
      if (resetting || requestPending || processing) return
      const block = event.data
      if (!(block?.pcm instanceof Float32Array) || !Number.isFinite(block.sampleRate) || block.sampleRate < 8000
        || !Number.isFinite(block.startContextTime) || !Number.isFinite(block.endContextTime)
        || Math.abs((block.endContextTime - block.startContextTime) * block.sampleRate - block.pcm.length) > 2
        || audio.currentTime - block.endContextTime > 1.5 || block.endContextTime > audio.currentTime + .2) {
        await resetCapture(); return
      }
      const epoch = captureEpoch
      // Match completion time is NOT capture time. Preserve the block's end
      // timestamp so slow analysis never shifts lyrics backwards.
      const capturedAtMs = Date.now() - Math.max(0, audio.currentTime - event.data.endContextTime) * 1000
      const captureDurationMs = event.data.pcm.length / event.data.sampleRate * 1000
      const observedTrack = useAppStore.getState().playback?.track?.id
      if (observedTrack !== state.trackId) return
      processing = true
      update({ busy: true, message: mode === 'vocal' ? '正在本地识别人声并搜索整首原文…' : '正在对齐最近 12 秒声音…' })
      try {
        if (mode === 'vocal') {
          const result = await window.syllable.audioSync.vocal({ trackId: observedTrack, capturedAtMs, captureDurationMs,
            sampleRate: event.data.sampleRate, pcm: event.data.pcm,
            language: original!.language === 'ja' ? 'ja' : original!.language === 'en' ? 'en' : original!.language.startsWith('zh') ? 'zh' : 'auto',
            lines: original!.lines.map(line => ({ text: line.text, startMs: line.startMs })) })
          if (token !== generation || epoch !== captureEpoch) return
          const reasons: Record<string, string> = { 'insufficient-words': '未识别到足够可靠的完整歌词', ambiguous: '重复段落无法唯一定位',
            'inconsistent-timing': '识别文字与歌词时间关系不一致', matched: '证据已过期或不连续', inactive: '播放或校准状态已改变',
            'lyrics-changed': '原文已更新', cancelled: '识别已取消', busy: '上一段识别尚未释放', 'invalid-input': '录音参数无效' }
          if (['inactive', 'lyrics-changed', 'cancelled', 'invalid-input'].includes(result.reason)) { await stop(`人声对齐停止：${reasons[result.reason]}`); return }
          const message = result.decision === 'locked'
            ? `已由人声接管歌词时钟（匹配 ${result.linesMatched} 行，识别耗时 ${(result.elapsedMs / 1000).toFixed(1)} 秒；已补偿计算耗时）。`
            : result.decision === 'confirming' ? `已定位 ${result.linesMatched} 行，等待另一段独立人声确认。暂不校正。`
            : `暂不校正：${reasons[result.reason] ?? result.reason}。继续采样。`
          update({ busy: false, score: result.score, rate: result.rate, message,
            lastResult: { message, elapsedMs: result.elapsedMs, decision: result.decision } })
          return
        }
        const result = await work('query', event.data.pcm, event.data.sampleRate) as AcousticMatch
        if (token !== generation || epoch !== captureEpoch) return
        const decision = await window.syllable.audioSync.observation({ ...result, trackId: observedTrack, capturedAtMs, captureDurationMs })
        if (token !== generation || epoch !== captureEpoch) return
        const reasons = { silence: '声音太弱', 'too-short': '音频长度不足', 'low-score': '声音与参照不够相似', ambiguous: '多个段落相似', 'unconfirmed-end': '最近声音已无法确认，可能正在转场或跳转', matched: '本次证据未通过时钟检查' }
        update({ busy: false, score: result.score, rate: result.rate, message: decision === 'locked'
          ? '声音对齐已接管歌词；每 12 秒复核，匹配失败或校准过期则恢复媒体时钟。'
          : decision === 'confirming' ? '已找到位置，等待第二段声音确认（约 12 秒）。'
          : `暂不校正：${reasons[result.reason]}。继续采样。` })
      } catch (error) { if (token === generation && epoch === captureEpoch) await stop(`音频校准停止：${error instanceof Error ? error.message : String(error)}`) }
      finally { processing = false }
    }
    update({ running: true, busy: false, message: mode === 'vocal'
      ? '正在本地识别人声。首次锁定至少需要两段 12 秒录音加识别时间；识别不可靠就不校正。'
      : '正在本地分析系统声音。首次锁定至少需要两段 12 秒录音。' })
  } catch (error) { if (token === generation) await stop(error instanceof Error ? error.message : String(error)) }
}

/** Own the session above page navigation. A pause/seek invalidates capture;
 * changing songs releases the reference so it cannot leak into another track. */
function connect() {
  unsubscribe?.()
  unsubscribe = useAppStore.subscribe((next, previous) => {
    if (next.playback?.track?.id !== previous.playback?.track?.id) {
      if (state.trackId) {
        void stop('歌曲已切换，校准已停止。当前歌可重新启动人声对齐，或导入新参考音频。')
        destroyWorker(); update({ referenceName: '', trackId: '', lastResult: undefined })
      }
    } else if (capturing) {
      if (state.mode === 'vocal' && next.lyrics !== previous.lyrics) {
        const originals = (value: typeof next.lyrics) => value?.tracks.filter(track => track.kind === 'original').map(track => [track.language, track.lines.map(line => [line.startMs, line.text])])
        if (JSON.stringify(originals(next.lyrics)) !== JSON.stringify(originals(previous.lyrics))) { void stop('原文歌词已更新，请重新启动人声对齐。'); return }
      }
      const current = next.playback, prior = previous.playback
      if (!current?.isPlaying) void stop('播放已暂停，音频校准已停止。恢复播放后可重新启动。')
      else if (prior && Math.abs(current.positionMs - prior.positionMs - Math.max(0, current.observedAtMs - prior.observedAtMs)) > 2000) {
        void stop('检测到跳转或媒体时间轴突变，已丢弃跨越跳转的录音。可重新启动校准。')
      }
    }
  })
  return () => { unsubscribe?.(); unsubscribe = null; void stop(); destroyWorker() }
}

export const acousticController = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot: () => state, connect, loadReference, start: () => start('reference'), startVocal: () => start('vocal'), stop
}
