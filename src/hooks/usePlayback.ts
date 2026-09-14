import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { detectLyricsLanguage, makeRomanizedTrack, makeTrack } from '../lib/lyrics'
import type { LyricTrack, LyricsDocument, PlaybackSnapshot } from '../types'

const containsJapanese = (value: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(value)
// Revision 28 rechecks edition identity and monotonic supplemental alignment,
// and replaces automatic local-* tracks previously mistaken for user imports.
// Revision 27 lets a three-source timing quorum reject a globally shifted
// exact-metadata timeline and keeps partial provider generations retryable.
// Revision 26 adds a conservative artist/duration fallback for Spotify titles
// localized into a different script. Revision 25 rejects impossible recording-duration matches. Revision 24
// invalidated exact-provider timelines that silently omitted short repeated
// outro refrains; revision 23 covered translated rewrites and collaboration
// releases whose producer credit exists only in album aliases.
const LYRICS_PROVIDER_REVISION = 34
// Maps a provider context to the retry token of its one allowed automatic
// recovery generation. Token ownership prevents a stale async continuation
// from clearing (or re-arming) a newer generation's guard.
const transientRetryTokens = new Map<string, number>()
const lastRequestRetryTokenByTrack = new Map<string, number>()

export interface ProviderRequestIdentity {
  trackId: string
  durationBucket: number
  providerContext: string
  retryToken: number
}

export function lyricsProviderContext(connected: boolean, spotifyTrackId: string | undefined, durationBucket: number) {
  return `${connected ? 'spotify-oauth' : 'community'}:${connected ? spotifyTrackId ?? '' : ''}:${durationBucket}`
}

export function providerRequestMatches(request: ProviderRequestIdentity, current: ProviderRequestIdentity | null) {
  return Boolean(current
    && current.trackId === request.trackId
    && current.durationBucket === request.durationBucket
    && current.providerContext === request.providerContext
    && current.retryToken === request.retryToken)
}

export function shouldBypassProviderCache(previousRetryToken: number | undefined, currentRetryToken: number) {
  return previousRetryToken !== undefined && currentRetryToken > previousRetryToken
}

export function isUserOwnedTrack(track: LyricTrack, baseline: LyricsDocument) {
  return Boolean(baseline.userEditedTrackIds?.includes(track.id)
    || (track.id.startsWith('local-') && !track.id.startsWith(`${baseline.trackId}-`)))
}

export function mergeUserEditedTracks(providerTracks: LyricTrack[], baseline?: LyricsDocument | null) {
  if (!baseline?.tracks.length) return providerTracks
  const preserved = baseline.tracks.filter(track => isUserOwnedTrack(track, baseline))
  if (!preserved.length) return providerTracks
  const conflicts = new Set(preserved.map(track => `${track.kind}\0${track.language}`))
  return [...providerTracks.filter(track => !conflicts.has(`${track.kind}\0${track.language}`)), ...preserved]
}

/** Carries edit ownership only for tracks that survived the provider merge. */
export function preservedUserEditedTrackIds(tracks: LyricTrack[], baseline?: LyricsDocument | null) {
  if (!baseline?.userEditedTrackIds?.length) return undefined
  const retainedTrackIds = new Set(tracks.map(track => track.id))
  const retainedEdits = baseline.userEditedTrackIds.filter(trackId => retainedTrackIds.has(trackId))
  return retainedEdits.length ? retainedEdits : undefined
}
const needsRomanizationRepair = (value: string) => {
  if (containsJapanese(value)) return true
  const tokens = value.trim().split(/\s+/).filter(Boolean)
  return (tokens.length >= 5 && tokens.filter(token => /^[a-z]$/i.test(token)).length >= 2) || (tokens.length === 1 && tokens[0].length > 20)
}

export function romanizationNeedsRepair(original: LyricTrack, romanization?: LyricTrack) {
  if (!romanization?.lines.length || !original.lines.length) return true
  const covered = matchedSupplementalLineCount(original, romanization, 1600)
  return covered / original.lines.length < .96 || romanization.lines.some(line => needsRomanizationRepair(line.text)
    || line.words?.some(word => needsRomanizationRepair(word.text)))
}

/**
 * Counts a monotonic one-to-one timestamp alignment. Independent nearest-line
 * checks let one sparse romanization row falsely "cover" several rapid source
 * rows, which is exactly how half-complete provider tracks escaped repair.
 */
export function matchedSupplementalLineCount(original: LyricTrack, supplemental: LyricTrack, toleranceMs: number) {
  let cursor = 0
  let matched = 0
  for (const sourceLine of original.lines) {
    while (cursor < supplemental.lines.length && supplemental.lines[cursor].startMs < sourceLine.startMs - toleranceMs) cursor += 1
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = cursor; index < supplemental.lines.length; index += 1) {
      const candidate = supplemental.lines[index]
      if (candidate.startMs > sourceLine.startMs + toleranceMs) break
      const distance = Math.abs(candidate.startMs - sourceLine.startMs)
      if (distance < bestDistance) {
        bestIndex = index
        bestDistance = distance
      }
    }
    if (bestIndex < 0) continue
    matched += 1
    cursor = bestIndex + 1
  }
  return matched
}

/**
 * SMTC can publish a new title one event before its timeline end arrives. A
 * zero-duration provider request cannot be usefully version-matched and may
 * finish after the real request, so wait for the first positive duration.
 */
export function providerDurationBucket(durationMs: number | undefined, playbackSource?: PlaybackSnapshot['playbackSource'], transitionResolved?: boolean) {
  // Do not make network latency wait for Spotify's private transition-state
  // reader. A positive SMTC duration may begin the existing 320ms coalescing
  // window while transition discovery continues. If title/duration ownership
  // changes, trackId or this bucket changes and cancels the stale renderer
  // request; a newly discovered sourceDuration uses a different provider key.
  // Keep the parameters for the pure regression API and future source-specific
  // policy even though readiness now depends only on a usable duration.
  void playbackSource
  void transitionResolved
  if (!Number.isFinite(durationMs) || !durationMs || durationMs <= 0) return undefined
  return Math.max(2000, Math.round(durationMs / 2000) * 2000)
}

export function effectiveProviderDurationBucket(durationMs: number | undefined, allowDurationless: boolean, playbackSource?: PlaybackSnapshot['playbackSource'], transitionResolved?: boolean) {
  return providerDurationBucket(durationMs, playbackSource, transitionResolved) ?? (allowDurationless ? 0 : undefined)
}

export async function completeRomanization(original: ReturnType<typeof makeTrack>, tracks: ReturnType<typeof makeTrack>[]) {
  const romanization = tracks.find(track => track.kind === 'romanization')
  if (romanization && !romanizationNeedsRepair(original, romanization)) return tracks
  const generated = await window.syllable.lyrics.romanize(original.lines.map(line => line.text))
  if (!romanization) {
    const fallback = makeRomanizedTrack(original)
    return [...tracks, { ...fallback, source: 'Kuroshiro · Kuromoji', lines: fallback.lines.map((line, index) => ({ ...line, words: undefined, text: generated[index]?.replace(/\s+/g, ' ').trim() || line.text })) }]
  }
  const repaired = original.lines.map((line, index) => ({
    ...line, words: undefined,
    text: generated[index]?.replace(/\s+/g, ' ').trim() || line.text
  }))
  return tracks.map(track => track.id === romanization.id ? { ...track, source: `${track.source} · 自动补全`, lines: repaired } : track)
}

export function usePlaybackConnection(loadLyrics = true, hydrateCachedLyrics = true) {
  const {
    connected, demoMode, setConnected, setLocalConnected, setDemoMode, setPlayback,
    setLyrics, setTransientLyrics, retryTransientLyrics
  } = useAppStore()

  useEffect(() => {
    let alive = true
    window.syllable.auth.status().then(async ({ connected, localConnected }) => {
      if (!alive) return
      setConnected(connected)
      setLocalConnected(Boolean(localConnected))
      if (connected || localConnected) {
        setDemoMode(false)
        setPlayback(await window.syllable.playback.current())
      }
    })
    const unsubscribe = window.syllable.playback.onUpdate(value => {
      if (!alive || (value && 'error' in value)) return
      if (value?.playbackSource === 'local') {
        setLocalConnected(true); setDemoMode(false); setPlayback(value); return
      }
      if (value === null) { setLocalConnected(false); if (!demoMode) setPlayback(null); return }
      if (demoMode) return
      setPlayback(value as PlaybackSnapshot | null)
    })
    return () => { alive = false; unsubscribe() }
  }, [demoMode, setConnected, setLocalConnected, setPlayback])

  const trackId = useAppStore(state => state.playback?.track?.id)
  const spotifyTrackId = useAppStore(state => state.playback?.track?.spotifyId)
  const lyricsDurationMs = useAppStore(state => state.playback?.track
    ? state.playback.track.sourceDurationMs ?? state.playback.track.durationMs
    : undefined)
  const playbackSource = useAppStore(state => state.playback?.playbackSource)
  const transitionResolved = useAppStore(state => state.playback?.transitionResolved)
  const lyricsRetryToken = useAppStore(state => state.lyricsRetryToken)
  // Community providers never use Spotify's internal track id. Keeping that
  // id out of the dependency prevents transition discovery from cancelling
  // and restarting the same network request a few milliseconds after launch.
  const providerSpotifyId = connected ? spotifyTrackId : undefined
  const nativeLyricsDurationBucket = providerDurationBucket(lyricsDurationMs, playbackSource, transitionResolved)
  const [durationlessTrackId, setDurationlessTrackId] = useState<string | null>(null)
  useEffect(() => {
    // Readiness belongs to this continuous zero-duration observation, not just
    // the text identity. Clear a stale allowance when playback disappears,
    // changes, or regains a real duration so revisiting the same song cannot
    // inherit an old immediate durationless request.
    setDurationlessTrackId(null)
    if (!loadLyrics || !trackId || nativeLyricsDurationBucket != null) return
    const timer = window.setTimeout(() => setDurationlessTrackId(trackId), 4_000)
    return () => window.clearTimeout(timer)
  }, [loadLyrics, trackId, nativeLyricsDurationBucket])
  const lyricsDurationBucket = effectiveProviderDurationBucket(
    lyricsDurationMs,
    durationlessTrackId === trackId,
    playbackSource,
    transitionResolved
  )
  useEffect(() => {
    const state = useAppStore.getState()
    if (!loadLyrics) {
      if (hydrateCachedLyrics) setLyrics(trackId ? state.library[trackId] ?? null : null)
      return
    }
    const track = state.playback?.track
    if (state.demoMode || !track) return
    // A title-only SMTC transition snapshot commonly reports duration=0 for
    // a few hundred milliseconds. Waiting here prevents a second full
    // three-provider request and guarantees that only the version-matched
    // result can populate the library.
    if (lyricsDurationBucket == null) {
      const cached = state.library[track.id]
      if (cached?.tracks.length) setTransientLyrics({ ...cached })
      return
    }
    // Community lyrics still use Spotify's zero-based transport. Transition
    // discovery may later refine sourceDuration; its bucket change cancels this
    // effect and starts the correctly keyed lookup without allowing the stale
    // result to populate the document.
    let cancelled = false
    // A short quiet period also coalesces the final native duration event. Any
    // intervening track/duration/transition update cancels this callback, so a
    // stale request cannot win even on Spotify builds with an unusual event
    // order.
    let transientRetryTimer: number | undefined
    let scheduledTransientRetry: { key: string; token: number } | undefined
    let inheritedTransientRetry: { key: string; token: number } | undefined
    const settleTimer = setTimeout(() => {
      const latest = useAppStore.getState()
      const latestTrack = latest.playback?.track
      const latestDuration = latestTrack?.sourceDurationMs ?? latestTrack?.durationMs
      const latestBucket = effectiveProviderDurationBucket(
        latestDuration,
        durationlessTrackId === latestTrack?.id,
        latest.playback?.playbackSource,
        latest.playback?.transitionResolved
      )
      if (cancelled || latest.demoMode || !latestTrack || latestTrack.id !== trackId || latestBucket !== lyricsDurationBucket
        || latest.connected !== connected || latest.lyricsRetryToken !== lyricsRetryToken) return
      const providerContext = lyricsProviderContext(connected, providerSpotifyId, lyricsDurationBucket)
      const requestIdentity: ProviderRequestIdentity = {
        trackId: latestTrack.id,
        durationBucket: lyricsDurationBucket,
        providerContext,
        retryToken: lyricsRetryToken
      }
      const currentRequestIdentity = (): ProviderRequestIdentity | null => {
        const current = useAppStore.getState()
        const currentTrack = current.playback?.track
        const duration = currentTrack?.sourceDurationMs ?? currentTrack?.durationMs
        const durationBucket = effectiveProviderDurationBucket(
          duration,
          durationlessTrackId === currentTrack?.id,
          current.playback?.playbackSource,
          current.playback?.transitionResolved
        )
        if (current.demoMode || !currentTrack || durationBucket == null) return null
        return {
          trackId: currentTrack.id,
          durationBucket,
          providerContext: lyricsProviderContext(current.connected, current.connected ? currentTrack.spotifyId : undefined, durationBucket),
          retryToken: current.lyricsRetryToken
        }
      }
      const requestIsCurrent = () => !cancelled && providerRequestMatches(requestIdentity, currentRequestIdentity())
      const cached = latest.library[latestTrack.id]
      if (cached?.tracks.length && cached.providerRevision === LYRICS_PROVIDER_REVISION && cached.providerContext === providerContext) {
        // Render the known-good original immediately. Romanizer startup can
        // take seconds and must never blank an otherwise valid cached lyric.
        const cachedView = { ...cached }
        setTransientLyrics(cachedView)
        const cachedGeneration = useAppStore.getState().lyrics
        const original = cached.tracks.find(item => item.kind === 'original')
        const romanization = cached.tracks.find(item => item.kind === 'romanization')
        if (original?.language === 'ja' && !(romanization && isUserOwnedTrack(romanization, cached)) && romanizationNeedsRepair(original, romanization)) {
          void completeRomanization(original, cached.tracks).then(tracks => {
            const current = useAppStore.getState()
            if (!requestIsCurrent() || current.lyrics !== cachedGeneration || current.library[latestTrack.id] !== cached) return
            setLyrics({ ...cached, tracks, updatedAt: Date.now(), providerRevision: LYRICS_PROVIDER_REVISION })
          }).catch(() => { /* keep the already-rendered original */ })
        }
        return
      }
      const retryKey = `${latestTrack.id}\0${providerContext}`
      if (transientRetryTokens.get(retryKey) === requestIdentity.retryToken) {
        inheritedTransientRetry = { key: retryKey, token: requestIdentity.retryToken }
      }
      // Preserve a usable same-song view during refresh. This is especially
      // important for a user-imported translation when one provider times out.
      const existingView = latest.lyrics?.trackId === latestTrack.id && latest.lyrics.tracks.length
        ? latest.lyrics
        : cached?.tracks.length ? cached : null
      setTransientLyrics(existingView)
      const requestBaseline = useAppStore.getState().lyrics
      let transientGeneration: LyricsDocument | null = null
      const previousRequestRetryToken = lastRequestRetryTokenByTrack.get(latestTrack.id)
      const bypassProviderCache = shouldBypassProviderCache(previousRequestRetryToken, lyricsRetryToken)
      lastRequestRetryTokenByTrack.set(latestTrack.id, lyricsRetryToken)
      if (lastRequestRetryTokenByTrack.size > 80) lastRequestRetryTokenByTrack.delete(lastRequestRetryTokenByTrack.keys().next().value!)
      const releaseInheritedRetry = () => {
        if (!inheritedTransientRetry) return
        if (transientRetryTokens.get(inheritedTransientRetry.key) === inheritedTransientRetry.token) {
          transientRetryTokens.delete(inheritedTransientRetry.key)
        }
        inheritedTransientRetry = undefined
      }
      const scheduleTransientRetry = () => {
        if (transientRetryTokens.get(retryKey) === requestIdentity.retryToken) {
          // This was the one bounded retry. Release the session guard so a
          // later revisit can recover, but do not start an immediate loop.
          releaseInheritedRetry()
          return
        }
        if (transientRetryTokens.size >= 80) transientRetryTokens.delete(transientRetryTokens.keys().next().value!)
        const expectedRetryToken = requestIdentity.retryToken + 1
        transientRetryTokens.set(retryKey, expectedRetryToken)
        scheduledTransientRetry = { key: retryKey, token: expectedRetryToken }
        transientRetryTimer = window.setTimeout(() => {
          transientRetryTimer = undefined
          scheduledTransientRetry = undefined
          const current = useAppStore.getState()
          if (!requestIsCurrent() || current.lyrics !== transientGeneration) {
            if (transientRetryTokens.get(retryKey) === expectedRetryToken) transientRetryTokens.delete(retryKey)
            return
          }
          // Keep both the last-good library entry and the visible partial
          // generation while the retry runs.
          retryTransientLyrics()
        }, 12_000)
      }
      const commit = (document: LyricsDocument, transient: boolean) => {
        const current = useAppStore.getState()
        if (!requestIsCurrent() || current.lyrics !== requestBaseline) {
          releaseInheritedRetry()
          return null
        }
        if (!transient) {
          setLyrics({ ...document, ...(requestBaseline?.offsetMs != null ? { offsetMs: requestBaseline.offsetMs } : {}) })
          releaseInheritedRetry()
          return useAppStore.getState().lyrics
        }
        // Never persist a transient empty/partial generation over a usable
        // library entry. Empty failures retain the previous visible lyrics.
        const visibleDocument = document.tracks.length || !requestBaseline?.tracks.length ? document : requestBaseline
        setTransientLyrics(visibleDocument)
        transientGeneration = useAppStore.getState().lyrics
        scheduleTransientRetry()
        return transientGeneration
      }
      window.syllable.lyrics.fetch(latestTrack, { bypassCache: bypassProviderCache }).then(async result => {
        if (!requestIsCurrent()) return
        if (!result?.syncedLyrics) {
          const emptyDocument: LyricsDocument = {
            trackId: latestTrack.id, track: latestTrack, tracks: [], updatedAt: Date.now(),
            providerRevision: result?.transient ? undefined : LYRICS_PROVIDER_REVISION, providerContext
          }
          if (result?.transient) commit(emptyDocument, true)
          else {
            const current = useAppStore.getState()
            if (!requestIsCurrent() || current.lyrics !== requestBaseline) return
            // A definitive miss is view state, not a reason to destroy a
            // previously useful or user-edited library document.
            setTransientLyrics(requestBaseline?.tracks.length ? requestBaseline : emptyDocument)
            releaseInheritedRetry()
          }
          return
        }
        const language = detectLyricsLanguage(result.syncedLyrics)
        const label = language === 'ja' ? '日本語' : language === 'zh-Hans' ? '中文原文' : language === 'en' ? 'English' : 'Original'
        const original = makeTrack(`${latestTrack.id}-original`, language, label, 'original', result.syncedLyrics, result.source)
        let providerTracks = [original, ...(result.additionalTracks ?? []).map((item, index) =>
          makeTrack(`${latestTrack.id}-${item.language}-${index}`, item.language, item.label, item.kind, item.syncedLyrics, item.source)
        )]
        let tracks = mergeUserEditedTracks(providerTracks, requestBaseline)
        const providerDocument: LyricsDocument = {
          trackId: latestTrack.id, track: latestTrack, tracks,
          sourceDurationMs: (result.confidence ?? 0) >= 78 ? result.matchedDurationMs : undefined,
          updatedAt: Date.now(), providerRevision: result.transient ? undefined : LYRICS_PROVIDER_REVISION, providerContext,
          userEditedTrackIds: preservedUserEditedTrackIds(tracks, requestBaseline)
        }
        // Show/persist the original and provider translations before the
        // Japanese analyzer finishes. A slow worker no longer creates a
        // 20-second blank screen.
        const committedGeneration = commit(providerDocument, Boolean(result.transient))
        if (!committedGeneration || language !== 'ja') return
        const keepsUserRomanization = requestBaseline?.tracks.some(track => track.kind === 'romanization'
          && isUserOwnedTrack(track, requestBaseline))
        if (keepsUserRomanization) return
        try {
          providerTracks = await completeRomanization(original, providerTracks)
          tracks = mergeUserEditedTracks(providerTracks, requestBaseline)
        } catch {
          if (!tracks.some(item => item.kind === 'romanization')) tracks = [...tracks, makeRomanizedTrack(original)]
        }
        const current = useAppStore.getState()
        if (!requestIsCurrent() || current.lyrics !== committedGeneration) return
        const enriched = {
          ...providerDocument,
          ...(committedGeneration.offsetMs != null ? { offsetMs: committedGeneration.offsetMs } : {}),
          tracks,
          updatedAt: Date.now()
        }
        if (result.transient) {
          setTransientLyrics(enriched)
          transientGeneration = useAppStore.getState().lyrics
        } else setLyrics(enriched)
      }).catch(() => {
        // IPC/main-process failures are transient too. Marking this empty
        // document as the current revision would permanently suppress retry.
        commit({ trackId: latestTrack.id, track: latestTrack, tracks: [], updatedAt: Date.now(), providerRevision: undefined, providerContext }, true)
      })
    }, 320)
    return () => {
      cancelled = true
      clearTimeout(settleTimer)
      if (transientRetryTimer != null) {
        clearTimeout(transientRetryTimer)
        transientRetryTimer = undefined
        if (scheduledTransientRetry && transientRetryTokens.get(scheduledTransientRetry.key) === scheduledTransientRetry.token) {
          transientRetryTokens.delete(scheduledTransientRetry.key)
        }
      }
      if (inheritedTransientRetry && transientRetryTokens.get(inheritedTransientRetry.key) === inheritedTransientRetry.token) {
        transientRetryTokens.delete(inheritedTransientRetry.key)
      }
    }
  }, [trackId, providerSpotifyId, lyricsDurationBucket, lyricsRetryToken, connected, loadLyrics, hydrateCachedLyrics, setLyrics, setTransientLyrics, setDemoMode, retryTransientLyrics])
}
