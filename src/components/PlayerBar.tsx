import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Laptop2, LoaderCircle, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import type { PlaybackSnapshot } from '../types'
import { formatTime } from '../lib/clock'
import { useAppStore } from '../store/useAppStore'
import { hasKana, scriptPresentation } from '../lib/script'
import { BrandMark } from './BrandMark'

export function PlayerBar({ playback, position, demoMode }: { playback: PlaybackSnapshot | null; position: number; demoMode: boolean }) {
  const track = playback?.track
  const title = track?.name ?? ''
  const artist = track?.artist ?? ''
  const japaneseContext = [title, artist, track?.album ?? ''].find(hasKana) ?? ''
  const originalLanguage = useAppStore(state => state.lyrics?.trackId === track?.id
    ? state.lyrics?.tracks.find(item => item.kind === 'original')?.language
    : undefined)
  const titlePresentation = scriptPresentation(title, japaneseContext, originalLanguage)
  const artistPresentation = scriptPresentation(artist, japaneseContext, originalLanguage)
  const duration = track?.durationMs ?? 1
  const [busy, setBusy] = useState(false)
  const [pendingSkipTrackId, setPendingSkipTrackId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const commandLockUntil = useRef(0)
  const pendingReleaseTimer = useRef<number | undefined>(undefined)
  const setPlayback = useAppStore(state => state.setPlayback)

  useEffect(() => {
    if (!pendingSkipTrackId || !track?.id || track.id === pendingSkipTrackId) return
    if (pendingReleaseTimer.current != null) window.clearTimeout(pendingReleaseTimer.current)
    pendingReleaseTimer.current = undefined
    setPendingSkipTrackId(null)
  }, [pendingSkipTrackId, track?.id])
  useEffect(() => () => {
    if (pendingReleaseTimer.current != null) window.clearTimeout(pendingReleaseTimer.current)
  }, [])

  const command = async (value: 'play' | 'pause' | 'next' | 'previous') => {
    const now = Date.now()
    if (!playback || busy || pendingSkipTrackId || now < commandLockUntil.current) return
    commandLockUntil.current = now + (value === 'next' || value === 'previous' ? 900 : 350)
    setError(''); setBusy(true)
    let optimisticObservedAt: number | undefined
    if (value === 'play' || value === 'pause') {
      const nextPlaying = value === 'play'
      optimisticObservedAt = Date.now()
      setPlayback({ ...playback, positionMs: position, observedAtMs: optimisticObservedAt, isPlaying: nextPlaying })
    }
    try {
      if (!demoMode) {
        const result = await window.syllable.playback.command(value)
        if (!result.accepted && optimisticObservedAt != null) {
          const current = useAppStore.getState().playback
          const sourceTrackId = playback.track?.id
          if (sourceTrackId && current?.track?.id === sourceTrackId && current.observedAtMs === optimisticObservedAt) setPlayback(playback)
        }
        if (result.action === 'seek-to-zero') {
          const current = useAppStore.getState().playback
          const sourceTrackId = playback.track?.id
          if (sourceTrackId && current?.track?.id === sourceTrackId) setPlayback({ ...current, positionMs: 0, observedAtMs: Date.now() })
        }
        if ((value === 'next' || value === 'previous') && result.accepted && result.pending && playback.track?.id) {
          setPendingSkipTrackId(playback.track.id)
          if (pendingReleaseTimer.current != null) window.clearTimeout(pendingReleaseTimer.current)
          pendingReleaseTimer.current = window.setTimeout(() => {
            pendingReleaseTimer.current = undefined
            setPendingSkipTrackId(current => current === playback.track?.id ? null : current)
          }, 6500)
        }
      }
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      const current = useAppStore.getState().playback
      const sourceTrackId = playback.track?.id
      if (optimisticObservedAt != null && sourceTrackId && current?.track?.id === sourceTrackId && current.observedAtMs === optimisticObservedAt) setPlayback(playback)
    }
    finally { setBusy(false) }
  }
  const seek = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!playback?.track) return
    const rect = event.currentTarget.getBoundingClientRect()
    const target = Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration))
    setPlayback({ ...playback, positionMs: target, observedAtMs: Date.now() })
    try { if (!demoMode) await window.syllable.playback.seek(target) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <footer className="player-bar">
    <div className="track-mini">
      <div className="mini-cover">{track?.coverUrl ? <img src={track.coverUrl} /> : <BrandMark size={34} title="Syllable" />}</div>
      <div><strong {...titlePresentation}>{track?.name ?? '等待播放'}</strong><span {...artistPresentation}>{track?.artist ?? 'Spotify'}</span></div>
    </div>
    <div className="transport">
      <div className="transport-buttons"><button disabled={busy || Boolean(pendingSkipTrackId)} title="上一首（播放超过 3 秒时先回到开头）" onClick={() => void command('previous')}><SkipBack size={17} /></button><button disabled={busy || Boolean(pendingSkipTrackId)} title={playback?.isPlaying ? '暂停' : '播放'} className="play-button" onClick={() => void command(playback?.isPlaying ? 'pause' : 'play')}>{busy ? <LoaderCircle className="spin-icon" size={16} /> : playback?.isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button disabled={busy || Boolean(pendingSkipTrackId)} title={pendingSkipTrackId ? '正在等待 Spotify 换曲…' : '下一首'} onClick={() => void command('next')}><SkipForward size={17} /></button></div>
      <div className={`progress-row ${pendingSkipTrackId ? 'transport-pending' : ''}`}><span>{formatTime(position)}</span><div className="progress-track" onClick={event => { if (!pendingSkipTrackId) void seek(event) }}><i style={{ width: `${Math.min(100, position / duration * 100)}%` }} /></div><span>{formatTime(duration)}</span></div>
      {error && <div className="player-error"><AlertTriangle size={10} />{error}</div>}
    </div>
    <div className="device"><Laptop2 size={16} /><span>{playback?.deviceName ?? 'Spotify Connect'}</span><Volume2 size={16} /></div>
  </footer>
}
