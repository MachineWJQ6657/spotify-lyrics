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
