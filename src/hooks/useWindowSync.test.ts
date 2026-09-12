import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  listeners: new Set<(next: any, previous: any) => void>(),
  cleanup: undefined as undefined | (() => void),
}))
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { harness.cleanup = effect() } }))
vi.mock('../store/useAppStore', () => ({ useAppStore: {
  getState: () => harness.state,
  setState: (update: any) => {
    const previous = harness.state
    const patch = typeof update === 'function' ? update(previous) : update
    if (patch === previous) return
    harness.state = { ...previous, ...patch }
    for (const listener of harness.listeners) listener(harness.state, previous)
  },
  subscribe: (listener: (next: any, previous: any) => void) => {
    harness.listeners.add(listener)
    return () => harness.listeners.delete(listener)
  },
} }))

class TestChannel {
  static current: TestChannel
  onmessage: ((event: any) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
  constructor() { TestChannel.current = this }
  deliver(message: Record<string, unknown>) { this.onmessage?.({ data: { source: 'primary', ...message } }) }
}
const doc = (trackId: string) => ({ trackId, tracks: [], updatedAt: 1 })

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  harness.listeners.clear()
  harness.state = { playback: { track: { id: 'new' } }, lyrics: doc('old'), library: {}, settings: {} }
  vi.stubGlobal('BroadcastChannel', TestChannel)
  vi.stubGlobal('window', { location: { hash: '#/overlay' }, setTimeout, clearTimeout,
    syllable: { overlay: { onVisibilityChanged: () => () => {}, onClickThroughChanged: () => () => {} } } })
})
afterEach(() => {
  harness.cleanup?.()
  harness.cleanup = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function start() {
  const { useWindowSync } = await import('./useWindowSync')
  useWindowSync()
  const channel = TestChannel.current
  const target = channel.postMessage.mock.calls[0][0].source
  return { channel, target }
}

describe('cross-window message and timer integration', () => {
  it('keeps bulk imports local while still delivering the current document', async () => {
    window.location.hash = '#/'
    const { useWindowSync } = await import('./useWindowSync')
    useWindowSync()
    const channel = TestChannel.current
    const previous = harness.state
    const library = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`other-${index}`, doc(`other-${index}`)]))
    harness.state = { ...previous, library }
    for (const listener of harness.listeners) listener(harness.state, previous)
    expect(channel.postMessage.mock.calls.length).toBe(0)
    expect(Object.keys(harness.state.library)).toHaveLength(500)
    const current = doc('new')
    const imported = harness.state
    harness.state = { ...imported, lyrics: current, library: { ...library, new: current } }
    for (const listener of harness.listeners) listener(harness.state, imported)
    expect(channel.postMessage).toHaveBeenCalledTimes(1)
    expect(channel.postMessage.mock.calls[0][0]).toMatchObject({ type: 'library-upsert', document: current })
  })
  it('publishes an explicit cleared view even when the library changes in the same update', async () => {
    window.location.hash = '#/'
    const { useWindowSync } = await import('./useWindowSync')
    useWindowSync()
    const channel = TestChannel.current
    const previous = harness.state
    harness.state = { ...previous, lyrics: null, library: { unrelated: doc('unrelated') } }
    for (const listener of harness.listeners) listener(harness.state, previous)
    expect(channel.postMessage.mock.calls.map(call => call[0].type)).toEqual(['lyrics-view'])
    expect(channel.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ trackId: 'new', document: null })
  })

  it('still broadcasts removal of the current document while skipping unrelated removals', async () => {
    window.location.hash = '#/'
    const { useWindowSync } = await import('./useWindowSync')
    harness.state = { ...harness.state, lyrics: doc('new'), library: { new: doc('new'), old: doc('old') } }
    useWindowSync()
    const channel = TestChannel.current
    const previous = harness.state
    harness.state = { ...previous, lyrics: null, library: {} }
    for (const listener of harness.listeners) listener(harness.state, previous)
    expect(channel.postMessage.mock.calls.map(call => call[0].type)).toEqual(['library-remove', 'lyrics-view'])
    expect(channel.postMessage.mock.calls[0][0]).toMatchObject({ trackId: 'new' })
    expect(channel.postMessage.mock.calls[1][0]).toMatchObject({ trackId: 'new', document: null })
  })

  it('sends one copy for a current upsert but retains a distinct transient view', async () => {
    window.location.hash = '#/'
    const { useWindowSync } = await import('./useWindowSync')
    useWindowSync()
    const channel = TestChannel.current
    const saved = doc('new')
    let previous = harness.state
    harness.state = { ...previous, lyrics: saved, library: { new: saved } }
    for (const listener of harness.listeners) listener(harness.state, previous)
    expect(channel.postMessage.mock.calls.map(call => call[0].type)).toEqual(['library-upsert'])
    channel.postMessage.mockClear()
    previous = harness.state
    const transient = { ...doc('new'), updatedAt: 2 }
    harness.state = { ...previous, lyrics: transient, library: { ...previous.library, other: doc('other') } }
    for (const listener of harness.listeners) listener(harness.state, previous)
    expect(channel.postMessage.mock.calls.map(call => call[0].type)).toEqual(['lyrics-view'])
    expect(channel.postMessage.mock.calls.at(-1)?.[0].document).toBe(transient)
  })

  it('acknowledges empty snapshots, clears old lyrics and stops retrying', async () => {
    const { channel, target } = await start()
    channel.deliver({ type: 'snapshot', target, trackId: 'new', settings: {}, document: null })
    expect(harness.state.lyrics).toBeNull()
    await vi.advanceTimersByTimeAsync(8000)
    expect(channel.postMessage).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects stale snapshots, retries and accepts the subsequent current document', async () => {
    const { channel, target } = await start()
    channel.deliver({ type: 'snapshot', target, trackId: 'old', settings: {}, document: null })
    expect(harness.state.lyrics.trackId).toBe('old')
    await vi.advanceTimersByTimeAsync(800)
    expect(channel.postMessage).toHaveBeenCalledTimes(2)
    channel.deliver({ type: 'library-upsert', document: doc('new') })
    expect(harness.state.lyrics.trackId).toBe('new')
    expect(harness.state.library).toEqual({})
    await vi.advanceTimersByTimeAsync(8000)
    expect(channel.postMessage).toHaveBeenCalledTimes(2)
  })
  it('rearms on a new song and cleans timer/subscription/channel on unmount', async () => {
    const { channel, target } = await start()
    channel.deliver({ type: 'snapshot', target, trackId: 'new', settings: {}, document: null })
    const previous = harness.state
    harness.state = { ...previous, playback: { track: { id: 'next' } } }
    for (const listener of harness.listeners) listener(harness.state, previous)
    expect(channel.postMessage).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    harness.cleanup?.()
    harness.cleanup = undefined
    expect(vi.getTimerCount()).toBe(0)
    expect(harness.listeners.size).toBe(0)
    expect(channel.close).toHaveBeenCalledTimes(1)
  })
})
