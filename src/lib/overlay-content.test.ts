import { describe, expect, it } from 'vitest'
import type { PlaybackSnapshot } from '../types'
import { FIT_START, fitSearchStep, MIN_OVERLAY_FIT, overlayContent } from './overlay-content'

const playback = (name = '春泥棒', artist = 'ヨルシカ') => ({
  track: { id: 't', name, artist, album: '', coverUrl: '', durationMs: 240_000 }, positionMs: 0, observedAtMs: 0, isPlaying: true
}) as unknown as PlaybackSnapshot

describe('overlay content', () => {
  it('shows the active line when there is one', () => {
    expect(overlayContent(playback(), null, { startMs: 1, text: '高架線の上' })).toEqual({ kind: 'lyric' })
    expect(overlayContent(playback(), null, { startMs: 1, text: ' ' })).toEqual({ kind: 'interlude' })
  })
  it('shows title and artist before the first line, while loading, and without lyrics', () => {
    expect(overlayContent(playback(), null, undefined)).toEqual({ kind: 'title', title: '春泥棒', subtitle: 'ヨルシカ' })
    expect(overlayContent(playback(' Song ', ''), { trackId: 't', tracks: [] }, undefined)).toEqual({ kind: 'title', title: 'Song', subtitle: '' })
  })
  it('says an instrumental is one', () => {
    expect(overlayContent(playback('Interlude', 'Band'), { trackId: 't', tracks: [], instrumental: true }, undefined))
      .toEqual({ kind: 'title', title: 'Interlude', subtitle: 'Band · 纯音乐' })
  })
  it('is idle with nothing playing', () => {
    expect(overlayContent(null, null, undefined)).toEqual({ kind: 'idle' })
  })
})

describe('overlay shrink-to-fit', () => {
  // Simulated layout: rows of text wrap at a width, so height is a step function of scale.
  const simulate = (fitsAt: (scale: number) => boolean) => {
    let search = FIT_START, renders = 0
    while (!search.done && renders < 20) { renders++; search = fitSearchStep(search, fitsAt(search.value)) }
    return { value: search.value, renders }
  }
  it('stops at once when the line fits at full size', () => {
    expect(fitSearchStep(FIT_START, true)).toMatchObject({ value: 1, done: true })
  })
  it('finds the largest scale that fits within 2%', () => {
    const { value, renders } = simulate(scale => scale <= .87)
    expect(value).toBeLessThanOrEqual(.87)
    expect(value).toBeGreaterThanOrEqual(.85)
    expect(renders).toBeLessThanOrEqual(7)
  })
  it('does not overshoot when a smaller font drops a whole row', () => {
    // 3 rows above .7 (too tall), 2 rows from .7 down (fits): the answer is about .7, not .64.
    expect(simulate(scale => scale <= .7).value).toBeGreaterThanOrEqual(.68)
  })
  it('settles on the floor when nothing fits', () => {
    expect(simulate(() => false).value).toBe(MIN_OVERLAY_FIT)
  })
})
