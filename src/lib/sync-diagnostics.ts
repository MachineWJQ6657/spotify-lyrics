import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { calibratedPosition, lyricPlaybackPosition, TransportClock } from './clock'
import { activeLineIndex } from './lyrics'

export interface LyricDiagnosticContext {
  capturedAtMs: number
  matchesPlayback: boolean
  offsetMs: number
  sourceDurationMs: number | null
  providerRevision: number | null
  estimatedLyricPositionMs: number
  tracks: Array<{ language: string; kind: string; source: string; lineCount: number; firstMs: number | null; lastMs: number | null; estimatedActiveIndex: number }>
}

/** Export timing/selection evidence, never text, IDs, artwork or the library. */
export function lyricDiagnosticContext(playback: PlaybackSnapshot | null, lyrics: LyricsDocument | null, fallbackOffsetMs = 0, now = Date.now()): LyricDiagnosticContext {
  const matchesPlayback = Boolean(playback?.track && lyrics?.trackId === playback.track.id)
  const document = matchesPlayback ? lyrics : null
  const clock = new TransportClock()
  clock.update(playback)
  const offsetMs = document?.offsetMs ?? fallbackOffsetMs
  const position = calibratedPosition(lyricPlaybackPosition(clock.position(now), playback, document?.sourceDurationMs, now), offsetMs)
  return { capturedAtMs: now, matchesPlayback, offsetMs, sourceDurationMs: document?.sourceDurationMs ?? null,
    providerRevision: document?.providerRevision ?? null, estimatedLyricPositionMs: position,
    tracks: (document?.tracks ?? []).slice(0, 16).map(track => ({ language: track.language.slice(0, 40), kind: track.kind,
      source: track.source.slice(0, 200), lineCount: track.lines.length, firstMs: track.lines[0]?.startMs ?? null,
      lastMs: track.lines.at(-1)?.startMs ?? null, estimatedActiveIndex: activeLineIndex(track.lines, position) })) }
}

/** The preload boundary does not grant renderer input arbitrary report fields. */
export function sanitizeLyricDiagnosticContext(input: unknown): LyricDiagnosticContext | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const number = (item: unknown, fallback = 0) => typeof item === 'number' && Number.isFinite(item) ? item : fallback
  const optionalNumber = (item: unknown) => typeof item === 'number' && Number.isFinite(item) ? item : null
  const text = (item: unknown, size: number) => typeof item === 'string' ? item.slice(0, size) : ''
  return { capturedAtMs: number(value.capturedAtMs), matchesPlayback: value.matchesPlayback === true,
    offsetMs: number(value.offsetMs), sourceDurationMs: optionalNumber(value.sourceDurationMs), providerRevision: optionalNumber(value.providerRevision),
    estimatedLyricPositionMs: number(value.estimatedLyricPositionMs),
    tracks: (Array.isArray(value.tracks) ? value.tracks : []).slice(0, 16).flatMap(item => {
      if (!item || typeof item !== 'object') return []
      return [{ language: text(item.language, 40), kind: text(item.kind, 40), source: text(item.source, 200),
        lineCount: number(item.lineCount), firstMs: optionalNumber(item.firstMs), lastMs: optionalNumber(item.lastMs), estimatedActiveIndex: number(item.estimatedActiveIndex, -1) }]
    }) }
}
