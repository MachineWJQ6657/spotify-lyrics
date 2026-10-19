import { afterEach, describe, expect, it, vi } from 'vitest'
import { VocalSync } from './vocal-sync'
import type { LocalAsr } from './local-asr'
import type { HeardToken } from './lyric-aligner'
import type { VocalCapture } from '../../src/lib/vocal-sync-types'
import type { PlaybackSnapshot } from '../../src/types'
import { lyricTimingKey } from '../../src/lib/lyric-timing-key'

const lines = ['あおぞらを見ながら歩いていた', 'みどりの道をゆっくり進んだ', 'あたらしい窓を開いてみよう']
  .map((text, i) => ({ text, startMs: 61000 + i * 4000 }))
const heard: HeardToken[] = lines.flatMap((line, i) => [...line.text].map((text, j) => ({ text, startMs: 1000 + i * 4000 + j * 120,
  endMs: 1100 + i * 4000 + j * 120, probability: .95, timing: 'dtw' as const, endIsUpperBound: true as const })))
const playback: PlaybackSnapshot = { track: { id: 'song', name: '', artist: '', album: '', coverUrl: '', durationMs: 200000 }, isPlaying: true, positionMs: 150000, observedAtMs: 100000 }
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(100000)
  const recognizer = { cancel: vi.fn(), recognize: vi.fn(async (_pcm: Float32Array, _language: string) => heard) }
  const service = new VocalSync(recognizer as unknown as LocalAsr)
  service.observePlayback(playback); service.start('song')
  vi.setSystemTime(112000)
  const capture: VocalCapture = { trackId: 'song', sampleRate: 16000, pcm: new Float32Array(192000),
    capturedAtMs: 112000, captureDurationMs: 12000, language: 'ja', lines }
  return { service, recognizer, capture }
}
afterEach(() => vi.useRealTimers())
describe('vocal capture IPC lifecycle', () => {
  it('uses continuous preceding sound to recognize the same fresh input, counting only fresh token onsets', async () => {
    const { service, capture, recognizer } = setup()
    const firstPcm = new Float32Array(192000).fill(.04)
    recognizer.recognize.mockImplementation(async pcm => pcm.length > 192000
      ? [...heard, ...heard.map(token => ({ ...token, startMs: token.startMs + 12000, endMs: token.endMs + 12000 }))]
      : [])
    const accept = vi.spyOn(service.clock, 'accept')
    expect((await service.process({ ...capture, pcm: firstPcm })).linesMatched).toBe(0)
    firstPcm.fill(.9) // A transferred/caller-owned input cannot mutate cached context.
    vi.setSystemTime(124000)
    const next = { ...capture, pcm: new Float32Array(192000).fill(.08), capturedAtMs: 124000 }
    const result = await service.process(next)
    expect(result).toMatchObject({ decision: 'confirming', linesMatched: 3 })
    const input = recognizer.recognize.mock.calls[1][0]
    expect(input).toHaveLength(384000)
    expect(input[0]).toBeCloseTo(.04)
    expect(input[192000]).toBeCloseTo(.08)
    const observation = accept.mock.calls[1][0]
    expect(observation).toMatchObject({ capturedAtMs: 124000, captureDurationMs: 12000 })
    expect(observation.points.map(point => point.heardMs)).toEqual([1000, 5000, 9000])
  })
  it.each([51, -51, 12000])('does not bridge a missing or overlapping audio interval of %i ms', async gapMs => {
    const { service, capture, recognizer } = setup()
    await service.process({ ...capture, pcm: new Float32Array(192000).fill(.04) })
    vi.setSystemTime(124000 + gapMs)
    await service.process({ ...capture, pcm: new Float32Array(192000).fill(.08), capturedAtMs: Date.now() })
    expect(recognizer.recognize.mock.calls[1][0]).toHaveLength(192000)
  })
  it('stays on fresh audio after an inference takes more than six seconds', async () => {
    const { service, capture, recognizer } = setup()
    recognizer.recognize.mockImplementation(async () => { vi.setSystemTime(Date.now() + 6001); return [] })
    await service.process({ ...capture, pcm: new Float32Array(192000).fill(.04) })
    recognizer.recognize.mockResolvedValue([])
    vi.setSystemTime(124000)
    await service.process({ ...capture, pcm: new Float32Array(192000).fill(.08), capturedAtMs: 124000 })
    expect(recognizer.recognize.mock.calls[1][0]).toHaveLength(192000)
  })
  it.each(['clear', 'pause', 'seek', 'failure'] as const)('releases preceding sound on %s', async action => {
    const { service, capture, recognizer } = setup()
    await service.process({ ...capture, pcm: new Float32Array(192000).fill(.04) })
    if (action === 'pause') {
      service.observePlayback({ ...playback, isPlaying: false })
      service.observePlayback({ ...playback, isPlaying: true, observedAtMs: 112000 })
    } else if (action === 'seek') service.observePlayback({ ...playback, positionMs: 10000, observedAtMs: 112000 })
    else if (action === 'clear') service.clear()
    else {
      recognizer.recognize.mockRejectedValueOnce(new Error('engine failed'))
      vi.setSystemTime(124000)
      await expect(service.process({ ...capture, pcm: new Float32Array(192000).fill(.08), capturedAtMs: 124000 })).rejects.toThrow('engine failed')
    }
    service.start('song')
    recognizer.recognize.mockResolvedValue([])
    vi.setSystemTime(action === 'failure' ? 136000 : 124000)
    await service.process({ ...capture, pcm: new Float32Array(192000).fill(.08), capturedAtMs: Date.now() })
    expect(recognizer.recognize.mock.calls.at(-1)![0]).toHaveLength(192000)
  })
  it('does not retain context produced by an in-flight cancelled recognition', async () => {
    const { service, capture, recognizer } = setup()
    let finish!: (tokens: HeardToken[]) => void
    recognizer.recognize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = service.process({ ...capture, pcm: new Float32Array(192000).fill(.04) })
    service.clear(); service.start('song')
    finish(heard)
    expect((await pending).reason).toBe('cancelled')
    vi.setSystemTime(124000)
    await service.process({ ...capture, pcm: new Float32Array(192000).fill(.08), capturedAtMs: 124000 })
    expect(recognizer.recognize.mock.calls[1][0]).toHaveLength(192000)
  })
  it('processes one capture without modifying the transport or prematurely locking', async () => {
    const { service, capture, recognizer } = setup()
    expect(await service.process(capture)).toMatchObject({ decision: 'confirming', linesMatched: 3 })
    expect(recognizer.recognize).toHaveBeenCalledOnce()
    expect(service.clock.decorate(playback)?.acousticAnchor).toBeUndefined()
  })
  it('fits speed from three independent single-line recordings instead of requiring two complete lines per block', async () => {
    const { service, capture, recognizer } = setup()
    const spaced = lines.map((line, index) => ({ ...line, startMs: 61000 + index * 11520 }))
    for (let index = 0; index < 3; index++) {
      recognizer.recognize.mockResolvedValue([...spaced[index].text].map((text, char) => ({
        text, startMs: 1000 + char * 120, endMs: 12000, probability: .98,
        timing: 'dtw' as const, endIsUpperBound: true as const,
      })))
      vi.setSystemTime(112000 + index * 12000)
      const result = await service.process({ ...capture, lines: spaced, capturedAtMs: Date.now() })
      expect(result).toMatchObject({ decision: index < 2 ? 'confirming' : 'locked', linesMatched: 1 })
      if (index === 2) {
        expect(result.rate).toBeCloseTo(.96, 5)
        expect(result.calibration?.positionMs).toBeCloseTo(94600, 1)
      }
    }
    expect(playback.positionMs).toBe(150000)
  })
  it('reports an unrefreshed valid hold separately from a new successful match', async () => {
    const { service, capture, recognizer } = setup()
    recognizer.recognize.mockResolvedValue([])
    vi.spyOn(service.clock, 'decorate').mockReturnValue({ ...playback, acousticAnchor: {
      trackId: 'song', coordinate: 'lyrics', lyricTimingKey: lyricTimingKey(lines), sourcePositionMs: 61000,
      observedAtMs: 100000, expiresAtMs: 140000, rate: .96, score: .98,
    } })
    const result = await service.process(capture)
    expect(result).toMatchObject({ decision: 'rejected', reason: 'insufficient-words', rate: .96,
      calibration: { state: 'holding', positionMs: 72520, expiresAtMs: 140000 } })
    expect(capture.capturedAtMs).toBe(112000)
  })
  it.each([{ expiresAtMs: 111000 }, { trackId: 'other' }, { lyricTimingKey: 'wrong' }, { observedAtMs: 113000 }])('does not describe a stale/foreign anchor as holding: %j', async patch => {
    const { service, capture, recognizer } = setup()
    recognizer.recognize.mockResolvedValue([])
    vi.spyOn(service.clock, 'decorate').mockReturnValue({ ...playback, acousticAnchor: {
      trackId: 'song', coordinate: 'lyrics', lyricTimingKey: lyricTimingKey(lines), sourcePositionMs: 61000,
      observedAtMs: 100000, expiresAtMs: 140000, rate: .96, score: .98, ...patch,
    } })
    expect((await service.process(capture)).calibration).toBeUndefined()
  })
  it.each([{ sampleRate: 8000 }, { capturedAtMs: 90000 }, { trackId: 'wrong' }, { pcm: new Float32Array(300000) }])('rejects %j before starting inference', async patch => {
    const { service, capture, recognizer } = setup()
    expect((await service.process({ ...capture, ...patch })).decision).toBe('rejected')
    expect(recognizer.recognize).not.toHaveBeenCalled()
  })
  it('cancels in-flight results on pause and never queues another recording', async () => {
    const { service, capture, recognizer } = setup()
    let complete!: (value: HeardToken[]) => void
    recognizer.recognize.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const pending = service.process(capture)
    expect((await service.process(capture)).reason).toBe('busy')
    service.observePlayback({ ...playback, isPlaying: false })
    complete(heard)
    expect((await pending).reason).toBe('cancelled')
    expect(recognizer.cancel).toHaveBeenCalled()
    expect(service.clock.decorate(playback)?.acousticAnchor).toBeUndefined()
  })
  it('invalidates source edits and requires an explicit new session', async () => {
    const { service, capture, recognizer } = setup()
    await service.process(capture)
    vi.setSystemTime(124000)
    const changed = { ...capture, capturedAtMs: 124000, lines: lines.map(line => ({ ...line, startMs: line.startMs + 5000 })) }
    expect((await service.process(changed)).reason).toBe('lyrics-changed')
    expect((await service.process(changed)).reason).toBe('inactive')
    expect(recognizer.recognize).toHaveBeenCalledOnce()
  })
})
