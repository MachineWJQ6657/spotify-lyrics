import { lyricTimingKey } from '../../src/lib/lyric-timing-key'
import type { PlaybackSnapshot } from '../../src/types'
import type { VocalCapture, VocalResult } from '../../src/lib/vocal-sync-types'
import { extractLyricLandmarks } from './lyric-landmarks'
import { OnsetClock } from './onset-clock'
import type { LocalAsr } from './local-asr'
import type { HeardToken } from './lyric-aligner'
import { captureQuality } from './capture-quality'
import { analyzeJapaneseLines, type JapaneseWord } from '../romanizer'
import { extractPhoneticLandmarks } from './phonetic-landmarks'

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
  private readings: { key: string; words: JapaneseWord[][] } | null = null
  private readingAbort: AbortController | null = null
  private playback: PlaybackSnapshot | null = null
  constructor(readonly recognizer: LocalAsr, private analyzeJapanese = analyzeJapaneseLines) {}
  start(trackId: string) { this.clear(); this.owner = trackId }
  clear() {
    this.owner = ''; this.lyricKey = ''; this.lastCapture = 0; this.context = null; this.readings = null
    this.readingAbort?.abort(); this.readingAbort = null
    this.clock.clear(); this.recognizer.cancel()
  }
  observePlayback(snapshot: PlaybackSnapshot | null) {
    const revision = this.clock.revision
    this.clock.observePlayback(snapshot)
    if (revision !== this.clock.revision) {
      this.recognizer.cancel(); this.owner = ''; this.lyricKey = ''; this.lastCapture = 0; this.context = null; this.readings = null
      this.readingAbort?.abort(); this.readingAbort = null
    }
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
      let match = extractLyricLandmarks(tokens, value.lines, value.captureDurationMs)
      let matching: 'text' | 'pronunciation' | 'combined' = 'text'
      let phoneticElapsedMs = 0
      // Supplement a sparse literal observation; existing text evidence is
      // never deleted simply to manufacture a successful pronunciation test.
      // Explicit ambiguity cannot be bypassed with a different spelling.
      const heardText = tokens.map(token => token.text).join('')
      const supported = tokens.filter(token => token.timing === 'dtw' && token.endIsUpperBound
        && token.probability >= .5 && token.startMs >= 150 && token.startMs <= value.captureDurationMs - 350)
      const timingSupported = new Set(supported.map(token => token.startMs)).size >= 3
        && supported.at(-1)!.startMs - supported[0].startMs >= 500
      const remainingMs = 15_000 - (Date.now() - started)
      if (value.language === 'ja' && match.reason !== 'ambiguous' && match.points.length < 2 && timingSupported
        && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(heardText)
        && remainingMs >= 1000 && heardText.length <= 800 && value.lines.length < 400
        && value.lines.reduce((sum, line) => sum + line.text.length, heardText.length) <= 16000) {
        const phoneticStarted = Date.now(), abort = new AbortController()
        this.readingAbort = abort
        const timeout = setTimeout(() => abort.abort(), Math.min(6000, remainingMs - 100))
        try {
          const cached = this.readings?.key === key ? this.readings.words : null
          const words = await this.analyzeJapanese(cached ? [heardText] : [heardText, ...value.lines.map(line => line.text)], { signal: abort.signal })
          if (revision !== this.clock.revision || value.trackId !== this.owner || key !== this.lyricKey) return rejected('cancelled')
          if (!abort.signal.aborted) {
            const sourceWords = cached ?? words.slice(1)
            if (sourceWords.length === value.lines.length && Array.isArray(words[0])) {
              this.readings = { key, words: sourceWords }
              const phonetic = extractPhoneticLandmarks(tokens, value.lines, value.captureDurationMs, words[0], sourceWords)
              if (phonetic.reason === 'ambiguous') {
                match = phonetic
                matching = 'pronunciation'
              } else if (phonetic.points.length) {
                const byLine = new Map(match.points.map(point => [point.lineIndex, point]))
                let conflict = false
                for (const point of phonetic.points) {
                  const literal = byLine.get(point.lineIndex)
                  if (literal && Math.abs(literal.heardMs - point.heardMs) > 150) conflict = true
                  else if (!literal) byLine.set(point.lineIndex, point)
                }
                const points = [...byLine.values()].sort((left, right) => left.lineIndex - right.lineIndex)
                if (points.some((point, index) => index > 0 && (point.heardMs - points[index - 1].heardMs < 150
                  || point.sourceMs <= points[index - 1].sourceMs))) conflict = true
                matching = match.points.length ? 'combined' : 'pronunciation'
                match = conflict ? { reason: 'ambiguous', points: [] } : { reason: 'matched', points }
              }
            }
          }
        } catch {
          // Dictionary analysis is an optional bounded fallback. A failure
          // supplies no new position; it must not terminate audio sampling.
          if (revision !== this.clock.revision || value.trackId !== this.owner) return rejected('cancelled')
        } finally {
          clearTimeout(timeout)
          if (this.readingAbort === abort) this.readingAbort = null
          phoneticElapsedMs = Date.now() - phoneticStarted
        }
      }
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
        rate: anchor?.rate ?? 1, matching, phoneticElapsedMs, clockReason: this.clock.decisionReason,
        ...(calibration ? { calibration } : {}) }
    } catch (error) {
      if (revision === this.clock.revision) this.clear()
      throw error
    } finally { this.pending = false }
  }
}
