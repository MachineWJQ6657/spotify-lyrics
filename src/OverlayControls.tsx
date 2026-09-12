import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical, Lock, MousePointer2, Pause, Play, SkipBack, SkipForward, Unlock, X } from 'lucide-react'
import { useAppStore } from './store/useAppStore'
import { useWindowSync } from './hooks/useWindowSync'
import { usePlaybackConnection } from './hooks/usePlayback'
import { BrandMark } from './components/BrandMark'

export function OverlayControls() {
  usePlaybackConnection(false, false)
  useWindowSync(false)
  const { settings, playback, patchSettings, setPlayback } = useAppStore()
  const [transportPending, setTransportPending] = useState(false)
  const [pendingSkipTrackId, setPendingSkipTrackId] = useState<string | null>(null)
  const transportPendingRef = useRef(false)
  const pendingReleaseTimer = useRef<number | undefined>(undefined)
  const dragPointer = useRef<{ id: number; startX: number; startY: number; active: boolean } | null>(null)
  useEffect(() => {
    // Spotify briefly publishes no media session between queue items. Keep the
    // skip lock through that gap and release it only after a real replacement
    // track arrives, otherwise a pointer bounce can issue another next command.
    if (pendingSkipTrackId && playback?.track?.id && playback.track.id !== pendingSkipTrackId) {
      if (pendingReleaseTimer.current != null) window.clearTimeout(pendingReleaseTimer.current)
      pendingReleaseTimer.current = undefined
      setPendingSkipTrackId(null)
    }
  }, [pendingSkipTrackId, playback?.track?.id])
  useEffect(() => () => {
    if (pendingReleaseTimer.current != null) window.clearTimeout(pendingReleaseTimer.current)
  }, [])
  const sendTransport = async (command: 'play' | 'pause' | 'next' | 'previous') => {
    if (transportPendingRef.current || pendingSkipTrackId || !playback) return
    transportPendingRef.current = true
    setTransportPending(true)
    try {
      const result = await window.syllable.playback.command(command)
      if (result.action === 'seek-to-zero') {
        const current = useAppStore.getState().playback
        const sourceTrackId = playback.track?.id
        if (sourceTrackId && current?.track?.id === sourceTrackId) setPlayback({ ...current, positionMs: 0, observedAtMs: Date.now() })
      }
      if ((command === 'next' || command === 'previous') && result.accepted && result.pending && playback.track?.id) {
        setPendingSkipTrackId(playback.track?.id ?? null)
        if (pendingReleaseTimer.current != null) window.clearTimeout(pendingReleaseTimer.current)
        pendingReleaseTimer.current = window.setTimeout(() => {
          pendingReleaseTimer.current = undefined
          setPendingSkipTrackId(current => current === playback.track?.id ? null : current)
        }, 6500)
      }
    } catch {
      setPendingSkipTrackId(null)
    } finally {
      transportPendingRef.current = false
      setTransportPending(false)
    }
  }
  const toggleClickThrough = () => {
    const next = !settings.clickThrough
    patchSettings({ clickThrough: next })
    void window.syllable.overlay.setClickThrough(next)
  }
  const togglePositionLock = () => {
    const next = !settings.positionLocked
    patchSettings({ positionLocked: next, ...(!next ? { clickThrough: false } : {}) })
    void window.syllable.overlay.setMovable(!next)
  }
  const close = () => {
    patchSettings({ overlayVisible: false })
    void window.syllable.overlay.hide()
  }
  const beginDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (settings.positionLocked || event.button !== 0) return
    dragPointer.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, active: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const continueDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragPointer.current
    if (!drag || drag.id !== event.pointerId) return
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      drag.active = true
      window.syllable.overlay.beginMove()
    }
    window.syllable.overlay.moveTo(event.screenX, event.screenY)
  }
  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragPointer.current
    if (!drag || drag.id !== event.pointerId) return
    dragPointer.current = null
    if (drag.active) window.syllable.overlay.endMove()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div className={`overlay-controls-shell ${settings.positionLocked ? 'position-locked' : ''}`} onPointerEnter={() => window.syllable.overlay.setControlsHover(true)} onPointerLeave={() => window.syllable.overlay.setControlsHover(false)}>
    <span className="controls-drag" title={settings.positionLocked ? '位置已锁定' : '拖动悬浮窗'} onPointerDown={beginDrag} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><GripVertical size={15} /></span>
    <button type="button" title="上一首（播放超过 3 秒时先回到开头）" aria-label="上一首" disabled={transportPending || Boolean(pendingSkipTrackId)} onClick={() => void sendTransport('previous')}><SkipBack size={15} fill="currentColor" /></button>
    <button type="button" className="controls-play" title={playback?.isPlaying ? '暂停' : '播放'} aria-label={playback?.isPlaying ? '暂停' : '播放'} disabled={transportPending || Boolean(pendingSkipTrackId)} onClick={() => void sendTransport(playback?.isPlaying ? 'pause' : 'play')}>{playback?.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
    <button type="button" title={pendingSkipTrackId ? '正在等待 Spotify 换曲…' : '下一首'} aria-label="下一首" disabled={transportPending || Boolean(pendingSkipTrackId)} onClick={() => void sendTransport('next')}><SkipForward size={15} fill="currentColor" /></button>
    <button type="button" title={settings.clickThrough ? '关闭歌词区域穿透' : '开启歌词区域穿透'} aria-label="切换歌词区域穿透" aria-pressed={settings.clickThrough} onClick={toggleClickThrough}><MousePointer2 size={15} /></button>
    <button type="button" title={settings.positionLocked ? '解锁位置' : '锁定位置'} aria-label={settings.positionLocked ? '解锁悬浮窗位置' : '锁定悬浮窗位置'} aria-pressed={settings.positionLocked} onClick={togglePositionLock}>{settings.positionLocked ? <Lock size={15} /> : <Unlock size={15} />}</button>
    <button type="button" className="controls-open" title="打开 Syllable 客户端（Ctrl+Alt+S）" aria-label="打开 Syllable 客户端" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void window.syllable.window.show() }}><BrandMark size={17} /></button>
    <button type="button" title="关闭桌面歌词" aria-label="关闭桌面歌词" onClick={close}><X size={16} /></button>
  </div>
}
