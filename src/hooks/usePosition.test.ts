import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackSnapshot } from '../types'

const hooks = vi.hoisted(() => ({
  index: 0,
  cells: [] as Array<{ value?: unknown; deps?: unknown[]; cleanup?: void | (() => void) }>,
  pending: [] as Array<() => void>,
  positions: [] as number[]
}))
vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const index = hooks.index++
    hooks.cells[index] ??= { value: { current: initial } }
    return hooks.cells[index].value
  },
  useState: (initial: unknown) => {
    const index = hooks.index++
    hooks.cells[index] ??= { value: initial }
    return [hooks.cells[index].value, (value: number) => {
      hooks.cells[index].value = value
      hooks.positions.push(value)
    }]
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.index++
    const previous = hooks.cells[index]
    if (previous?.deps && previous.deps.length === deps.length && deps.every((dep, i) => Object.is(dep, previous.deps![i]))) return
    hooks.cells[index] = { ...previous, deps }
    hooks.pending.push(() => {
      previous?.cleanup?.()
      hooks.cells[index].cleanup = effect()
    })
  }
}))

import { usePosition } from './usePosition'

let visibility: DocumentVisibilityState
let events: EventTarget
const sample = (patch: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  track: { id: 'song', name: '', artist: '', album: '', coverUrl: '', durationMs: 300_000 },
  positionMs: 10_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local', ...patch
})
const render = (playback: PlaybackSnapshot | null, refreshMs = 160) => {
  hooks.index = 0
  const value = usePosition(playback, refreshMs)
  hooks.pending.splice(0).forEach(effect => effect())
  return value
}
const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next
  events.dispatchEvent(new Event('visibilitychange'))
}
const lastPosition = () => hooks.positions.at(-1)
const installNativeVisibility = (query: () => Promise<boolean>) => {
  const listeners = new Set<(visible: boolean) => void>()
  Object.assign(window, { syllable: { window: {
    visibility: query,
    onVisibilityChanged: (listener: (visible: boolean) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  } } })
  return { send: (visible: boolean) => listeners.forEach(listener => listener(visible)), listeners }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  visibility = 'visible'
  events = new EventTarget()
  hooks.index = 0; hooks.cells = []; hooks.pending = []; hooks.positions = []
  vi.stubGlobal('window', { setInterval, clearInterval })
  vi.stubGlobal('document', {
    get visibilityState() { return visibility },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events)
  })
})
afterEach(() => {
  hooks.cells.forEach(cell => cell.cleanup?.())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('visibility-aware visual position clock', () => {
  it('keeps the same visible cadence and eliminates hidden visual ticks', () => {
    render(sample())
    hooks.positions.length = 0
    vi.advanceTimersByTime(60_000)
    expect(hooks.positions).toHaveLength(375)
    expect(lastPosition()).toBe(70_000)
    setVisibility('hidden')
    expect(vi.getTimerCount()).toBe(0)
    hooks.positions.length = 0
    vi.advanceTimersByTime(60_000)
    expect(hooks.positions).toEqual([])
    setVisibility('visible')
    expect(hooks.positions).toEqual([130_000])
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(160)
    expect(lastPosition()).toBe(130_160)
  })

  it('does not tick on hidden startup but keeps fresh transport observations', () => {
    visibility = 'hidden'
    render(sample())
    expect(vi.getTimerCount()).toBe(0)
    expect(hooks.positions).toEqual([])
    vi.advanceTimersByTime(5_000)
    render(sample({ positionMs: 42_000 }))
    vi.advanceTimersByTime(2_000)
    expect(hooks.positions).toEqual([])
    setVisibility('visible')
    expect(lastPosition()).toBe(44_000)
  })

  it('immediately restores a paused seek without starting an interpolation timer', () => {
    render(sample())
    setVisibility('hidden')
    hooks.positions.length = 0
    render(sample({ positionMs: 85_000, isPlaying: false }))
    vi.advanceTimersByTime(60_000)
    expect(hooks.positions).toEqual([])
    setVisibility('visible')
    expect(lastPosition()).toBe(85_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not replay the previous song when track changes while hidden', () => {
    const previous = sample()
    render(previous)
    setVisibility('hidden')
    render(sample({ track: { ...previous.track!, id: 'replacement' }, positionMs: 2_000 }))
    vi.advanceTimersByTime(1_000)
    setVisibility('visible')
    expect(lastPosition()).toBe(3_000)
  })

  it('retains the stale-snapshot guard while hidden', () => {
    render(sample())
    setVisibility('hidden')
    render(sample({ positionMs: 50_000, observedAtMs: Date.now() - 100 }))
    vi.advanceTimersByTime(1_000)
    setVisibility('visible')
    expect(lastPosition()).toBe(11_000)
  })

  it('uses the requested overlay cadence and never accumulates duplicate timers', () => {
    const playback = sample()
    render(playback, 80)
    setVisibility('visible')
    setVisibility('visible')
    expect(vi.getTimerCount()).toBe(1)
    hooks.positions.length = 0
    vi.advanceTimersByTime(800)
    expect(hooks.positions).toHaveLength(10)
    render(playback, 160)
    expect(vi.getTimerCount()).toBe(1)
    hooks.positions.length = 0
    vi.advanceTimersByTime(800)
    expect(hooks.positions).toHaveLength(5)
  })

  it('removes visibility listeners and timers on cleanup', () => {
    render(sample())
    hooks.cells.forEach(cell => { cell.cleanup?.(); cell.cleanup = undefined })
    hooks.positions.length = 0
    expect(vi.getTimerCount()).toBe(0)
    setVisibility('hidden'); setVisibility('visible')
    vi.advanceTimersByTime(1_000)
    expect(hooks.positions).toEqual([])
  })

  it('waits for native visibility and stops a hidden native window even when Chromium says visible', async () => {
    const native = installNativeVisibility(() => Promise.resolve(false))
    render(sample())
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hooks.positions).toEqual([])
    render(sample({ positionMs: 90_000 }))
    expect(hooks.positions).toEqual([])
    native.send(true)
    expect(lastPosition()).toBe(90_000)
    expect(vi.getTimerCount()).toBe(1)
    native.send(false)
    hooks.positions.length = 0
    vi.advanceTimersByTime(1_000)
    expect(hooks.positions).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let a late initial native query override a newer visibility event', async () => {
    let resolveQuery!: (visible: boolean) => void
    const native = installNativeVisibility(() => new Promise(resolve => { resolveQuery = resolve }))
    render(sample())
    expect(vi.getTimerCount()).toBe(0)
    native.send(true)
    expect(lastPosition()).toBe(10_000)
    resolveQuery(false)
    await vi.advanceTimersByTimeAsync(160)
    expect(lastPosition()).toBe(10_160)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('requires both native and DOM visibility before resuming', async () => {
    const native = installNativeVisibility(() => Promise.resolve(true))
    render(sample())
    await vi.advanceTimersByTimeAsync(0)
    setVisibility('hidden')
    native.send(true)
    expect(vi.getTimerCount()).toBe(0)
    native.send(false)
    setVisibility('visible')
    expect(vi.getTimerCount()).toBe(0)
    native.send(true)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('disposes native listeners and ignores a query that finishes after cleanup', async () => {
    let resolveQuery!: (visible: boolean) => void
    const native = installNativeVisibility(() => new Promise(resolve => { resolveQuery = resolve }))
    render(sample())
    hooks.cells.forEach(cell => { cell.cleanup?.(); cell.cleanup = undefined })
    expect(native.listeners.size).toBe(0)
    hooks.positions.length = 0
    resolveQuery(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(hooks.positions).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back to DOM visibility if the native visibility query fails', async () => {
    installNativeVisibility(() => Promise.reject(new Error('preload unavailable')))
    render(sample())
    await vi.advanceTimersByTimeAsync(0)
    expect(lastPosition()).toBe(10_000)
    expect(vi.getTimerCount()).toBe(1)
    setVisibility('hidden')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports actual interval ticks separately from transport samples in opted-in QA only', () => {
    const probe = { ticks: 0, samples: 0 }
    window.__syllablePositionProbe = probe
    render(sample())
    vi.advanceTimersByTime(320)
    expect(probe).toEqual({ ticks: 2, samples: 1 })
    setVisibility('hidden')
    render(sample({ positionMs: 30_000 }))
    vi.advanceTimersByTime(1_000)
    expect(probe).toEqual({ ticks: 2, samples: 2 })
    delete window.__syllablePositionProbe
    setVisibility('visible')
    vi.advanceTimersByTime(160)
    expect(probe).toEqual({ ticks: 2, samples: 2 })
  })
})
