import { afterEach, describe, expect, it, vi } from 'vitest'
import { VocalSync } from './vocal-sync'
import type { LocalAsr } from './local-asr'
import type { HeardToken } from './lyric-aligner'
import type { VocalCapture } from '../../src/lib/vocal-sync-types'
import type { PlaybackSnapshot } from '../../src/types'

const lines = ['あおぞらを見ながら歩いていた', 'みどりの道をゆっくり進んだ', 'あたらしい窓を開いてみよう']
  .map((text, i) => ({ text, startMs: 61000 + i * 4000 }))
const heard = lines.flatMap((line, i) => [...line.text].map((text, j) => ({ text, startMs: 1000 + i * 4000 + j * 120,
  endMs: 1100 + i * 4000 + j * 120, probability: .95 })))
const playback: PlaybackSnapshot = { track: { id: 'song', name: '', artist: '', album: '', coverUrl: '', durationMs: 200000 }, isPlaying: true, positionMs: 150000, observedAtMs: 100000 }
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(100000)
  const recognizer = { cancel: vi.fn(), recognize: vi.fn(async () => heard) }
  const service = new VocalSync(recognizer as unknown as LocalAsr)
  service.observePlayback(playback); service.start('song')
  vi.setSystemTime(112000)
  const capture: VocalCapture = { trackId: 'song', sampleRate: 16000, pcm: new Float32Array(192000),
    capturedAtMs: 112000, captureDurationMs: 12000, language: 'ja', lines }
  return { service, recognizer, capture }
}
afterEach(() => vi.useRealTimers())
describe('vocal capture IPC lifecycle', () => {
  it('processes one capture without modifying the transport or prematurely locking', async () => {
    const { service, capture, recognizer } = setup()
    expect(await service.process(capture)).toMatchObject({ decision: 'confirming', linesMatched: 3 })
    expect(recognizer.recognize).toHaveBeenCalledOnce()
    expect(service.clock.decorate(playback)?.acousticAnchor).toBeUndefined()
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
