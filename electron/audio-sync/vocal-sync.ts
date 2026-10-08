import { createHash } from 'node:crypto'
import type { PlaybackSnapshot } from '../../src/types'
import type { VocalCapture, VocalResult } from '../../src/lib/vocal-sync-types'
import { alignHeardLyrics } from './lyric-aligner'
import { LyricClock } from './lyric-clock'
import type { LocalAsr } from './local-asr'

export class VocalSync {
  readonly clock = new LyricClock()
  private owner = ''
  private lyricKey = ''
  private lastCapture = 0
  private pending = false
  private playback: PlaybackSnapshot | null = null
  constructor(readonly recognizer: LocalAsr) {}
  start(trackId: string) { this.clear(); this.owner = trackId }
  clear() { this.owner = ''; this.lyricKey = ''; this.lastCapture = 0; this.clock.clear(); this.recognizer.cancel() }
  observePlayback(snapshot: PlaybackSnapshot | null) {
    const revision = this.clock.revision
    this.clock.observePlayback(snapshot)
    if (revision !== this.clock.revision) { this.recognizer.cancel(); this.owner = ''; this.lyricKey = ''; this.lastCapture = 0 }
    this.playback = snapshot
  }
  async process(value: VocalCapture): Promise<VocalResult> {
    const started = Date.now()
    const rejected = (reason: string): VocalResult => ({ decision: 'rejected', reason, linesMatched: 0, elapsedMs: Date.now() - started, score: 0, rate: 1 })
    if (this.pending) return rejected('busy')
    if (!value || !this.owner || value.trackId !== this.owner || value.trackId !== this.playback?.track?.id || !this.playback.isPlaying) return rejected('inactive')
    if (value.sampleRate !== 16000 || !(value.pcm instanceof Float32Array) || value.pcm.length < 96000 || value.pcm.length > 240000
      || !Number.isFinite(value.captureDurationMs) || Math.abs(value.captureDurationMs - value.pcm.length / 16) > 1
      || !Number.isFinite(value.capturedAtMs) || value.capturedAtMs <= this.lastCapture
      || started - value.capturedAtMs > 1500 || value.capturedAtMs > started + 200
      || !Array.isArray(value.lines) || value.lines.length < 2 || value.lines.length > 400
      || value.lines.some((line, index) => !line || typeof line.text !== 'string' || line.text.length > 500
        || !Number.isFinite(line.startMs) || line.startMs < 0 || line.startMs > 600000
        || (index > 0 && line.startMs < value.lines[index - 1].startMs))
      || value.lines.reduce((sum, line) => sum + line.text.length, 0) > 16000) return rejected('invalid-input')
    const key = createHash('sha256').update(JSON.stringify(value.lines.map(line => [line.startMs, line.text]))).digest('hex')
    if (this.lyricKey && this.lyricKey !== key) { this.clear(); return rejected('lyrics-changed') }
    this.lyricKey = key; this.lastCapture = value.capturedAtMs
    this.pending = true
    const revision = this.clock.revision
    try {
      const tokens = await this.recognizer.recognize(value.pcm, value.language)
      if (revision !== this.clock.revision || value.trackId !== this.owner) return rejected('cancelled')
      const match = alignHeardLyrics(tokens, value.lines, value.captureDurationMs)
      const decision = this.clock.accept({ ...match, trackId: value.trackId, capturedAtMs: value.capturedAtMs, captureDurationMs: value.captureDurationMs })
      return { decision, reason: match.reason, linesMatched: match.lineIndices.length, elapsedMs: Date.now() - started, score: match.score, rate: match.rate }
    } catch (error) {
      if (revision === this.clock.revision) this.clear()
      throw error
    } finally { this.pending = false }
  }
}
