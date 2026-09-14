import type { PlaybackSnapshot } from '../src/types'
import { spotifySourcePosition } from '../src/lib/clock'

interface Sample {
  receivedAtMs: number
  observedAtMs: number | null
  title: string
  artist: string
  source: string
  positionMs: number | null
  recordingPositionMs: number | null
  playing: boolean
  durationMs: number | null
  transitionResolved: boolean | null
  hasTransition: boolean
  clockDriftMs: number | null
}

/** Bounded, in-memory transport evidence; never retains tokens, art or lyrics. */
export class PlaybackDiagnostics {
  private samples: Sample[] = []
  record(playback: PlaybackSnapshot | null, receivedAtMs = Date.now()) {
    this.samples.push({ receivedAtMs, observedAtMs: playback?.observedAtMs ?? null,
      title: (playback?.track?.name ?? '').slice(0, 200), artist: (playback?.track?.artist ?? '').slice(0, 200),
      source: playback?.playbackSource ?? 'none', positionMs: playback?.positionMs ?? null,
      recordingPositionMs: playback ? spotifySourcePosition(playback.positionMs, playback.transition) : null,
      playing: playback?.isPlaying ?? false, durationMs: playback?.track?.durationMs ?? null,
      transitionResolved: playback?.transitionResolved ?? null, hasTransition: Boolean(playback?.transition),
      clockDriftMs: playback?.clockDriftMs ?? null })
    if (this.samples.length > 180) this.samples.shift()
  }
  clear() { this.samples = [] }
  report() { return { schemaVersion: 1, generatedAtMs: Date.now(),
    note: 'Clock drift is not measured audio/lyric synchronization error. Lyric context, when present, estimates position from the latest sample, not a captured screen. No audio is recorded.',
    samples: this.samples.map(sample => ({ ...sample })) } }
}
