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
    <p>分析的是电脑正在播放的声音，每次约 12 秒。</p>
    <p>{engine?.message ?? '正在检查本地识别引擎…'} {engine?.ready ? engine.modelName : ''}</p>
    <p>音素校验用于诊断日语歌曲：不依赖歌词识别歌声，与自动声音同步二选一。{phoneme?.message}</p>
    <div className="audio-sync-actions">
      <button disabled={state.busy || state.running} onClick={() => void run(async () => { const value = await window.syllable.audioSync.configureEngine(); if (value) setEngine(value) })}>配置本地引擎</button>
      <button disabled={!engine?.ready || state.automatic || state.busy || state.running} onClick={() => void run(acousticController.startVocal)}>开启自动声音同步</button>
      <button disabled={!phoneme?.available || state.automatic || state.busy || state.running} onClick={() => void run(acousticController.startPhoneme)}>开启音素校验</button>
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
    {state.lastResult && (state.busy || !state.running) && <p className="audio-sync-last-result">上次分析（{(state.lastResult.elapsedMs / 1000).toFixed(1)} 秒）：{state.lastResult.message}</p>}
    {state.score != null && <p>相似度 {state.score.toFixed(3)}{state.rate != null && <> · 估计速度 {state.rate.toFixed(3)}×</>}</p>}
    <p>需要听到至少三段、跨越 20 秒以上的歌声后才会接管同步；暂停后恢复播放会重新定位。</p>
  </section>
}
