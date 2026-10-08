import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ playback: null as any, lyrics: null as any, listeners: new Set<(next: any, prior: any) => void>() }))
vi.mock('../store/useAppStore', () => ({ useAppStore: {
  getState: () => ({ playback: store.playback, lyrics: store.lyrics }),
  subscribe: (listener: any) => { store.listeners.add(listener); return () => store.listeners.delete(listener) },
} }))
function publish(playback: any) {
  const prior = { playback: store.playback }; store.playback = playback
  for (const listener of store.listeners) listener({ playback }, prior)
}
const file = { name: 'reference.wav', size: 100, arrayBuffer: async () => new ArrayBuffer(8) } as File
let cleanup: (() => void) | undefined

beforeEach(() => {
  vi.resetModules(); store.listeners.clear()
  store.lyrics = null
  store.playback = { track: { id: 'song', name: 'Song' }, isPlaying: true, positionMs: 0, observedAtMs: 1000 }
  vi.stubGlobal('Worker', class {
    onmessage: any
    postMessage(message: any) { queueMicrotask(() => this.onmessage?.({ data: { id: message.id, value: {} } })) }
    terminate() {}
  })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 8000; currentTime = 0; destination = {}
    audioWorklet = { addModule: async () => {} }
    async decodeAudioData() { return { duration: 12, length: 96000, sampleRate: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(96000) } }
    async close() {} async resume() {}
    createMediaStreamSource() { return { connect() {} } }
  })
  vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null }; connect() {} disconnect() {} })
  vi.stubGlobal('document', { baseURI: 'https://localhost/' })
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { audioSync: {
    prepare: vi.fn(async () => true), clear: vi.fn(async () => true), observation: vi.fn(),
  } } })
})
afterEach(async () => { cleanup?.(); cleanup = undefined; await Promise.resolve(); vi.unstubAllGlobals() })

describe('audio capture lifecycle', () => {
  it('keeps a text-free prior analysis summary visible during inference and stop, but clears it on track change', async () => {
    store.lyrics = { trackId: 'song', tracks: [{ kind: 'original', language: 'ja', lines:
      Array.from({ length: 4 }, (_, index) => ({ text: `Synthetic line ${index}`, startMs: index * 4000 })) }] }
    let port: any
    vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null }; constructor() { port = this.port } connect() {} disconnect() {} })
    const audioTrack = { stop: vi.fn(), onended: null }
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => ({
      getTracks: () => [audioTrack], getAudioTracks: () => [audioTrack], getVideoTracks: () => [],
    }) } })
    Object.assign(window.syllable.audioSync, { engineStatus: vi.fn(async () => ({ ready: true })),
      vocal: vi.fn(async () => ({ decision: 'rejected', reason: 'insufficient-words', linesMatched: 0, elapsedMs: 2000, score: 0, rate: 1 })) })
    const { acousticController: controller } = await import('./acoustic-controller')
    cleanup = controller.connect()
    await controller.startVocal()
    const block = { data: { pcm: new Float32Array(192000), sampleRate: 16000, endContextTime: 0 } }
    await port.onmessage(block)
    expect(controller.snapshot().lastResult).toMatchObject({ decision: 'rejected', elapsedMs: 2000 })
    let complete!: (value: any) => void
    vi.mocked(window.syllable.audioSync.vocal).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const pending = port.onmessage(block)
    expect(controller.snapshot().busy).toBe(true)
    expect(controller.snapshot().lastResult?.message).toContain('未识别到足够可靠')
    await controller.stop()
    expect(controller.snapshot().lastResult?.decision).toBe('rejected')
    complete({ decision: 'locked', reason: 'matched' }); await pending
    expect(controller.snapshot().lastResult?.decision).toBe('rejected')
    publish({ ...store.playback, track: { id: 'other', name: 'Other' } })
    expect(controller.snapshot().lastResult).toBeUndefined()
  })
  it('cancels pending capture on pause without recursively clearing on its own broadcast', async () => {
    let resolveCapture!: (value: any) => void
    const capture = new Promise(resolve => { resolveCapture = resolve })
    const getDisplayMedia = vi.fn(() => capture)
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    const { acousticController: controller } = await import('./acoustic-controller')
    cleanup = controller.connect()
    await controller.loadReference(file)
    const starting = controller.start()
    await vi.waitFor(() => expect(getDisplayMedia).toHaveBeenCalledOnce())
    const clear = vi.mocked(window.syllable.audioSync.clear)
    clear.mockClear()
    clear.mockImplementation(async () => { publish(store.playback); return true })
    publish({ ...store.playback, isPlaying: false })
    const stop = vi.fn()
    resolveCapture({ getTracks: () => [{ stop }] })
    await starting
    expect(stop).toHaveBeenCalledOnce()
    expect(clear).toHaveBeenCalledOnce()
    expect(controller.snapshot().running).toBe(false)
  })

  it('releases every stream track on seek and clears the reference on a song change', async () => {
    const stopAudio = vi.fn(), stopVideo = vi.fn()
    const audioTrack = { stop: stopAudio, onended: null }, videoTrack = { stop: stopVideo }
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => ({
      getTracks: () => [audioTrack, videoTrack], getAudioTracks: () => [audioTrack], getVideoTracks: () => [videoTrack],
    }) } })
    const { acousticController: controller } = await import('./acoustic-controller')
    cleanup = controller.connect()
    await controller.loadReference(file)
    await controller.start()
    expect(controller.snapshot().running).toBe(true)
    publish({ ...store.playback, positionMs: 70000, observedAtMs: 2000 })
    await vi.waitFor(() => expect(controller.snapshot().busy).toBe(false))
    expect(stopAudio).toHaveBeenCalledOnce()
    expect(controller.snapshot().running).toBe(false)
    expect(controller.snapshot().referenceName).toBe('reference.wav')
    publish({ ...store.playback, track: { id: 'other', name: 'Other' } })
    await vi.waitFor(() => expect(controller.snapshot().busy).toBe(false))
    expect(controller.snapshot().referenceName).toBe('')
    expect(controller.snapshot().trackId).toBe('')
  })
})
