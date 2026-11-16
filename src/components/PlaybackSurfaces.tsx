import type { LyricLine, LyricsDocument, PlaybackSnapshot, SessionCalibration } from '../types'
import { usePosition } from '../hooks/usePosition'
import { displayedLyricPosition } from '../lib/session-calibration'
import { LyricsStage } from './LyricsStage'
import { LyricsEditor } from './LyricsEditor'
import { PlayerBar } from './PlayerBar'
import { recordSurfaceRender } from '../lib/render-probe'
import { useCallback, useMemo, useRef } from 'react'
import { visibleTracks } from '../lib/lyrics'
import { msUntilNextLyricChange, wallDelayMs } from '../lib/lyric-clock'
import { activeAcousticAnchor, progressRefreshMs } from '../lib/clock'

interface ClockProps { playback: PlaybackSnapshot | null; document: LyricsDocument | null; offsetMs: number; sessionCalibration?: SessionCalibration | null }

function useLyricPosition({ playback, document, offsetMs, sessionCalibration }: ClockProps) {
  const position = usePosition(playback, 160)
  return displayedLyricPosition(position, playback, document, offsetMs, sessionCalibration)
}

// Keep high-frequency clock updates below the app shell. Settings, library,
// navigation and title artwork should not render on every progress tick.
export function ClockedLyricsStage(props: ClockProps & { enabled: string[]; romanization: boolean; onRetry?: () => void;
  onHeardLine?: (originalTrackId: string, lineIndex: number) => void; onClearCalibration?: () => void; calibrationLabel?: string
  onSeekLine?: (line: LyricLine) => void; seekLabel?: (line: LyricLine) => string; onSearch?: () => void }) {
  recordSurfaceRender('lyrics')
  // Same line the stage will pick (visibleTracks, original first); wake at its boundaries.
  const tracks = useMemo(() => visibleTracks(props.document, props.enabled, props.romanization), [props.document, props.enabled, props.romanization])
  const base = tracks.find(track => track.kind === 'original') ?? tracks[0]
  const nextDue = (clockMs: number) => base ? wallDelayMs(msUntilNextLyricChange(base.lines,
    displayedLyricPosition(clockMs, props.playback, props.document, props.offsetMs, props.sessionCalibration)), activeAcousticAnchor(props.playback)?.rate) : undefined
  const positionMs = displayedLyricPosition(usePosition(props.playback, 500, nextDue), props.playback, props.document, props.offsetMs, props.sessionCalibration)
  return <LyricsStage document={props.document} positionMs={positionMs} enabled={props.enabled} romanization={props.romanization} onRetry={props.onRetry}
    onHeardLine={props.playback?.isPlaying ? props.onHeardLine : undefined} onClearCalibration={props.onClearCalibration} calibrationLabel={props.calibrationLabel}
    onSeekLine={props.playback?.track ? props.onSeekLine : undefined} seekLabel={props.seekLabel} onSearch={props.onSearch} />
}

export function ClockedPlayerBar({ playback, demoMode }: { playback: PlaybackSnapshot | null; demoMode: boolean }) {
  recordSurfaceRender('player')
  // Redraw when the time text or the bar would change, not every 160 ms: on a
  // four-minute song the bar moves about 3 px a second.
  const barWidth = useRef(0)
  const onTrackWidth = useCallback((width: number) => { barWidth.current = width }, [])
  const durationMs = playback?.track?.durationMs
  const reader = useRef<(() => number) | null>(null)
  const position = usePosition(playback, 1000, positionMs => progressRefreshMs(positionMs, durationMs, barWidth.current), reader)
  const positionNow = useCallback(() => reader.current?.() ?? 0, [])
  return <PlayerBar playback={playback} position={position} positionNow={positionNow} demoMode={demoMode} onTrackWidth={onTrackWidth} />
}

export function ClockedLyricsEditor(props: ClockProps) {
  recordSurfaceRender('editor')
  const positionMs = useLyricPosition(props)
  return <LyricsEditor positionMs={positionMs} />
}
