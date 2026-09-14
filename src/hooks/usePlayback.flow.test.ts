import { afterEach, expect, it, vi } from 'vitest'
import type { LyricsDocument } from '../types'

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>)
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect) },
  useState: (value: unknown) => [value, () => undefined]
}))
vi.mock('../store/useAppStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/useAppStore')>()
  const store = actual.useAppStore
  return { ...actual, useAppStore: Object.assign((selector?: (state: ReturnType<typeof store.getState>) => unknown) =>
    selector ? selector(store.getState()) : store.getState(), store) }
})
import { useAppStore } from '../store/useAppStore'
import { usePlaybackConnection } from './usePlayback'

const initial = useAppStore.getState()
let cleanup: void | (() => void)
afterEach(() => {
  cleanup?.(); cleanup = undefined
  effects.length = 0
  useAppStore.setState(initial)
  vi.useRealTimers(); vi.unstubAllGlobals()
})

// Runs the actual provider effect against the real store; not a React DOM test.
it('preserves translations and calibration from partial fetch through delayed romanization', async () => {
  vi.useFakeTimers()
  const track = { id: 'flow-partial', name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  const baseline: LyricsDocument = { trackId: track.id, offsetMs: 2300, userEditedTrackIds: ['local-zh'], tracks: [
    { id: 'local-zh', kind: 'translation', language: 'zh-Hans', label: '中文', source: 'User', lines: [{ startMs: 1000, text: '我的翻译' }] }
  ] }
  let finish!: (value: string[]) => void
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: {
    fetch: vi.fn().mockResolvedValue({ syncedLyrics: '[00:01.00]喜んで会いに行くから', source: 'test', transient: true }),
    romanize: () => new Promise<string[]>(resolve => { finish = resolve })
  } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: baseline, library: { [track.id]: baseline },
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection()
  cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  expect(useAppStore.getState().lyrics?.offsetMs).toBe(2300)
  expect(useAppStore.getState().lyrics?.tracks).toContain(baseline.tracks[0])
  expect(useAppStore.getState().library[track.id]).toBe(baseline)
  finish(['yorokonde ai ni iku kara'])
  await vi.advanceTimersByTimeAsync(0)
  expect(useAppStore.getState().lyrics?.tracks.some(item => item.kind === 'romanization')).toBe(true)
  expect(useAppStore.getState().lyrics?.offsetMs).toBe(2300)
  expect(useAppStore.getState().lyrics?.tracks).toContain(baseline.tracks[0])
  expect(useAppStore.getState().library[track.id]).toBe(baseline)
})
