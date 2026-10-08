import type { PlaybackSnapshot } from '../src/types'
import { lyricPlaybackPosition, spotifySourcePosition } from '../src/lib/clock'

interface Sample {
  receivedAtMs: number
  observedAtMs: number | null
  title: string
  artist: string
  source: string
  positionMs: number | null
  recordingPositionMs: number | null
  hypotheticalRecipePositionMs: number | null
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
      recordingPositionMs: playback ? lyricPlaybackPosition(playback.positionMs, playback, undefined, playback.observedAtMs) : null,
      hypotheticalRecipePositionMs: playback?.transition ? spotifySourcePosition(playback.positionMs, playback.transition) : null,
      playing: playback?.isPlaying ?? false, durationMs: playback?.track?.durationMs ?? null,
      transitionResolved: playback?.transitionResolved ?? null, hasTransition: Boolean(playback?.transition),
      clockDriftMs: playback?.clockDriftMs ?? null })
    if (this.samples.length > 180) this.samples.shift()
  }
  clear() { this.samples = [] }
  report() { return { schemaVersion: 2, generatedAtMs: Date.now(),
    note: 'Media time and Spotify lyrics may BOTH differ from audible vocals after transitions. Clock drift is not measured audio/lyric synchronization error. Hypothetical recipe positions are diagnostic only and never applied automatically. Lyric context estimates position, not a captured screen. No audio is recorded by this exporter.',
    samples: this.samples.map(sample => ({ ...sample })) } }
}
