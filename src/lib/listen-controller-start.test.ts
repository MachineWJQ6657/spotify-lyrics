import { describe, expect, it } from 'vitest'
import type { LyricsDocument, PlaybackSnapshot } from '../types'

/**
 * "立即重新校准" clears the stored offset (a store change, which queues a
 * reconcile) and also reconciles itself. On the first use of an app run both
 * calls used to pass the "starting" check while the engine was still being
 * asked whether it exists, and two sessions began: the second capture request
 * was refused, both counted as failures, and the song ended at "已经试过两次"
 * with its previous calibration already deleted.
 */
describe('listening session start', () => {
  it('starts one session when the button and the store change arrive together', async () => {
    // The store must load before a `window` exists: with one it expects a browser.
    const { useAppStore } = await import('../store/useAppStore')
    const controller = await import('./listen-controller')
    const { listenTimingKey } = await import('./listened-offset')
    const g = globalThis as unknown as { window?: unknown }
    let prepares = 0, displayRequests = 0, statusCalls = 0
    g.window = { syllable: { audioSync: {
      phonemeStatus: async () => { statusCalls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { available: true } },
      prepare: async () => { prepares += 1; return true },
      clear: async () => true,
      listen: async () => { throw new Error('not reached') }
    } } }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getDisplayMedia: async () => { displayRequests += 1; throw new Error('denied') } } } })

    const track = { id: 'start-song', name: 'n', artist: 'a', album: 'b', coverUrl: '', durationMs: 200_000 }
    const original = { id: 'o', language: 'ja', label: '日本語', kind: 'original' as const, source: 'LRCLIB · 精确匹配',
      lines: Array.from({ length: 12 }, (_, index) => ({ startMs: 10_000 + index * 5000, text: `歌詞の行その${index}` })) }
    const document: LyricsDocument = { trackId: track.id, track, providerRevision: 45, tracks: [original],
      listenedOffset: { timingKey: listenTimingKey(original)!, state: 'decided', offsetMs: 300, measuredDeltaMs: 300, lines: 8, measuredAt: 1 } }
    const before = useAppStore.getState()
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    try {
      useAppStore.setState({ playback: { track, positionMs: 30_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local' } as unknown as PlaybackSnapshot,
        demoMode: false, lyrics: document, library: { [track.id]: document } })
      const disconnect = controller.connectListener()
      await wait(30)
      // Already measured: nothing starts.
      expect(prepares).toBe(0)

      expect(controller.relistenCurrentSong()).toBe(true)
      await wait(80)
      expect(statusCalls).toBe(1)
      expect(prepares).toBe(1)
      expect(displayRequests).toBe(1)
      // One failed start is one attempt: the song can still be tried again.
      expect(controller.currentListenDecision()).toHaveProperty('target')
      disconnect()
    } finally { useAppStore.setState(before) }
  })
})
