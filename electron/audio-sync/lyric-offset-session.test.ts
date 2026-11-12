import { describe, expect, it, vi } from 'vitest'
import type { PlaybackSnapshot } from '../../src/types'
import type { VocalCapture } from '../../src/lib/vocal-sync-types'
import type { CtcOutput } from './ctc-tokens'
import { CAPTURE_LATENCY_MS, LyricOffsetSession, phoneLines } from './lyric-offset-session'
import type { JapaneseWord } from '../romanizer'

const VOCABULARY = ['<blank>', 'ka', 'na', 'shi', 'i', 'to', 'mo', 'ru', 'yo']
const SR = 16000

/** CTC output for a capture of `samples` where each listed line is sung at a media time. */
function output(samples: number, startMediaMs: number, sung: Array<{ atMs: number; phones: string[] }>): CtcOutput {
  const width = VOCABULARY.length, frames = Math.floor((samples - 400) / 320) + 1
  const logits = new Float32Array(frames * width)
  for (let f = 0; f < frames; f += 1) { for (let k = 0; k < width; k += 1) logits[f * width + k] = -4; logits[f * width] = 4 }
  for (const line of sung) {
    const first = Math.round(((line.atMs - startMediaMs) / 1000 * SR - 200) / 320)
    line.phones.forEach((phone, index) => {
      for (let f = first + index * 6; f < first + index * 6 + 4 && f < frames; f += 1) if (f >= 0) { logits[f * width + VOCABULARY.indexOf(phone)] = 6; logits[f * width] = 0 }
    })
  }
  return { logits, vocabulary: VOCABULARY, blankId: 0, geometry: { sampleRate: SR, sampleCount: samples, strideSamples: 320, receptiveFieldSamples: 400 } }
}

const words = (text: string): JapaneseWord[] => [{ surface_form: text, reading: text, pronunciation: text }]
const PHRASES: Record<string, string[]> = { かなしい: ['ka', 'na', 'shi', 'i'], ともるよ: ['to', 'mo', 'ru', 'yo'] }
const lines = Array.from({ length: 12 }, (_, index) => ({ text: index % 2 ? 'ともるよ' : 'かなしい', startMs: 20_000 + index * 3000 }))

function setup(offsetMs: number) {
  let now = 1_000_000
  // The file is `offsetMs` early: each line is sung at startMs + offsetMs.
  const engine = {
    recognize: vi.fn(async (pcm: Float32Array) => {
      const startMediaMs = mediaStart
      return output(pcm.length, startMediaMs, lines.map(line => ({ atMs: line.startMs + offsetMs, phones: PHRASES[line.text] })))
    }),
    cancel: vi.fn()
  }
  let mediaStart = 0
  const analyze = vi.fn(async (texts: string[]) => texts.map(words))
  const session = new LyricOffsetSession(engine, analyze, () => now)
  const playback = (positionMs: number, observedAtMs: number, isPlaying = true): PlaybackSnapshot => ({ track: { id: 'song', name: 'x', artist: 'y', album: 'z', coverUrl: '', durationMs: 200_000 }, positionMs, observedAtMs, isPlaying, sampleId: 1, playbackSource: 'local' })
  /** A 12 s block ending at wall time `endWall`, while media position = wall - 1_000_000 + 10_000. */
  const block = (endWall: number): VocalCapture => {
    now = endWall + 100
    // Sample 0 of the analysed PCM (incl. any prepended tail) is set by the session; the fake engine needs it.
    return { trackId: 'song', capturedAtMs: endWall, captureDurationMs: 12_000, sampleRate: SR, pcm: new Float32Array(12 * SR).fill(0.01), language: 'ja', lines }
  }
  const media = (wall: number) => wall - 1_000_000 + 10_000
  return { session, engine, analyze, playback, block, media, setMediaStart: (value: number) => { mediaStart = value }, setNow: (value: number) => { now = value } }
}

describe('LyricOffsetSession', () => {
  it('measures a constant early file across windows and decides an offset', async () => {
    const h = setup(900)
    h.session.start('song')
    h.session.observePlayback(h.playback(10_000, 1_000_000))
    let result
    for (let end = 1_012_000; end <= 1_060_000; end += 12_000) {
      // Contiguous blocks after the first get a 3 s tail prepended.
      const analysedStart = end === 1_012_000 ? end - 12_000 : end - 15_000
      h.setMediaStart(h.media(analysedStart))
      result = await h.session.process(h.block(end))
      if (result.state === "decided") break
    }
    expect(result).toMatchObject({ reason: 'measured', state: 'decided' })
    // The session subtracts the capture latency from the block timestamps.
    expect(Math.abs(result!.measuredDeltaMs! - (900 - CAPTURE_LATENCY_MS))).toBeLessThanOrEqual(30)
    expect(h.analyze).toHaveBeenCalledTimes(1)
    // Contiguous blocks were analysed with the previous block's tail (15 s).
    expect(h.engine.recognize.mock.calls.at(-1)![0].length).toBe(15 * SR)
  })

  it('rejects captures for another track, while paused, or with bad input', async () => {
    const h = setup(0)
    h.session.start('song')
    h.session.observePlayback(h.playback(10_000, 1_000_000))
    expect((await h.session.process({ ...h.block(1_012_000), trackId: 'other' })).reason).toBe('inactive')
    expect((await h.session.process({ ...h.block(1_012_000), language: 'en' })).reason).toBe('unsupported-language')
    expect((await h.session.process({ ...h.block(1_012_000), sampleRate: 8000 })).reason).toBe('invalid-input')
    expect((await h.session.process({ ...h.block(1_012_000), capturedAtMs: 900_000 })).reason).toBe('invalid-input')
    expect((await h.session.process({ ...h.block(1_012_000), pcm: new Float32Array(12 * SR) })).reason).toBe('silence')
    h.session.observePlayback(h.playback(22_000, 1_012_000, false))
    expect((await h.session.process(h.block(1_013_000))).reason).toBe('inactive')
    expect(h.engine.recognize).not.toHaveBeenCalled()
  })

  it('discards a block that spans a seek', async () => {
    const h = setup(0)
    h.session.start('song')
    h.session.observePlayback(h.playback(10_000, 1_000_000))
    h.setNow(1_006_000)
    h.session.observePlayback(h.playback(90_000, 1_006_000))
    expect((await h.session.process(h.block(1_012_000))).reason).toBe('seeked')
    h.setMediaStart(h.media(1_012_000) + 80_000 - 6_000)
    expect((await h.session.process(h.block(1_024_000))).reason).toBe('measured')
  })

  it('starts over when the lyric timing changes mid-song', async () => {
    const h = setup(0)
    h.session.start('song')
    h.session.observePlayback(h.playback(10_000, 1_000_000))
    h.setMediaStart(h.media(1_000_000))
    await h.session.process(h.block(1_012_000))
    const moved = { ...h.block(1_024_000), lines: lines.map(line => ({ ...line, startMs: line.startMs + 500 })) }
    expect((await h.session.process(moved)).reason).toBe('lyrics-changed')
  })
})

describe('phoneLines', () => {
  it('keeps the supported prefix of each line and skips lines without one', () => {
    const result = phoneLines([
      { text: 'かなしい', startMs: 1000 },
      { text: 'LOVE かなしい', startMs: 2000 },
      { text: 'かなしい 2人', startMs: 3000 },
    ], [
      words('かなしい'),
      [{ surface_form: 'LOVE' }, { surface_form: ' ' }, { surface_form: 'かなしい', reading: 'カナシイ', pronunciation: 'カナシイ' }],
      [{ surface_form: 'かなしい', reading: 'カナシイ', pronunciation: 'カナシイ' }, { surface_form: ' ' }, { surface_form: '2' }, { surface_form: '人', reading: 'ニン', pronunciation: 'ニン' }],
    ])
    expect(result).toEqual([
      { index: 0, startMs: 1000, phones: ['ka', 'na', 'shi', 'i'] },
      { index: 2, startMs: 3000, phones: ['ka', 'na', 'shi', 'i'] },
    ])
  })
})
