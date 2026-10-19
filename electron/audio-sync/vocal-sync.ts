import { lyricTimingKey } from '../../src/lib/lyric-timing-key'
import type { PlaybackSnapshot } from '../../src/types'
import type { VocalCapture, VocalResult } from '../../src/lib/vocal-sync-types'
import { extractLyricLandmarks } from './lyric-landmarks'
import { OnsetClock } from './onset-clock'
import type { LocalAsr } from './local-asr'
import type { HeardToken } from './lyric-aligner'
import { captureQuality } from './capture-quality'

interface AudioContextBlock {
  pcm: Float32Array
  capturedAtMs: number
  trackId: string
  lyricKey: string
  revision: number
  language: string
}

export class VocalSync {
  readonly clock = new OnsetClock()
  private owner = ''
  private lyricKey = ''
  private lastCapture = 0
  private pending = false
  private context: AudioContextBlock | null = null
  private playback: PlaybackSnapshot | null = null
  constructor(readonly recognizer: LocalAsr) {}
  start(trackId: string) { this.clear(); this.owner = trackId }
  clear() { this.owner = ''; this.lyricKey = ''; this.lastCapture = 0; this.context = null; this.clock.clear(); this.recognizer.cancel() }
  observePlayback(snapshot: PlaybackSnapshot | null) {
    const revision = this.clock.revision
    this.clock.observePlayback(snapshot)
    if (revision !== this.clock.revision) { this.recognizer.cancel(); this.owner = ''; this.lyricKey = ''; this.lastCapture = 0; this.context = null }
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
      || value.lines.reduce((sum, line) => sum + line.text.length, 0) > 16000) { this.context = null; return rejected('invalid-input') }
    const key = lyricTimingKey(value.lines)
    if (this.lyricKey && this.lyricKey !== key) { this.clear(); return rejected('lyrics-changed') }
    this.lyricKey = key; this.lastCapture = value.capturedAtMs
    this.pending = true
    const revision = this.clock.revision
    try {
      const usable = captureQuality(value.pcm) === 'usable'
      const previous = this.context
      // Consume the buffer once. Errors, gaps, slow engines and cancellation
      // must not leave stale audio available to a later recognition call.
      this.context = null
      const continuous = usable && previous && previous.trackId === value.trackId && previous.lyricKey === key
        && previous.revision === revision && previous.language === value.language
        && Math.abs(value.capturedAtMs - value.captureDurationMs - previous.capturedAtMs) <= 50
      const contextSamples = continuous ? previous.pcm.length : 0
      const contextMs = contextSamples / 16
      let input = value.pcm
      if (continuous) {
        input = new Float32Array(contextSamples + value.pcm.length)
        input.set(previous.pcm); input.set(value.pcm, contextSamples)
      }
      const recognitionStarted = Date.now()
      const recognized = await this.recognizer.recognize(input, value.language)
      if (revision !== this.clock.revision || value.trackId !== this.owner) return rejected('cancelled')
      // Keep at most 12 s of real PCM, in memory only. CPU or otherwise slow
      // engines stay on fresh blocks instead of doubling their next workload.
      if (usable && Date.now() - recognitionStarted <= 6000) this.context = {
        pcm: value.pcm.slice(-192000), capturedAtMs: value.capturedAtMs,
        trackId: value.trackId, lyricKey: key, revision, language: value.language,
      }
      // Earlier audio supplies recognizer context, never another clock vote.
      // A token starting before this capture is discarded even if it extends
      // into it; its onset belongs to the previous observation.
      const tokens: HeardToken[] = contextSamples ? recognized.filter(token => token.startMs >= contextMs
        && token.startMs < contextMs + value.captureDurationMs).map(token => ({ ...token,
        startMs: token.startMs - contextMs,
        endMs: Math.min(token.endMs, contextMs + value.captureDurationMs) - contextMs,
      })) : recognized
      const match = extractLyricLandmarks(tokens, value.lines, value.captureDurationMs)
      const decision = this.clock.accept({ ...match, lyricTimingKey: key, trackId: value.trackId, capturedAtMs: value.capturedAtMs, captureDurationMs: value.captureDurationMs })
      const now = Date.now()
      // Inspect this clock only, never an anchor carried by an input snapshot.
      const candidate = this.clock.decorate<PlaybackSnapshot>(this.playback ? { ...this.playback, acousticAnchor: undefined } : null, now)?.acousticAnchor
      const anchor = candidate?.trackId === value.trackId && candidate.coordinate === 'lyrics' && candidate.lyricTimingKey === key
        && now >= candidate.observedAtMs && now < candidate.expiresAtMs ? candidate : undefined
      const calibration = anchor && (decision === 'locked' || match.reason === 'insufficient-words')
        ? { state: decision === 'locked' ? 'updated' as const : 'holding' as const,
          positionMs: anchor.sourcePositionMs + (now - anchor.observedAtMs) * anchor.rate, expiresAtMs: anchor.expiresAtMs } : undefined
      return { decision, reason: match.reason, linesMatched: match.points.length, elapsedMs: Date.now() - started,
        score: anchor?.score ?? (match.points.length ? Math.min(...match.points.map(point => point.score)) : 0),
        rate: anchor?.rate ?? 1, ...(calibration ? { calibration } : {}) }
    } catch (error) {
      if (revision === this.clock.revision) this.clear()
      throw error
    } finally { this.pending = false }
  }
}
