import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ playback: null as any, lyrics: null as any,
  settings: { automaticAudioSync: false } as { automaticAudioSync: boolean; audioSyncBackend?: 'whisper' | 'phoneme-diagnostic' },
  listeners: new Set<(next: any, prior: any) => void>() }))
vi.mock('../store/useAppStore', () => ({ useAppStore: {
  getState: () => ({ playback: store.playback, lyrics: store.lyrics, settings: store.settings,
    patchSettings: (patch: any) => {
      const prior = { playback: store.playback, lyrics: store.lyrics, settings: store.settings }
      store.settings = { ...store.settings, ...patch }
      for (const listener of store.listeners) listener({ ...prior, settings: store.settings }, prior)
    } }),
  subscribe: (listener: any) => { store.listeners.add(listener); return () => store.listeners.delete(listener) },
} }))
function publish(playback: any) {
  const prior = { playback: store.playback, lyrics: store.lyrics, settings: store.settings }; store.playback = playback
  for (const listener of store.listeners) listener({ ...prior, playback }, prior)
}
function publishLyrics(lyrics: any) {
  const prior = { playback: store.playback, lyrics: store.lyrics, settings: store.settings }; store.lyrics = lyrics
  for (const listener of store.listeners) listener({ ...prior, lyrics }, prior)
}
const original = (trackId = 'song') => ({ trackId, tracks: [{ id: 'original', kind: 'original', language: 'ja', lines:
  Array.from({ length: 4 }, (_, index) => ({ text: `Synthetic line ${index}`, startMs: index * 4000 })) }] })
const file = { name: 'reference.wav', size: 100, arrayBuffer: async () => new ArrayBuffer(8) } as File
let cleanup: (() => void) | undefined

beforeEach(() => {
  vi.resetModules(); store.listeners.clear()
  store.lyrics = null
  store.settings = { automaticAudioSync: false }
  store.playback = { track: { id: 'song', name: 'Song' }, isPlaying: true, positionMs: 0, observedAtMs: 1000 }
  vi.stubGlobal('Worker', class {
    onmessage: any
    postMessage(message: any) { queueMicrotask(() => this.onmessage?.({ data: { id: message.id, value: {} } })) }
    terminate() {}
  })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 8000; currentTime = 12; destination = {}
    audioWorklet = { addModule: async () => {} }
    async decodeAudioData() { return { duration: 12, length: 96000, sampleRate: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(96000) } }
    async close() {} async resume() {}
    createMediaStreamSource() { return { connect() {} } }
  })
  vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null, postMessage: vi.fn() }; connect() {} disconnect() {} })
  vi.stubGlobal('document', { baseURI: 'https://localhost/' })
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { audioSync: {
    prepare: vi.fn(async () => true), clear: vi.fn(async () => true), observation: vi.fn(),
  } } })
})
afterEach(async () => { cleanup?.(); cleanup = undefined; await Promise.resolve(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('audio capture lifecycle', () => {
  async function automaticHarness(backend?: 'phoneme-diagnostic') {
    vi.useFakeTimers()
    window.setTimeout = setTimeout as unknown as typeof window.setTimeout
    window.clearTimeout = clearTimeout
    store.settings = { automaticAudioSync: true, audioSyncBackend: backend }; store.lyrics = original()
    const captures: any[] = []
    const getDisplayMedia = vi.fn(async () => {
      const track = { stop: vi.fn(), onended: null }
      captures.push(track)
      return { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] }
    })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    Object.assign(window.syllable.audioSync, { engineStatus: vi.fn(async () => ({ ready: true })), vocal: vi.fn(),
      phonemeStatus: vi.fn(async () => ({ available: true })), phoneme: vi.fn() })
    const { acousticController: controller } = await import('./acoustic-controller')
    cleanup = controller.connect()
    await vi.advanceTimersByTimeAsync(401)
    return { controller, captures, getDisplayMedia }
  }
  it('restores automatic intent and reacquires after pause, resume and seek with no per-song clicks', async () => {
    const { controller, captures, getDisplayMedia } = await automaticHarness()
    expect(controller.snapshot()).toMatchObject({ automatic: true, running: true })
    publish({ ...store.playback, isPlaying: false })
    await vi.advanceTimersByTimeAsync(401)
    expect(captures[0].stop).toHaveBeenCalledOnce()
    expect(controller.snapshot()).toMatchObject({ automatic: true, running: false, busy: false })
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    publish({ ...store.playback, isPlaying: true })
    await vi.advanceTimersByTimeAsync(401)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    publish({ ...store.playback, positionMs: 70000, observedAtMs: 2000 })
    await vi.advanceTimersByTimeAsync(401)
    expect(captures[1].stop).toHaveBeenCalledOnce()
    expect(getDisplayMedia).toHaveBeenCalledTimes(3)
    expect(controller.snapshot().running).toBe(true)
  })
  it('waits for new-song lyrics and ignores translation-only refreshes', async () => {
    const { controller, getDisplayMedia } = await automaticHarness()
    publish({ ...store.playback, track: { id: 'other' } })
    await vi.advanceTimersByTimeAsync(401)
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    expect(controller.snapshot().running).toBe(false)
    publishLyrics(original('other'))
    await vi.advanceTimersByTimeAsync(401)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    publishLyrics({ ...store.lyrics, tracks: [...store.lyrics.tracks, { kind: 'translation', lines: [] }] })
    await vi.advanceTimersByTimeAsync(401)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    publishLyrics({ ...store.lyrics, tracks: [{ ...store.lyrics.tracks[0], lines: store.lyrics.tracks[0].lines.map((line: any) => ({ ...line, startMs: line.startMs + 1000 })) }] })
    await vi.advanceTimersByTimeAsync(401)
    expect(getDisplayMedia).toHaveBeenCalledTimes(3)
  })
  it('rebuilds a suspended context instead of waiting forever for blocks from it', async () => {
    const contexts: any[] = []
    vi.stubGlobal('AudioContext', class {
      state = 'running'; sampleRate = 16000; currentTime = 12; destination = {}; onstatechange: any
      audioWorklet = { addModule: async () => {} }
      close = vi.fn(async () => { this.state = 'closed'; this.onstatechange?.() })
      async resume() {}
      createMediaStreamSource() { return { connect() {} } }
      constructor() { contexts.push(this) }
    })
    const { controller, captures, getDisplayMedia } = await automaticHarness()
    contexts[0].state = 'suspended'; contexts[0].onstatechange()
    await vi.advanceTimersByTimeAsync(1)
    expect(captures[0].stop).toHaveBeenCalledOnce()
    expect(contexts[0].close).toHaveBeenCalledOnce()
    expect(controller.snapshot()).toMatchObject({ automatic: true, running: false, busy: false })
    publish(store.playback); await vi.advanceTimersByTimeAsync(4998)
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().running).toBe(true)
    contexts[0].onstatechange()
    expect(controller.snapshot().running).toBe(true)
  })
  it('manual stop disables saved intent and does not resurrect it on playback updates', async () => {
    const { controller, getDisplayMedia } = await automaticHarness()
    const clear = vi.mocked(window.syllable.audioSync.clear); clear.mockClear()
    await controller.stop()
    expect(clear).toHaveBeenCalledOnce()
    expect(store.settings.automaticAudioSync).toBe(false)
    publish({ ...store.playback, isPlaying: false }); publish({ ...store.playback, isPlaying: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    expect(controller.snapshot()).toMatchObject({ automatic: false, running: false })
  })
  it('backs off capture errors and does not reopen a denied capture on every playback update', async () => {
    const { controller, getDisplayMedia } = await automaticHarness()
    getDisplayMedia.mockRejectedValueOnce(new Error('output device busy'))
    publish({ ...store.playback, positionMs: 70000, observedAtMs: 2000 })
    await vi.advanceTimersByTimeAsync(401)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    for (let i = 0; i < 5; i++) { publish(store.playback); await vi.advanceTimersByTimeAsync(1000) }
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    getDisplayMedia.mockRejectedValueOnce(Object.assign(new Error('capture denied'), { name: 'NotAllowedError' }))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(getDisplayMedia).toHaveBeenCalledTimes(3)
    publish(store.playback); await vi.advanceTimersByTimeAsync(60_000)
    expect(getDisplayMedia).toHaveBeenCalledTimes(3)
    expect(controller.snapshot().running).toBe(false)
  })
  it('keeps a text-free prior analysis summary visible during inference and stop, but clears it on track change', async () => {
    vi.useFakeTimers(); vi.setSystemTime(112000)
    let contextTime = 12
    vi.stubGlobal('AudioContext', class {
      sampleRate = 16000; get currentTime() { return contextTime }; destination = {}
      audioWorklet = { addModule: async () => {} }
      async close() {} async resume() {}
      createMediaStreamSource() { return { connect() {} } }
    })
    store.lyrics = { trackId: 'song', tracks: [{ kind: 'original', language: 'ja', lines:
      Array.from({ length: 4 }, (_, index) => ({ text: `Synthetic line ${index}`, startMs: index * 4000 })) }] }
    let port: any
    vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null, postMessage: vi.fn() }; constructor() { port = this.port } connect() {} disconnect() {} })
    const audioTrack = { stop: vi.fn(), onended: null }
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => ({
      getTracks: () => [audioTrack], getAudioTracks: () => [audioTrack], getVideoTracks: () => [],
    }) } })
    Object.assign(window.syllable.audioSync, { engineStatus: vi.fn(async () => ({ ready: true })),
      vocal: vi.fn(async () => ({ decision: 'rejected', reason: 'insufficient-words', linesMatched: 0, elapsedMs: 2000, score: 0, rate: 1 })) })
    const { acousticController: controller } = await import('./acoustic-controller')
    cleanup = controller.connect()
    await controller.startVocal()
    const block = { data: { pcm: new Float32Array(192000), sampleRate: 16000, startContextTime: 0, endContextTime: 12 } }
    await port.onmessage(block)
    expect(controller.snapshot().lastResult).toMatchObject({ decision: 'rejected', elapsedMs: 2000 })
    let complete!: (value: any) => void
    vi.mocked(window.syllable.audioSync.vocal).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    contextTime = 24; vi.setSystemTime(124000)
    const pending = port.onmessage({ data: { ...block.data, startContextTime: 12, endContextTime: 24 } })
    expect(controller.snapshot().busy).toBe(true)
    expect(controller.snapshot().lastResult?.message).toContain('未识别到足够可靠')
    await controller.stop()
    expect(controller.snapshot().lastResult?.decision).toBe('rejected')
    complete({ decision: 'locked', reason: 'matched' }); await pending
    expect(controller.snapshot().lastResult?.decision).toBe('rejected')
    publish({ ...store.playback, track: { id: 'other', name: 'Other' } })
    expect(controller.snapshot().lastResult).toBeUndefined()
  })
  it('restores the diagnostic backend without ever starting Whisper and waits for Japanese lyrics after a song change', async () => {
    const { controller, captures, getDisplayMedia } = await automaticHarness('phoneme-diagnostic')
    expect(controller.snapshot()).toMatchObject({ automatic: true, mode: 'phoneme', running: true })
    expect(window.syllable.audioSync.engineStatus).not.toHaveBeenCalled()
    expect(window.syllable.audioSync.prepare).toHaveBeenCalledWith('phoneme')
    publish({ ...store.playback, track: { id: 'english' } })
    publishLyrics({ ...original('english'), tracks: [{ ...original().tracks[0], language: 'en' }] })
    await vi.advanceTimersByTimeAsync(401)
    expect(captures[0].stop).toHaveBeenCalledOnce()
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    expect(controller.snapshot().message).toContain('等待有日语原文')
    publishLyrics(original('english'))
    await vi.advanceTimersByTimeAsync(401)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
  })
  it('never calls a resolved phoneme hypothesis a clock lock and discards late results after stopping', async () => {
    let port: any
    vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null, postMessage: vi.fn() }; constructor() { port = this.port } connect() {} disconnect() {} })
    const { controller } = await automaticHarness('phoneme-diagnostic')
    const result = { clockApplied: false as const, reason: 'hypotheses', hypothesisDecision: 'resolved' as const,
      groups: 3, candidates: 8, commonRows: 3, coverageComplete: false, coverageReasons: ['uncalibrated-acoustic-onsets'],
      elapsedMs: 1000, inferenceMs: 700, matchingMs: 300 }
    vi.mocked(window.syllable.audioSync.phoneme).mockResolvedValue(result)
    const block = { data: { pcm: new Float32Array(192000), sampleRate: 16000, startContextTime: 0, endContextTime: 12 } }
    await port.onmessage(block)
    expect(window.syllable.audioSync.vocal).not.toHaveBeenCalled()
    expect(controller.snapshot().lastResult?.decision).toBe('confirming')
    expect(controller.snapshot().message).toContain('未接管歌词时钟')
    expect(controller.snapshot().rate).toBeUndefined()
    // Restart with a new stream/context to model a fresh capture epoch.
    await controller.stop(); await controller.startPhoneme()
    let complete!: (value: typeof result) => void
    vi.mocked(window.syllable.audioSync.phoneme).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const pending = port.onmessage(block)
    await controller.stop(); complete(result); await pending
    expect(controller.snapshot()).toMatchObject({ running: false, automatic: false })
    expect(controller.snapshot().message).not.toContain('假设一致')
  })
  it('invalidates a gap during inference, ignores its old result and resumes fresh sampling', async () => {
    store.lyrics = { trackId: 'song', tracks: [{ kind: 'original', language: 'ja', lines:
      Array.from({ length: 4 }, (_, index) => ({ text: `Synthetic line ${index}`, startMs: index * 4000 })) }] }
    let port: any
    vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null, postMessage: vi.fn() }; constructor() { port = this.port } connect() {} disconnect() {} })
    const audioTrack = { stop: vi.fn(), onended: null }
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => ({ getTracks: () => [audioTrack], getAudioTracks: () => [audioTrack], getVideoTracks: () => [] }) } })
    let complete!: (value: any) => void
    Object.assign(window.syllable.audioSync, { engineStatus: vi.fn(async () => ({ ready: true })), vocal: vi.fn(() => new Promise(resolve => { complete = resolve })) })
    const { acousticController: controller } = await import('./acoustic-controller')
    cleanup = controller.connect(); await controller.startVocal()
    const block = { data: { pcm: new Float32Array(192000), sampleRate: 16000, startContextTime: 0, endContextTime: 12 } }
    const pending = port.onmessage(block)
    await port.onmessage({ data: { type: 'gap', continuityId: 1 } })
    expect(window.syllable.audioSync.clear).toHaveBeenCalledOnce()
    expect(window.syllable.audioSync.prepare).toHaveBeenCalledTimes(2)
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'reset' })
    complete({ decision: 'locked', reason: 'matched', linesMatched: 3, score: .99, rate: 1 }); await pending
    expect(controller.snapshot().lastResult).toBeUndefined()
    expect(controller.snapshot().running).toBe(true)
    expect(audioTrack.stop).not.toHaveBeenCalled()
    vi.mocked(window.syllable.audioSync.vocal).mockResolvedValue({ decision: 'confirming', reason: 'matched', linesMatched: 3, elapsedMs: 20, score: .99, rate: 1 })
    await port.onmessage(block)
    expect(controller.snapshot().lastResult?.decision).toBe('confirming')
    await port.onmessage({ data: { ...block.data, startContextTime: -5 } })
    expect(window.syllable.audioSync.vocal).toHaveBeenCalledTimes(2)
    expect(window.syllable.audioSync.clear).toHaveBeenCalledTimes(2)
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
