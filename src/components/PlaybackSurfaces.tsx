import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { usePosition } from '../hooks/usePosition'
import { calibratedPosition, lyricSourcePosition } from '../lib/clock'
import { LyricsStage } from './LyricsStage'
import { LyricsEditor } from './LyricsEditor'
import { PlayerBar } from './PlayerBar'

interface ClockProps { playback: PlaybackSnapshot | null; document: LyricsDocument | null; offsetMs: number }

function useLyricPosition({ playback, document, offsetMs }: ClockProps) {
  const position = usePosition(playback, 160)
  return calibratedPosition(lyricSourcePosition(position, playback?.track?.durationMs, document?.sourceDurationMs, playback?.transition), offsetMs)
}

// Keep high-frequency clock updates below the app shell. Settings, library,
// navigation and title artwork should not render on every progress tick.
export function ClockedLyricsStage(props: ClockProps & { enabled: string[]; romanization: boolean; onRetry?: () => void }) {
  const positionMs = useLyricPosition(props)
  return <LyricsStage document={props.document} positionMs={positionMs} enabled={props.enabled} romanization={props.romanization} onRetry={props.onRetry} />
}

export function ClockedPlayerBar({ playback, demoMode }: { playback: PlaybackSnapshot | null; demoMode: boolean }) {
  const position = usePosition(playback, 160)
  return <PlayerBar playback={playback} position={position} demoMode={demoMode} />
}

export function ClockedLyricsEditor(props: ClockProps) {
  const positionMs = useLyricPosition(props)
  return <LyricsEditor positionMs={positionMs} />
}
