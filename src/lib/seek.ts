import { useAppStore } from '../store/useAppStore'

/**
 * Spotify position at which a lyric line starts on screen. Lyrics show
 * `position - offset` (calibratedPosition), so the line at `lineStartMs`
 * begins at `lineStartMs + offset`. Session calibrations and audio anchors
 * end at a seek, so only the per-song offset applies afterwards.
 */
export function lyricSeekTarget(lineStartMs: number, offsetMs: number, durationMs: number | undefined) {
  const target = Math.max(0, Math.round(lineStartMs + offsetMs))
  return durationMs && durationMs > 0 ? Math.min(target, Math.max(0, durationMs - 1000)) : target
}

/** Seek Spotify, moving the local clock at once so the lyrics follow without waiting for a sample. */
export async function seekPlayback(positionMs: number) {
  const { playback, demoMode, setPlayback } = useAppStore.getState()
  if (!playback?.track) return
  const duration = playback.track.durationMs
  const target = Math.max(0, Math.min(duration > 0 ? duration : positionMs, positionMs))
  setPlayback({ ...playback, positionMs: target, observedAtMs: Date.now() })
  if (!demoMode) await window.syllable.playback.seek(target)
}

/** Keys typed into a field, or handled by a focused control, are not shortcuts. */
export function isShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return true
  if (element.isContentEditable) return false
  return !element.closest('input, textarea, select, button, a[href], [role="slider"], [contenteditable="true"]')
}
