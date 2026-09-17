import { useRef, useState, useSyncExternalStore } from 'react'
import { acousticController } from '../lib/acoustic-controller'
import { useAppStore } from '../store/useAppStore'

export function AudioSyncPanel() {
  const state = useSyncExternalStore(acousticController.subscribe, acousticController.snapshot)
  const playback = useAppStore(store => store.playback)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const run = async (operation: () => Promise<void>) => {
    setError('')
    try { await operation() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <section className="info-note audio-sync-panel" aria-label="声音同步实验">
    <h2>声音同步 <small>实验功能</small></h2>
    <p>用真实声音寻找歌曲位置。先导入从头开始的同版本完整音频；不会自动下载歌曲。当前阶段不支持无参照校准。</p>
    <p>启用后读取系统输出（包括其他应用声音），不使用麦克风；不上传、不保存录音，只在内存处理。其他应用的声音可能导致匹配失败。</p>
    <input ref={input} type="file" accept="audio/*,.flac,.wav,.mp3,.m4a,.ogg" hidden onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void run(() => acousticController.loadReference(file))
    }} />
    <div className="audio-sync-actions">
      <button disabled={state.busy || state.running || !playback?.track} onClick={() => input.current?.click()}>导入参考音频</button>
      <button disabled={!state.referenceName || !playback?.isPlaying || state.busy || state.running} onClick={() => void run(acousticController.start)}>开始声音校准</button>
      <button disabled={!state.running && !state.busy} onClick={() => void run(() => acousticController.stop())}>停止</button>
    </div>
    {state.referenceName && <p>当前参照：{state.referenceName}</p>}
    <p role="status">{error || state.message}</p>
    {state.score != null && <p>相似度 {state.score.toFixed(3)} · 估计速度 {state.rate?.toFixed(3)}×（实验判据，不代表准确率）</p>}
    <p>两段声音都可靠且位置一致才接管歌词。重复副歌、强烈混音或变速可能暂时无法锁定；暂停或切歌会停止捕获。</p>
  </section>
}
