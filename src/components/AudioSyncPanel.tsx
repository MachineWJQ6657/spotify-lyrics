import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { acousticController } from '../lib/acoustic-controller'
import { useAppStore } from '../store/useAppStore'

export function AudioSyncPanel() {
  const state = useSyncExternalStore(acousticController.subscribe, acousticController.snapshot)
  const playback = useAppStore(store => store.playback)
  const [error, setError] = useState('')
  const [engine, setEngine] = useState<{ ready: boolean; modelName: string; message: string } | null>(null)
  const [phoneme, setPhoneme] = useState<{ available: boolean; message: string } | null>(null)
  useEffect(() => { let active = true; void window.syllable.audioSync.engineStatus().then(value => { if (active) setEngine(value) }).catch(() => {}); return () => { active = false } }, [])
  useEffect(() => { let active = true; void window.syllable.audioSync.phonemeStatus().then(value => { if (active) setPhoneme(value) }).catch(() => {}); return () => { active = false } }, [])
  const input = useRef<HTMLInputElement>(null)
  const run = async (operation: () => Promise<void>) => {
    setError('')
    try { await operation() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <section className="info-note audio-sync-panel" aria-label="声音同步实验">
    <h2>声音同步 <small>实验功能</small></h2>
    <p>本地人声对齐会自动识别歌声，校对歌词位置和推进速度。开启一次后记住设置，自动跟随换歌、暂停恢复和跳转，无需逐句操作。</p>
    <p>读取系统输出（包括其他应用声音），不使用麦克风、不上传。每次分析新增 12 秒声音，较快的引擎会保留上一段作为上下文；临时 WAV 最长 30 秒，任务结束后删除。只运行一个识别进程，4 线程、15 秒限时。异常退出可能留下临时文件。</p>
    <p>{engine?.message ?? '正在检查本地识别引擎…'} {engine?.ready ? engine.modelName : ''}</p>
    <p>日语不同写法可通过读音补充匹配，需要时短暂加载字典并及时释放；漏字、弱起首词和重复段落仍需继续收集声音。</p>
    <p>日语音素校验是独立诊断后端：无歌词提示识别歌声，保留重复句与句中词的竞争解释。它不会接管时间轴，也不代表同步已成功；与人声同步二选一，不同时运行。只用内存 PCM、2 线程、15 秒总限时，空闲自动释放模型。{phoneme?.message}</p>
    <div className="audio-sync-actions">
      <button disabled={state.busy || state.running} onClick={() => void run(async () => { const value = await window.syllable.audioSync.configureEngine(); if (value) setEngine(value) })}>配置本地引擎</button>
      <button disabled={!engine?.ready || state.automatic || state.busy || state.running} onClick={() => void run(acousticController.startVocal)}>开启自动声音同步</button>
      <button disabled={!phoneme?.available || state.automatic || state.busy || state.running} onClick={() => void run(acousticController.startPhoneme)}>开启音素校验（不接管）</button>
      <button disabled={!state.automatic && !state.running && !state.busy} onClick={() => void run(() => acousticController.stop())}>关闭声音同步</button>
    </div>
    <input ref={input} type="file" accept="audio/*,.flac,.wav,.mp3,.m4a,.ogg" hidden onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void run(() => acousticController.loadReference(file))
    }} />
    <div className="audio-sync-actions">
      <button disabled={state.busy || state.running || !playback?.track} onClick={() => input.current?.click()}>导入参考音频</button>
      <button disabled={!state.referenceName || !playback?.isPlaying || state.busy || state.running} onClick={() => void run(acousticController.start)}>用参考音频校准</button>
    </div>
    {state.referenceName && <p>当前参照：{state.referenceName}</p>}
    <p role="status">{error || state.message}</p>
    {state.lastResult && (state.busy || !state.running) && <p className="audio-sync-last-result">上次分析（{(state.lastResult.elapsedMs / 1000).toFixed(1)} 秒）：{state.lastResult.message} 此为历史结果，不表示当前校准仍有效。</p>}
    {state.score != null && <p>相似度 {state.score.toFixed(3)}{state.rate != null && <> · 估计速度 {state.rate.toFixed(3)}×</>}（实验判据，不代表准确率）</p>}
    <p>自动累计至少三段独立声音、跨越至少 20 秒的可靠行首，确认位置和速度后接管同步。重复副歌、伴奏或错误原文可能暂时无法定位，期间会继续尝试并显示媒体进度。暂停会释放声音采集，恢复播放后自动重新定位。</p>
  </section>
}
