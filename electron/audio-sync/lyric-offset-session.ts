import type { PlaybackSnapshot } from '../../src/types'
import type { VocalCapture } from '../../src/lib/vocal-sync-types'
import { lyricTimingKey } from '../../src/lib/lyric-timing-key'
import { captureQuality } from './capture-quality'
import type { CtcOutput } from './ctc-tokens'
import { mapJapanesePhones } from './japanese-phonemes'
import { LyricOffsetEstimator, measureWindow, type OffsetDecision, type PhoneLine } from './lyric-offset'
import type { JapaneseWord } from '../romanizer'

interface Engine {
  recognize(pcm: Float32Array, options?: { signal?: AbortSignal }): Promise<CtcOutput>
  cancel(): void
}
type Analyzer = (lines: string[], options?: { signal?: AbortSignal }) => Promise<JapaneseWord[][]>

/** Loopback capture reaches the renderer this long after the sound was played.
 * Measured 2026-11-12 against an independent WASAPI loopback recorder on the
 * same playback: in-app minus offline was 93 and 105 ms, of which ~50-58 ms
 * is SMTC running ahead of the audio (kept: the display uses SMTC too). */
export const CAPTURE_LATENCY_MS = 45
/** Keep this much of the previous block so lines crossing a boundary are still whole. */
const OVERLAP_SAMPLES = 3 * 16000
const MAX_SAMPLES = 15 * 16000

export interface ListenResult extends OffsetDecision {
  reason: 'measured' | 'busy' | 'inactive' | 'invalid-input' | 'unsupported-language' | 'silence' | 'audio-gaps' | 'no-lines' | 'cancelled' | 'lyrics-changed' | 'seeked'
  trackId: string
  timingKey: string
  windowLines: number
  elapsedMs: number
}

/** Leading supported phones of each line. An unsupported word (Latin, digits)
 * ends the usable prefix: what follows cannot be placed without it. */
export function phoneLines(lines: VocalCapture['lines'], words: JapaneseWord[][]): PhoneLine[] {
  const out: PhoneLine[] = []
  lines.forEach((line, index) => {
    const mapping = mapJapanesePhones(line.text, words[index] ?? [])
    if (mapping.reason === 'invalid-input' || mapping.reason === 'surface-mismatch') return
    const phones: string[] = []
    for (const word of mapping.words) {
      if (word.status === 'punctuation') continue
      if (word.status !== 'supported') break
      for (const phone of mapping.phones.slice(word.phoneStart, word.phoneEnd)) phones.push(phone.phone)
    }
    if (phones.length >= 3) out.push({ index, startMs: line.startMs, phones })
  })
  return out
}

/**
 * Listens to a few windows of the current song and estimates how far its lyric
 * file is from what is sung. Media position comes from the transport clock
 * (SMTC matches the audio within ~65 ms); only display timing is affected.
 */
export class LyricOffsetSession {
  private owner = ''
  private key = ''
  private phones: PhoneLine[] | null = null
  private estimator = new LyricOffsetEstimator()
  private playback: PlaybackSnapshot | null = null
  private tail: { pcm: Float32Array; endAtMs: number } | null = null
  private discontinuityAt = 0
  private pending = false
  private revision = 0
  private abort: AbortController | null = null

  constructor(private engine: Engine, private analyze: Analyzer, private now = () => Date.now()) {}

  start(trackId: string) { this.clear(); this.owner = trackId }
  clear() {
    this.revision += 1
    this.owner = ''; this.key = ''; this.phones = null; this.tail = null
    this.estimator = new LyricOffsetEstimator()
    this.abort?.abort(); this.abort = null
    this.engine.cancel()
  }
  observePlayback(next: PlaybackSnapshot | null) {
    const before = this.playback
    this.playback = next
    if (!this.owner) return
    if (!next?.isPlaying || next.track?.id !== this.owner) { this.clear(); return }
    // A seek invalidates the rolling tail (not the evidence: lines keep their file times).
    if (before?.isPlaying && before.track?.id === next.track?.id
      && [next.positionMs, next.observedAtMs, before.positionMs, before.observedAtMs].every(Number.isFinite)
      && Math.abs(next.positionMs - before.positionMs - Math.max(0, next.observedAtMs - before.observedAtMs)) > 1500) {
      this.tail = null
      this.discontinuityAt = this.now()
    }
  }

  /** Media position at a wall-clock time, from the latest transport observation. */
  private mediaAt(wallMs: number) {
    const playback = this.playback
    if (!playback?.isPlaying || !Number.isFinite(playback.positionMs) || !Number.isFinite(playback.observedAtMs)) return null
    return playback.positionMs + (wallMs - playback.observedAtMs)
  }

  async process(value: VocalCapture): Promise<ListenResult> {
    const started = this.now()
    const result = (reason: ListenResult['reason'], decision: OffsetDecision = this.estimator.decision(), windowLines = 0): ListenResult =>
      ({ ...decision, reason, trackId: value?.trackId ?? '', timingKey: this.key, windowLines, elapsedMs: this.now() - started })
    if (this.pending) return result('busy')
    if (!this.owner || value?.trackId !== this.owner || this.playback?.track?.id !== this.owner || !this.playback?.isPlaying) return result('inactive')
    if (value.language !== 'ja') return result('unsupported-language')
    if (value.sampleRate !== 16000 || !(value.pcm instanceof Float32Array) || value.pcm.length < 96000 || value.pcm.length > 240000
      || !Number.isFinite(value.capturedAtMs) || value.capturedAtMs > started + 200 || started - value.capturedAtMs > 3000
      || !Number.isFinite(value.captureDurationMs) || Math.abs(value.captureDurationMs - value.pcm.length / 16) > 1
      || !Array.isArray(value.lines) || value.lines.length < 2 || value.lines.length > 400
      || value.lines.some((line, i) => !line || typeof line.text !== 'string' || line.text.length > 500 || !Number.isFinite(line.startMs)
        || line.startMs < 0 || (i > 0 && line.startMs < value.lines[i - 1].startMs))) return result('invalid-input')
    const key = lyricTimingKey(value.lines)
    if (!key) return result('invalid-input')
    if (this.key && this.key !== key) { const owner = this.owner; this.clear(); this.owner = owner; return result('lyrics-changed') }
    this.key = key
    const quality = captureQuality(value.pcm)
    const captureStartWall = value.capturedAtMs - value.captureDurationMs - CAPTURE_LATENCY_MS
    // Contiguous with the previous block: prepend its tail for boundary lines.
    let pcm = value.pcm, startWall = captureStartWall
    if (this.tail && Math.abs(this.tail.endAtMs - (value.capturedAtMs - value.captureDurationMs)) <= 40) {
      const keep = Math.min(this.tail.pcm.length, OVERLAP_SAMPLES, MAX_SAMPLES - value.pcm.length)
      if (keep > 0) {
        pcm = new Float32Array(keep + value.pcm.length)
        pcm.set(this.tail.pcm.subarray(this.tail.pcm.length - keep)); pcm.set(value.pcm, keep)
        startWall -= keep / 16
      }
    }
    this.tail = { pcm: value.pcm.slice(Math.max(0, value.pcm.length - OVERLAP_SAMPLES)), endAtMs: value.capturedAtMs }
    if (quality !== 'usable') return result(quality)
    // Audio from before a seek cannot be placed with the clock observed after it.
    if (this.discontinuityAt && this.discontinuityAt >= startWall - 500) return result('seeked')
    const startMediaMs = this.mediaAt(startWall)
    if (startMediaMs == null || startMediaMs < 0) return result('inactive')
    this.pending = true
    const revision = this.revision, abort = new AbortController()
    this.abort = abort
    const timeout = setTimeout(() => abort.abort(), 15000)
    const current = () => !abort.signal.aborted && revision === this.revision && this.owner === value.trackId
    try {
      if (!this.phones) {
        const words = await this.analyze(value.lines.map(line => line.text), { signal: abort.signal })
        if (!current()) return result('cancelled')
        if (words.length !== value.lines.length) return result('invalid-input')
        this.phones = phoneLines(value.lines, words)
      }
      if (this.phones.length < 4) return result('no-lines')
      const output = await this.engine.recognize(pcm, { signal: abort.signal })
      if (!current()) return result('cancelled')
      const deltas = measureWindow(output, this.phones, { startMediaMs, sampleRate: 16000,
        strideSamples: output.geometry.strideSamples, receptiveFieldSamples: output.geometry.receptiveFieldSamples },
      { expectedOffsetMs: this.estimator.center })
      const decision = this.estimator.add(deltas)
      return result('measured', decision, deltas.length)
    } catch (error) {
      if (!current()) return result('cancelled')
      throw error
    } finally {
      clearTimeout(timeout)
      if (this.abort === abort) this.abort = null
      this.pending = false
    }
  }
}
