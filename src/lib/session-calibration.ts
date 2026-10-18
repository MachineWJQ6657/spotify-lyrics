import type { LyricsDocument, LyricTrack, PlaybackSnapshot, SessionCalibration } from '../types'
import { activeAcousticAnchor, calibratedPosition, lyricPlaybackPosition, TransportClock } from './clock'
import { lyricTimingKey } from './lyric-timing-key'

const keys = new WeakMap<LyricTrack, string>()
const timingKeys = new WeakMap<LyricTrack, string>()
export function originalTimingKey(document: LyricsDocument | null): string {
  const original = document?.tracks.find(track => track.kind === 'original')
  if (!original || document?.untimedOriginal) return ''
  const cached = keys.get(original)
  if (cached) return cached
  // Exact identity avoids carrying calibration to edited or replacement lyrics.
  // Memoized per immutable track, so progress ticks do not serialize lyrics.
  const key = JSON.stringify([original.id, original.language, original.source, original.lines.map(line => [line.startMs, line.text])])
  keys.set(original, key)
  return key
}

export function currentSessionCalibration(value: SessionCalibration | null | undefined, playback: PlaybackSnapshot | null, document: LyricsDocument | null) {
  return value && playback?.isPlaying && value.trackId === playback.track?.id && document?.trackId === value.trackId
    && Number.isFinite(value.offsetMs) && Math.abs(value.offsetMs) <= 120000
    && value.originalKey === originalTimingKey(document) ? value : null
}

export function createSessionCalibration(playback: PlaybackSnapshot | null, document: LyricsDocument | null, originalTrackId: string, lineIndex: number, now = Date.now()): SessionCalibration {
  if (!playback?.isPlaying || !playback.track || document?.trackId !== playback.track.id || document.untimedOriginal) throw new Error('请在当前歌曲播放时校准')
  if (!Number.isFinite(now) || !Number.isFinite(playback.observedAtMs) || !Number.isFinite(playback.positionMs)
    || now - playback.observedAtMs > 6500 || now < playback.observedAtMs - 200) throw new Error('播放采样已过期，请稍候重试')
  const original = document.tracks.find(track => track.kind === 'original' && track.id === originalTrackId)
  const line = Number.isInteger(lineIndex) ? original?.lines[lineIndex] : undefined
  if (!line?.text.trim() || !Number.isFinite(line.startMs)) throw new Error('请选择当前原文中的一句')
  const clock = new TransportClock(); clock.update(playback)
  const offsetMs = Math.round(clock.position(now) - line.startMs)
  if (Math.abs(offsetMs) > 120000) throw new Error('相差超过两分钟，请确认选择的是当前段落')
  return { trackId: document.trackId, originalKey: originalTimingKey(document), offsetMs, createdAtMs: now }
}

export function continuesCalibration(before: PlaybackSnapshot | null, next: PlaybackSnapshot | null) {
  if (!before?.isPlaying || !next?.isPlaying || !next.track || next.track.id !== before.track?.id) return false
  if (![next.positionMs, before.positionMs, next.observedAtMs, before.observedAtMs].every(Number.isFinite)) return false
  return Math.abs(next.positionMs - before.positionMs - Math.max(0, next.observedAtMs - before.observedAtMs)) <= 2000
}

/** Manual session calibration overrides, never adds to, automatic/persisted offsets. */
export function displayedLyricPosition(positionMs: number, playback: PlaybackSnapshot | null, document: LyricsDocument | null,
  offsetMs: number, session: SessionCalibration | null | undefined, now = Date.now()) {
  const manual = currentSessionCalibration(session, playback, document)
  if (manual) return calibratedPosition(positionMs, manual.offsetMs)
  const anchor = activeAcousticAnchor(playback, now)
  if (anchor?.coordinate === 'lyrics') {
    const original = document?.tracks.find(track => track.kind === 'original')
    let key = original ? timingKeys.get(original) : ''
    if (original && key === undefined) { key = lyricTimingKey(original.lines); timingKeys.set(original, key) }
    if (!document?.untimedOriginal && document?.trackId === playback?.track?.id && key && key === anchor.lyricTimingKey) {
      // This anchor was fitted directly to these line timestamps. Applying an
      // old per-song offset here a second time undoes the audible correction.
      return lyricPlaybackPosition(positionMs, playback, document?.sourceDurationMs, now)
    }
    return calibratedPosition(positionMs, offsetMs)
  }
  return calibratedPosition(lyricPlaybackPosition(positionMs, playback, document?.sourceDurationMs, now), offsetMs)
}
