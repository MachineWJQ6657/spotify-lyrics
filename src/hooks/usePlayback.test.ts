import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeRomanization, preserveLyricsCalibration } from './usePlayback'
import type { LyricTrack } from '../types'
import { effectiveProviderDurationBucket, lyricsProviderContext, matchedSupplementalLineCount, mergeUserEditedTracks, preservedUserEditedTrackIds, providerDurationBucket, providerRequestMatches, romanizationNeedsRepair, shouldBypassProviderCache } from './usePlayback'

const original: LyricTrack = {
  id: 'ja', language: 'ja', label: '日本語', kind: 'original', source: 'test',
  lines: [0, 2000, 4000, 6000].map((startMs, index) => ({ startMs, text: `日本語${index}` }))
}

describe('romanization completeness', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not retain stale kana-only word fragments after generating complete readings', async () => {
    const timed: LyricTrack = { ...original, lines: [{ startMs: 1000, endMs: 4000, text: '喜んで会いに行くから',
      words: [{ startMs: 1000, text: '喜んで' }, { startMs: 2000, text: '会いに' }, { startMs: 3000, text: '行くから' }] }] }
    vi.stubGlobal('window', { syllable: { lyrics: { romanize: async () => ['yorokonde ai ni iku kara'] } } })
    const result = await completeRomanization(timed, [timed])
    const romanized = result.find(track => track.kind === 'romanization')!
    expect(romanized.lines[0]).toMatchObject({ startMs: 1000, endMs: 4000, text: 'yorokonde ai ni iku kara' })
    expect(romanized.lines[0].words).toBeUndefined()
    expect(result[0]).toBe(timed)
    expect(timed.lines[0].words).toHaveLength(3)
  })
  it('repairs a provider track that omits original lines', () => {
    const partial: LyricTrack = {
      id: 'roma', language: 'romaji', label: 'Romaji', kind: 'romanization', source: 'test',
      lines: [{ startMs: 0, text: 'nihongo' }, { startMs: 2000, text: 'nihongo' }]
    }
    expect(romanizationNeedsRepair(original, partial)).toBe(true)
  })

  it('keeps a complete clean provider track', () => {
    const complete: LyricTrack = {
      id: 'roma', language: 'romaji', label: 'Romaji', kind: 'romanization', source: 'test',
      lines: original.lines.map(line => ({ startMs: line.startMs, text: 'nihongo desu' }))
    }
    expect(romanizationNeedsRepair(original, complete)).toBe(false)
    const staleWords: LyricTrack = { ...complete, lines: complete.lines.map(line => ({ ...line, words: [{ startMs: line.startMs, text: '日本語' }] })) }
    expect(romanizationNeedsRepair(original, staleWords)).toBe(true)
  })

  it('does not let one sparse row claim several rapid source lines', () => {
    const rapidOriginal: LyricTrack = {
      ...original,
      lines: [0, 1000, 2000, 3000].map((startMs, index) => ({ startMs, text: `日本語${index}` }))
    }
    const sparse: LyricTrack = {
      id: 'sparse', language: 'romaji', label: 'Romaji', kind: 'romanization', source: 'test',
      lines: [500, 2500].map(startMs => ({ startMs, text: 'nihongo desu' }))
    }
    expect(matchedSupplementalLineCount(rapidOriginal, sparse, 1600)).toBe(2)
    expect(romanizationNeedsRepair(rapidOriginal, sparse)).toBe(true)
  })
})

describe('provider refresh preserves user tracks', () => {
  it('keeps calibration on partial responses, including an explicit zero offset', () => {
    const partial = { trackId: 'song', tracks: [original], providerRevision: undefined }
    expect(preserveLyricsCalibration(partial, { trackId: 'song', tracks: [], offsetMs: 2300 }).offsetMs).toBe(2300)
    expect(preserveLyricsCalibration({ ...partial, offsetMs: 1000 }, { trackId: 'song', tracks: [], offsetMs: 0 }).offsetMs).toBe(0)
    expect(preserveLyricsCalibration(partial, { trackId: 'previous-song', tracks: [], offsetMs: 2300 })).toBe(partial)
    expect(partial).not.toHaveProperty('offsetMs')
  })
  it('refreshes auto-generated local Spotify tracks but preserves explicit edits', () => {
    const trackId = 'local-1234567890abcdefabcd'
    const stale = { ...original, id: `${trackId}-original` }
    const fresh = { ...stale, lines: [{ startMs: 900, text: 'corrected timeline' }] }
    expect(mergeUserEditedTracks([fresh], { trackId, tracks: [stale] })).toEqual([fresh])
    expect(mergeUserEditedTracks([fresh], { trackId, tracks: [stale], userEditedTrackIds: [stale.id] })).toEqual([stale])
  })
  it('keeps a locally imported translation ahead of the provider equivalent', () => {
    const provider: LyricTrack[] = [
      original,
      { id: 'provider-zh', language: 'zh-Hans', label: '中文', kind: 'translation', source: 'provider', lines: [{ startMs: 0, text: 'provider' }] }
    ]
    const local: LyricTrack = {
      id: 'local-import', language: 'zh-Hans', label: '中文', kind: 'translation', source: 'mine.lrc', lines: [{ startMs: 0, text: 'user' }]
    }
    const merged = mergeUserEditedTracks(provider, { trackId: 'song', tracks: [local], userEditedTrackIds: [local.id] })
    expect(merged.find(track => track.language === 'zh-Hans')).toBe(local)
    expect(merged.some(track => track.id === 'provider-zh')).toBe(false)
    expect(merged.some(track => track.id === original.id)).toBe(true)
  })

  it('retains an explicitly edited provider timeline on refresh', () => {
    const edited = { ...original, id: 'edited-original', lines: [{ startMs: 750, text: 'edited' }] }
    const merged = mergeUserEditedTracks([original], { trackId: 'song', tracks: [edited], userEditedTrackIds: [edited.id] })
    expect(merged).toEqual([edited])
    expect(preservedUserEditedTrackIds(merged, { trackId: 'song', tracks: [edited], userEditedTrackIds: [edited.id, 'removed-track'] }))
      .toEqual([edited.id])
  })

  it('drops stale edit ownership when its track no longer exists', () => {
    expect(preservedUserEditedTrackIds([original], { trackId: 'song', tracks: [original], userEditedTrackIds: ['removed-track'] }))
      .toBeUndefined()
  })
})

describe('lyrics request stabilization', () => {
  it('waits through the zero-duration snapshot emitted at a track boundary', () => {
    expect(providerDurationBucket(undefined)).toBeUndefined()
    expect(providerDurationBucket(0)).toBeUndefined()
    expect(providerDurationBucket(Number.NaN)).toBeUndefined()
    expect(effectiveProviderDurationBucket(0, false)).toBeUndefined()
    expect(effectiveProviderDurationBucket(0, true)).toBe(0)
  })

  it('lets a positive local duration begin lookup while transition metadata resolves', () => {
    expect(providerDurationBucket(242_182, 'local', false)).toBe(242_000)
    expect(providerDurationBucket(242_182, 'local', undefined)).toBe(242_000)
    expect(providerDurationBucket(242_182, 'local', true)).toBe(242_000)
  })

  it('coalesces a valid duration into a two-second provider bucket', () => {
    expect(providerDurationBucket(234_741)).toBe(234_000)
    expect(providerDurationBucket(235_120)).toBe(236_000)
  })

  it('rejects stale results after any request-identity component changes', () => {
    const request = {
      trackId: 'song-a', durationBucket: 242_000,
      providerContext: lyricsProviderContext(true, 'spotify-a', 242_000), retryToken: 7
    }
    expect(providerRequestMatches(request, { ...request })).toBe(true)
    expect(providerRequestMatches(request, { ...request, trackId: 'song-b' })).toBe(false)
    expect(providerRequestMatches(request, { ...request, durationBucket: 244_000 })).toBe(false)
    expect(providerRequestMatches(request, { ...request, providerContext: lyricsProviderContext(false, undefined, 242_000) })).toBe(false)
    expect(providerRequestMatches(request, { ...request, retryToken: 8 })).toBe(false)
    expect(providerRequestMatches(request, null)).toBe(false)
  })

  it('bypasses stable provider cache only after a retry token advances', () => {
    expect(shouldBypassProviderCache(undefined, 0)).toBe(false)
    expect(shouldBypassProviderCache(3, 3)).toBe(false)
    expect(shouldBypassProviderCache(3, 4)).toBe(true)
  })
})
