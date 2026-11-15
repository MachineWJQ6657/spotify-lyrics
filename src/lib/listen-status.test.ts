import { describe, expect, it } from 'vitest'
import type { LyricsDocument } from '../types'
import { listenTimingKey } from './listened-offset'
import { listenStatus, sourceTrialsSummary } from './listen-status'

const original = { id: 'o', language: 'ja', label: '日本語', kind: 'original' as const, source: 'LRCLIB',
  lines: Array.from({ length: 10 }, (_, index) => ({ startMs: 8000 + index * 4000, text: `行${index}` })) }
const base: LyricsDocument = { trackId: 't', tracks: [original] }
const measured = (state: 'decided' | 'inconsistent' | 'dismissed', offsetMs = 0): LyricsDocument => ({ ...base,
  listenedOffset: { timingKey: listenTimingKey(original), state, offsetMs, measuredDeltaMs: offsetMs + 150, lines: 6, measuredAt: 1 } })
const on = { listening: false, enabled: true, playing: true }

describe('listening calibration status', () => {
  it('reports a finished measurement and offers to run it again', () => {
    expect(listenStatus({ ...on, document: measured('decided', 850), reason: 'already-measured' }))
      .toEqual({ text: '已校准：歌词延后 0.85 秒。', action: '立即重新校准', canRun: true })
    expect(listenStatus({ ...on, document: measured('decided', 0), reason: 'already-measured' }).text).toContain('时间准确')
    expect(listenStatus({ ...on, document: measured('inconsistent'), reason: 'already-measured' }).text).toContain('不一致')
    expect(listenStatus({ ...on, document: measured('dismissed'), reason: 'already-measured' }).canRun).toBe(true)
  })

  it('ignores a measurement of other line timings', () => {
    const stale = { ...measured('decided', 850), listenedOffset: { ...measured('decided', 850).listenedOffset!, timingKey: 'other-file' } }
    expect(listenStatus({ ...on, document: stale })).toMatchObject({ action: '立即校准', canRun: false })
  })

  it('is busy while listening and unavailable when switched off', () => {
    expect(listenStatus({ ...on, listening: true, document: base })).toMatchObject({ canRun: false, text: expect.stringContaining('正在听') })
    expect(listenStatus({ ...on, enabled: false, document: measured('decided', 850) })).toMatchObject({ canRun: false, text: expect.stringContaining('已关闭') })
  })

  it('names what blocks a song even while it is paused', () => {
    expect(listenStatus({ ...on, playing: false, document: base, reason: 'unsupported-language' })).toMatchObject({ canRun: false, text: expect.stringContaining('暂不支持') })
    expect(listenStatus({ ...on, document: null, reason: 'no-lyrics' }).canRun).toBe(false)
    expect(listenStatus({ ...on, document: base, reason: 'too-few-lines' }).canRun).toBe(false)
  })

  it('lets a manual offset or exhausted attempts be replaced by a fresh run', () => {
    expect(listenStatus({ ...on, document: { ...base, offsetMs: -250 }, reason: 'manual-offset' }))
      .toMatchObject({ action: '立即重新校准', canRun: true, text: expect.stringContaining('歌词提前 0.25 秒') })
    expect(listenStatus({ ...on, document: base, reason: 'attempts-exhausted' })).toMatchObject({ action: '立即重新校准', canRun: true })
  })

  it('waits for playback when nothing has been measured yet', () => {
    expect(listenStatus({ ...on, playing: false, document: base })).toMatchObject({ canRun: false, text: expect.stringContaining('播放后') })
    expect(listenStatus({ ...on, document: base })).toMatchObject({ canRun: false, text: expect.stringContaining('马上开始') })
  })

  it('lists the providers listening compared', () => {
    expect(sourceTrialsSummary({ ...base, sourceTrials: { lrclib: 'inconsistent', netease: 'consistent' } })).toBe('已试过的来源：LRCLIB 不一致 · 网易云音乐 一致。')
    expect(sourceTrialsSummary({ ...base, sourceTrials: { kugou: 'unmeasurable', lrclib: 'inconsistent' } })).toBe('已试过的来源：LRCLIB 不一致 · 酷狗音乐 量不出。')
    // The ordinary case, one consistent provider, needs no explanation.
    expect(sourceTrialsSummary({ ...base, sourceTrials: { lrclib: 'consistent' } })).toBe('')
    expect(sourceTrialsSummary(base)).toBe('')
    expect(sourceTrialsSummary(null)).toBe('')
  })

  it('adds the compared providers to the status without changing it otherwise', () => {
    const switched = { ...measured('decided', 300), sourceTrials: { lrclib: 'inconsistent' as const, netease: 'consistent' as const } }
    expect(listenStatus({ ...on, document: switched, reason: 'already-measured' }))
      .toEqual({ text: '已校准：歌词延后 0.30 秒。已试过的来源：LRCLIB 不一致 · 网易云音乐 一致。', action: '立即重新校准', canRun: true })
    const exhausted = { ...base, sourceTrials: { lrclib: 'inconsistent' as const, netease: 'inconsistent' as const, kugou: 'unmeasurable' as const } }
    expect(listenStatus({ ...on, document: exhausted, reason: 'source-inconsistent' }).text)
      .toBe('各个歌词来源测得的偏差都不一致，没有调整。已试过的来源：LRCLIB 不一致 · 网易云音乐 不一致 · 酷狗音乐 量不出。')
    // Blocking states and the busy state keep their own text.
    expect(listenStatus({ ...on, listening: true, document: exhausted }).text).toBe('正在听这首歌，通常需要 25–60 秒。')
  })
})
