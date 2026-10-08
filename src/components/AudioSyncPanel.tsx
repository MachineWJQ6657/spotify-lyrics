import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { acousticController } from '../lib/acoustic-controller'
import { useAppStore } from '../store/useAppStore'

export function AudioSyncPanel() {
  const state = useSyncExternalStore(acousticController.subscribe, acousticController.snapshot)
  const playback = useAppStore(store => store.playback)
  const [error, setError] = useState('')
  const [engine, setEngine] = useState<{ ready: boolean; modelName: string; message: string } | null>(null)
  useEffect(() => { let active = true; void window.syllable.audioSync.engineStatus().then(value => { if (active) setEngine(value) }).catch(() => {}); return () => { active = false } }, [])
  const input = useRef<HTMLInputElement>(null)
  const run = async (operation: () => Promise<void>) => {
    setError('')
    try { await operation() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <section className="info-note audio-sync-panel" aria-label="声音同步实验">
    <h2>声音同步 <small>实验功能</small></h2>
    <p>本地人声对齐：识别听到的文字，搜索整首原文，建立独立于 Spotify 进度的歌词时钟。无需整首参考音频；准确性仍在验证中，默认关闭。</p>
    <p>读取系统输出（包括其他应用声音），不使用麦克风、不上传。人声识别临时保存 12 秒 WAV，任务结束后删除；只运行一个识别进程，4 线程、15 秒限时。异常退出可能留下临时文件。</p>
    <p>{engine?.message ?? '正在检查本地识别引擎…'} {engine?.ready ? engine.modelName : ''}</p>
    <div className="audio-sync-actions">
      <button disabled={state.busy || state.running} onClick={() => void run(async () => { const value = await window.syllable.audioSync.configureEngine(); if (value) setEngine(value) })}>配置本地引擎</button>
      <button disabled={!engine?.ready || !playback?.isPlaying || state.busy || state.running} onClick={() => void run(acousticController.startVocal)}>开始人声对齐</button>
      <button disabled={!state.running && !state.busy} onClick={() => void run(() => acousticController.stop())}>停止</button>
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
    {state.score != null && <p>相似度 {state.score.toFixed(3)} · 估计速度 {state.rate?.toFixed(3)}×（实验判据，不代表准确率）</p>}
    <p>连续两段独立录音、至少四行完整原文吻合才接管人声同步；计算耗时不计入歌词偏移。重复副歌、伴奏、强混音、缺失或错误原文可能无法锁定，失败或过期回退媒体时钟。暂停、跳转、切歌会停止捕获。</p>
  </section>
}
