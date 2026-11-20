import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { acousticController } from '../lib/acoustic-controller'
import { useAppStore } from '../store/useAppStore'
import { t } from '../lib/i18n'

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
  return <section className="info-note audio-sync-panel" aria-label={t('声音同步实验')}>
    <h2>{t('声音同步')} <small>{t('实验功能')}</small></h2>
    <p>{t('本地人声对齐会自动识别歌声，校对歌词位置和推进速度。开启一次后记住设置，自动跟随换歌、暂停恢复和跳转，无需逐句操作。')}</p>
    <p>{t('分析的是电脑正在播放的声音，每次约 12 秒。')}</p>
    <p>{engine?.message ?? t('正在检查本地识别引擎…')} {engine?.ready ? engine.modelName : ''}</p>
    <p>{t('音素校验用于诊断日语歌曲：不依赖歌词识别歌声，与自动声音同步二选一。')}{phoneme?.message}</p>
    <div className="audio-sync-actions">
      <button disabled={state.busy || state.running} onClick={() => void run(async () => { const value = await window.syllable.audioSync.configureEngine(); if (value) setEngine(value) })}>{t('配置本地引擎')}</button>
      <button disabled={!engine?.ready || state.automatic || state.busy || state.running} onClick={() => void run(acousticController.startVocal)}>{t('开启自动声音同步')}</button>
      <button disabled={!phoneme?.available || state.automatic || state.busy || state.running} onClick={() => void run(acousticController.startPhoneme)}>{t('开启音素校验')}</button>
      <button disabled={!state.automatic && !state.running && !state.busy} onClick={() => void run(() => acousticController.stop())}>{t('关闭声音同步')}</button>
    </div>
    <input ref={input} type="file" accept="audio/*,.flac,.wav,.mp3,.m4a,.ogg" hidden onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void run(() => acousticController.loadReference(file))
    }} />
    <div className="audio-sync-actions">
      <button disabled={state.busy || state.running || !playback?.track} onClick={() => input.current?.click()}>{t('导入参考音频')}</button>
      <button disabled={!state.referenceName || !playback?.isPlaying || state.busy || state.running} onClick={() => void run(acousticController.start)}>{t('用参考音频校准')}</button>
    </div>
    {state.referenceName && <p>{t('当前参照：{name}', { name: state.referenceName })}</p>}
    <p role="status">{error || t(state.message)}</p>
    {state.lastResult && (state.busy || !state.running) && <p className="audio-sync-last-result">{t('上次分析（{seconds} 秒）：{message}', { seconds: (state.lastResult.elapsedMs / 1000).toFixed(1), message: state.lastResult.message })}</p>}
    {state.score != null && <p>{t('相似度 {score}', { score: state.score.toFixed(3) })}{state.rate != null && <> · {t('估计速度 {rate}×', { rate: state.rate.toFixed(3) })}</>}</p>}
    <p>{t('需要听到至少三段、跨越 20 秒以上的歌声后才会接管同步；暂停后恢复播放会重新定位。')}</p>
  </section>
}
