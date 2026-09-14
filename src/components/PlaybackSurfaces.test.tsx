import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlaybackSnapshot } from '../types'
import { usePosition } from '../hooks/usePosition'
import { ClockedLyricsEditor, ClockedLyricsStage, ClockedPlayerBar } from './PlaybackSurfaces'

vi.mock('../hooks/usePosition', () => ({ usePosition: vi.fn(() => 10_000) }))
vi.mock('./LyricsStage', () => ({ LyricsStage: ({ positionMs }: { positionMs: number }) => <output>{positionMs}</output> }))
vi.mock('./LyricsEditor', () => ({ LyricsEditor: ({ positionMs }: { positionMs: number }) => <output>{positionMs}</output> }))
vi.mock('./PlayerBar', () => ({ PlayerBar: ({ position }: { position: number }) => <output>{position}</output> }))

beforeEach(() => vi.clearAllMocks())
const playback: PlaybackSnapshot = { track: null, positionMs: 10_000, observedAtMs: 1_000, isPlaying: true,
  transition: { kind: 'spotify-mix', title: 'test', cuePointMs: 0, speedAutomation: [{ fromPositionMs: 0, speed: .95 }] } }

describe('isolated playback surfaces', () => {
  it('keeps main lyrics and editor on the same calibrated recording clock', () => {
    const props = { playback, document: null, offsetMs: 500 }
    expect(renderToStaticMarkup(<ClockedLyricsStage {...props} enabled={['ja']} romanization />)).toBe('<output>9000</output>')
    expect(renderToStaticMarkup(<ClockedLyricsEditor {...props} />)).toBe('<output>9000</output>')
    expect(usePosition).toHaveBeenCalledTimes(2)
    expect(usePosition).toHaveBeenCalledWith(playback, 160)
  })

  it('keeps playback controls on the unmodified Spotify transport clock', () => {
    expect(renderToStaticMarkup(<ClockedPlayerBar playback={playback} demoMode={false} />)).toBe('<output>10000</output>')
    expect(usePosition).toHaveBeenCalledOnce()
  })
})
