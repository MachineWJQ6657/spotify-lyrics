import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { LIBRARY_BUDGET_CHARS, pruneLibrary } from '../lib/library-budget'
import { mergeLibraryBackup } from '../lib/library-backup'
import type { AppSettings, ListenedOffset, LyricLine, LyricTrack, LyricsDocument, LyricsSourceId, PlaybackSnapshot, SessionCalibration } from '../types'
import { continuesCalibration, createSessionCalibration, currentSessionCalibration, originalTimingKey } from '../lib/session-calibration'
import { createDemoPlayback, demoDocument } from '../data/demo'
import { retimeLines } from '../lib/lyrics'
import { listenTimingKey } from '../lib/listened-offset'
import { isUserOwnedTrack } from '../lib/user-tracks'

/**
 * A user's edit of the original keeps the listening result that belonged to
 * it. The result is keyed to the lines' times and words, so any edit used to
 * drop it and the lyrics jumped by the whole listened offset: with +850 ms
 * listened, a "+100ms" nudge showed every line 750 ms earlier, and fixing one
 * word did the same.
 */
/**
 * The same for a "跟歌声校准" session: it is keyed to the exact original, so the
 * editor's "取当前" stamp or a 100 ms nudge ended it, and the line just stamped
 * on the calibrated clock was shown off by the whole session offset.
 */
function carrySessionCalibration(session: SessionCalibration | null, before: LyricsDocument, after: LyricsDocument): SessionCalibration | null {
  const was = before.tracks.find(track => track.kind === 'original')
  const now = after.tracks.find(track => track.kind === 'original')
  if (!session || !was || !now || was === now || was.id !== now.id || session.trackId !== before.trackId || session.originalKey !== originalTimingKey(before)) return session
  return { ...session, originalKey: originalTimingKey(after) }
}

function carryListenedOffset(before: LyricsDocument, after: LyricsDocument): LyricsDocument {
  const listened = before.listenedOffset
  const was = before.tracks.find(track => track.kind === 'original')
  const now = after.tracks.find(track => track.kind === 'original')
  if (!listened || listened.state !== 'decided' || !was || !now || was === now || was.id !== now.id || listenTimingKey(was) !== listened.timingKey) return after
  return { ...after, listenedOffset: { ...listened, timingKey: listenTimingKey(now) } }
}

interface AppState {
  connected: boolean
  localConnected: boolean
  demoMode: boolean
  playback: PlaybackSnapshot | null
  lyrics: LyricsDocument | null
  library: Record<string, LyricsDocument>
  settings: AppSettings
  editorOpen: boolean
  lyricsRetryToken: number
  /** The retry token of the latest source switch: that lookup re-ranks known provider results. */
  sourceSwitchToken: number | null
  /** The song that source switch was for: the tokens are app-wide, the switch is not. */
  sourceSwitchTrackId?: string | null
  sessionCalibration: SessionCalibration | null
  calibrateHeardLine(originalTrackId: string, lineIndex: number, now?: number): void
  clearSessionCalibration(): void
  setConnected(value: boolean): void
  setLocalConnected(value: boolean): void
  setDemoMode(value: boolean): void
  setPlayback(value: PlaybackSnapshot | null): void
  setLyrics(value: LyricsDocument | null): void
  /** Updates the current view without replacing the persistent lyrics library. */
  setTransientLyrics(value: LyricsDocument | null): void
  addLyricTrack(track: LyricTrack): void
  removeLyricTrack(trackId: string): void
  updateLyricLine(trackId: string, lineIndex: number, patch: Partial<LyricLine>): void
  shiftLyricTrack(trackId: string, deltaMs: number): void
  setLyricsOffset(offsetMs: number): void
  /** Stores an automatic listening calibration for a song (current view and library). */
  setListenedOffset(trackId: string, value: ListenedOffset | null): void
  deleteLibraryDocument(trackId: string): void
  /** Puts a just-deleted document back (library undo). */
  restoreLibraryDocument(document: LyricsDocument): void
  /** Adds a backup's songs: new ones are added, newer copies replace, the rest stay. The song on screen is left alone. */
  importLibrary(documents: LyricsDocument[]): { added: number; updated: number; kept: number }
  retryCurrentLyrics(): void
  /** Picks the provider for the current song's timed original (null = automatic) and looks it up again. */
  setLyricsSource(source: LyricsSourceId | null, chosenBy?: 'user' | 'listening'): void
  /** Records what listening found for one provider's timeline of a song. */
  recordSourceTrial(trackId: string, source: LyricsSourceId, verdict: 'consistent' | 'inconsistent' | 'unmeasurable'): void
  /** Forgets listening's per-source verdicts for a song ("立即重新校准"). */
  clearSourceTrials(trackId: string): void
  /** Re-runs provider lookup without deleting the last usable document. */
  retryTransientLyrics(): void
  /** Runs the lookup again for the same song after its answer was dropped because the document changed meanwhile. */
  rerunLyricsLookup(): void
  setEditorOpen(value: boolean): void
  patchSettings(value: Partial<AppSettings>): void
  startDemo(): void
}

const defaults: AppSettings = {
  automaticAudioSync: false,
  enabledLanguages: ['ja', 'romaji', 'zh-Hans'], romanization: true, offsetMs: 0,
  fontSize: 52, alignment: 'left', overlayVisible: false, clickThrough: false, blur: 18,
  overlayWidth: 820, overlayHeight: 220, backgroundEnabled: false, backgroundOpacity: 78,
  textOpacity: 100, textEffect: 'shadow', textColor: 'white', fontWeight: 760, lineHeight: 122,
  cornerRadius: 16, positionLocked: false
}

// The overlay and its tiny controls window share live state with the main
// renderer. Hydrating the complete persisted lyrics library in all three
// renderer contexts needlessly triples JSON parsing and heap use, so auxiliary
// windows deliberately keep an in-memory store and receive their state over
// BroadcastChannel instead.
const isAuxiliaryWindow = typeof window !== 'undefined' && /^#\/overlay(?:-controls)?$/.test(window.location.hash)
type PersistedAppState = Pick<AppState, 'settings' | 'library'>
const memoryOnlyStorage: PersistStorage<PersistedAppState> = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
}

/**
 * Zustand's persist middleware calls storage after every state update, even
 * when `partialize` removes the changing playback snapshot. Its default JSON
 * adapter therefore serialized and wrote the complete lyrics library roughly
 * once per second. Compare the two persisted references before stringify so
 * transport ticks remain memory-only while genuine settings/library edits are
 * still committed immediately.
 */
export function createReferenceDeduplicatingStorage(storage: Storage): PersistStorage<PersistedAppState> {
  let previousName: string | undefined
  let previousVersion: number | undefined
  let previousSettings: AppSettings | undefined
  let previousLibrary: Record<string, LyricsDocument> | undefined
  let serializedLibrary: string | undefined
  let hasSerializedLibrary = false
  const reset = () => {
    previousName = undefined
    previousVersion = undefined
    previousSettings = undefined
    previousLibrary = undefined
    serializedLibrary = undefined
    hasSerializedLibrary = false
  }
  // Keep the legacy single-key JSON format, but do not walk every lyric line
  // again while the user drags a settings slider. Only immutable library
  // replacements require a new library fragment; localStorage writes remain
  // synchronous so closing the client cannot discard a pending setting.
  const appendJsonField = (object: string, key: string, value: string | undefined) => value === undefined
    ? object
    : `${object.slice(0, -1)}${object.length > 2 ? ',' : ''}"${key}":${value}}`
  return {
    getItem(name) {
      const raw = storage.getItem(name)
      if (!raw) { reset(); return null }
      const value = JSON.parse(raw) as StorageValue<PersistedAppState>
      previousName = name
      previousVersion = value.version
      previousSettings = value.state?.settings
      previousLibrary = value.state?.library
      // Hydration already parsed the library. Do not stringify it a second
      // time until a real edit needs a write; transport-only updates skip it.
      serializedLibrary = undefined
      hasSerializedLibrary = false
      return value
    },
    setItem(name, value) {
      if (name === previousName && value.version === previousVersion
        && value.state.settings === previousSettings && value.state.library === previousLibrary) return
      const library = value.state.library
      const libraryJson = hasSerializedLibrary && library === previousLibrary
        ? serializedLibrary
        : JSON.stringify(library)
      const stateJson = appendJsonField(JSON.stringify({ ...value.state, library: undefined }), 'library', libraryJson)
      const serialized = appendJsonField(JSON.stringify({ ...value, state: undefined }), 'state', stateJson)
      // Commit the deduplication marker only after serialization and storage
      // succeed. A failed quota/disk write must remain eligible for retry.
      storage.setItem(name, serialized)
      previousName = name
      previousVersion = value.version
      previousSettings = value.state.settings
      previousLibrary = library
      serializedLibrary = libraryJson
      hasSerializedLibrary = true
    },
    removeItem(name) {
      storage.removeItem(name)
      reset()
    }
  }
}

/**
 * A failed write (storage quota, disk) must not throw into whichever action
 * changed the state: the app keeps running on what it has in memory and the
 * next change tries again. Reported once per run of failures.
 */
export function tolerateWriteFailures(storage: PersistStorage<PersistedAppState>, report: (error: unknown) => void = error => console.error('Syllable could not save its settings and lyrics library:', error)): PersistStorage<PersistedAppState> {
  let failing = false
  return {
    getItem: name => storage.getItem(name),
    removeItem: name => storage.removeItem(name),
    setItem(name, value) {
      try { storage.setItem(name, value); failing = false }
      catch (error) { if (!failing) report(error); failing = true }
    }
  }
}

const persistentStorage = typeof window !== 'undefined' ? tolerateWriteFailures(createReferenceDeduplicatingStorage(window.localStorage)) : undefined

const compactDocument = (document: LyricsDocument): LyricsDocument => document.track?.coverUrl.startsWith('data:image')
  ? { ...document, track: { ...document.track, coverUrl: '' } }
  : document

/** The copy that goes into the saved library: compact, and without view-only state. */
const savedDocument = (document: LyricsDocument): LyricsDocument => {
  const compact = compactDocument(document)
  if (!compact.lookupFailed) return compact
  const saved = { ...compact }
  delete saved.lookupFailed
  return saved
}

// Newest first, and inside the storage budget (see library-budget.ts): the
// oldest automatically fetched songs are dropped and looked up again on their
// next play; imported, edited and hand-timed lyrics stay.
const compactLibrary = (library: Record<string, LyricsDocument>, protect?: string) => Object.fromEntries(pruneLibrary(
  Object.entries(library)
    .sort(([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .map(([id, document]): [string, LyricsDocument] => [id, savedDocument(document)]),
  LIBRARY_BUDGET_CHARS, protect
))

const putLibraryDocument = (library: Record<string, LyricsDocument>, document: LyricsDocument) => Object.fromEntries(pruneLibrary(
  Object.entries({ ...library, [document.trackId]: savedDocument(document) })
    .sort(([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
  LIBRARY_BUDGET_CHARS, document.trackId
))

export const useAppStore = create<AppState>()(persist((set, get) => ({
  connected: false,
  localConnected: false,
  // Auxiliary windows are born before the native Spotify clock has finished
  // its startup stabilization. Avoid flashing the demo song in the desktop
  // overlay during those first frames; the main client keeps its useful demo.
  demoMode: !isAuxiliaryWindow,
  playback: isAuxiliaryWindow ? null : createDemoPlayback(),
  lyrics: isAuxiliaryWindow ? null : demoDocument,
  library: {}, settings: defaults, editorOpen: false, lyricsRetryToken: 0, sourceSwitchToken: null, sessionCalibration: null,
  calibrateHeardLine: (originalTrackId, lineIndex, now = Date.now()) => set(state => ({
    sessionCalibration: createSessionCalibration(state.playback, state.lyrics, originalTrackId, lineIndex, now)
  })),
  clearSessionCalibration: () => set(state => state.sessionCalibration ? { sessionCalibration: null } : state),
  setConnected: connected => set(state => state.connected === connected ? state : { connected }),
  setLocalConnected: localConnected => set(state => state.localConnected === localConnected ? state : { localConnected }),
  setDemoMode: demoMode => set(state => state.demoMode === demoMode ? state : { demoMode }),
  setPlayback: playback => set(state => {
    if (playback && state.playback && playback.observedAtMs < state.playback.observedAtMs && playback.track?.id === state.playback.track?.id) return state
    const sessionCalibration = continuesCalibration(state.playback, playback) ? state.sessionCalibration : null
    if (playback?.track && state.playback?.track?.id === playback.track.id) {
      return { sessionCalibration, playback: { ...playback, track: {
        ...playback.track,
        coverUrl: playback.track.coverUrl || state.playback.track.coverUrl,
        // A resolved local transition deliberately replaces Spotify's brief
        // source-duration flash with its media-session hand-off duration.
        // Keeping Math.max here silently undid that validated correction.
        durationMs: playback.transitionResolved
          ? playback.track.durationMs
          : Math.max(playback.track.durationMs, state.playback.track.durationMs)
      } } }
    }
    return { playback, sessionCalibration }
  }),
  setLyrics: lyrics => set(state => {
    const compacted = lyrics ? compactDocument(lyrics) : null
    return {
      lyrics: compacted,
      sessionCalibration: currentSessionCalibration(state.sessionCalibration, state.playback, compacted),
      library: compacted && compacted.trackId !== demoDocument.trackId ? putLibraryDocument(state.library, compacted) : state.library
    }
  }),
  setTransientLyrics: lyrics => set(state => {
    const compacted = lyrics ? compactDocument(lyrics) : null
    return state.lyrics === compacted ? state : { lyrics: compacted, sessionCalibration: currentSessionCalibration(state.sessionCalibration, state.playback, compacted) }
  }),
  addLyricTrack: track => set(state => {
    // While the automatic lookup is still running there is no document yet:
    // the track starts the playing song's document (the lookup then merges
    // around it) instead of being dropped while the editor reports success.
    const playing = state.demoMode ? null : state.playback?.track
    const current: LyricsDocument | null = state.lyrics ?? (playing ? { trackId: playing.id, track: playing, tracks: [] } : null)
    if (!current) return state
    const document = {
      ...current,
      textReference: track.kind === 'original' ? undefined : current.textReference,
      untimedOriginal: track.kind === 'original' ? undefined : current.untimedOriginal,
      tracks: [...current.tracks.filter(item => item.id !== track.id
        && !(item.kind === track.kind && (track.kind === 'original' || item.language === track.language))), track],
      userEditedTrackIds: [...new Set([...(current.userEditedTrackIds ?? []), track.id])],
      updatedAt: Date.now()
    }
    return { lyrics: document, sessionCalibration: currentSessionCalibration(state.sessionCalibration, state.playback, document), library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  removeLyricTrack: trackId => set(state => {
    if (!state.lyrics) return state
    // The id leaves the edit list too: a provider track that later reuses it
    // (ids are derived from the song and language) must not be taken for the user's.
    const document = { ...state.lyrics, textReference: state.lyrics.tracks.some(track => track.id === trackId && track.kind === 'original') ? undefined : state.lyrics.textReference,
      tracks: state.lyrics.tracks.filter(track => track.id !== trackId),
      userEditedTrackIds: state.lyrics.userEditedTrackIds?.filter(id => id !== trackId), updatedAt: Date.now() }
    return { lyrics: document, sessionCalibration: currentSessionCalibration(state.sessionCalibration, state.playback, document), library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  updateLyricLine: (trackId, lineIndex, patch) => set(state => {
    if (!state.lyrics) return state
    const tracks = state.lyrics.tracks.map(track => {
      if (track.id !== trackId) return track
      const lines = track.lines.map((line, index) => {
        if (index !== lineIndex) return line
        const next = { ...line, ...patch }
        // Word timings belong to the old words and the old start. The rows
        // render their words, so a corrected text kept showing the old one.
        if (line.words && patch.text !== undefined && patch.text !== line.text) delete next.words
        else if (line.words && patch.startMs !== undefined && patch.startMs !== line.startMs) {
          next.words = line.words.map(word => ({ ...word, startMs: Math.max(0, word.startMs + patch.startMs! - line.startMs) }))
        }
        return next
      }).sort((a, b) => a.startMs - b.startMs)
      return { ...track, lines: lines.map((line, index) => ({ ...line, endMs: lines[index + 1]?.startMs })) }
    })
    const document = carryListenedOffset(state.lyrics, { ...state.lyrics, tracks, textReference: state.lyrics.tracks.some(track => track.id === trackId && track.kind === 'original') ? undefined : state.lyrics.textReference,
      userEditedTrackIds: [...new Set([...(state.lyrics.userEditedTrackIds ?? []), trackId])], updatedAt: Date.now() })
    return { lyrics: document, sessionCalibration: currentSessionCalibration(carrySessionCalibration(state.sessionCalibration, state.lyrics, document), state.playback, document), library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  shiftLyricTrack: (trackId, deltaMs) => set(state => {
    if (!state.lyrics) return state
    const document = carryListenedOffset(state.lyrics, {
      ...state.lyrics,
      tracks: state.lyrics.tracks.map(track => track.id === trackId ? { ...track, lines: retimeLines(track.lines, deltaMs) } : track),
      userEditedTrackIds: [...new Set([...(state.lyrics.userEditedTrackIds ?? []), trackId])],
      updatedAt: Date.now()
    })
    return { lyrics: document, sessionCalibration: currentSessionCalibration(carrySessionCalibration(state.sessionCalibration, state.lyrics, document), state.playback, document), library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  setLyricsOffset: offsetMs => set(state => {
    if (!state.lyrics) return state
    const document: LyricsDocument = { ...state.lyrics, offsetMs: Math.max(-30_000, Math.min(30_000, Math.round(offsetMs))), updatedAt: Date.now() }
    // Resetting to zero must also stop an automatic listened offset from applying.
    if (document.offsetMs === 0 && document.listenedOffset?.state === 'decided') document.listenedOffset = { ...document.listenedOffset, state: 'dismissed' }
    return { sessionCalibration: null, lyrics: document, library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  setListenedOffset: (trackId, value) => set(state => {
    const apply = (document: LyricsDocument) => {
      const next = { ...document, updatedAt: Date.now() }
      if (value) next.listenedOffset = value
      else delete next.listenedOffset
      return next
    }
    const stored = state.library[trackId]
    const lyrics = state.lyrics?.trackId === trackId ? apply(state.lyrics) : state.lyrics
    const base = lyrics?.trackId === trackId ? lyrics : stored ? apply(stored) : null
    if (!base) return state
    return { lyrics, library: trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, base) }
  }),
  deleteLibraryDocument: trackId => set(state => {
    const library = { ...state.library }
    delete library[trackId]
    // The song on screen is forgotten as well and looked up afresh. Leaving its
    // view in place let the next offset or listening result write the removed
    // copy back into the library, while the overlay had already dropped it.
    if (state.lyrics?.trackId === trackId && state.playback?.track?.id === trackId && !state.demoMode) {
      return { library, lyrics: null, lyricsRetryToken: state.lyricsRetryToken + 1, sessionCalibration: null }
    }
    return { library }
  }),
  restoreLibraryDocument: document => set(state => {
    // Undo puts back exactly what was removed. For the song on screen that
    // also replaces the copy looked up since the removal.
    const onScreen = state.playback?.track?.id === document.trackId && !state.demoMode
    if (!onScreen) return state.library[document.trackId] ? {} : { library: putLibraryDocument(state.library, document) }
    return { library: putLibraryDocument(state.library, document), lyrics: document, sessionCalibration: null }
  }),
  importLibrary: documents => {
    const state = get()
    const playing = state.demoMode ? undefined : state.playback?.track?.id
    // The song on screen keeps its live copy when it has lyrics: its view
    // writes back to the library. A song that is still being looked up, or was
    // not found, takes the backup's copy and shows it.
    const live = playing && state.lyrics?.trackId === playing && (state.lyrics.tracks.length > 0 || state.lyrics.untimedOriginal) ? playing : undefined
    const usable = documents.filter(document => document.trackId !== live && document.trackId !== demoDocument.trackId)
    const merged = mergeLibraryBackup(state.library, usable)
    if (merged.added || merged.updated) {
      const library = compactLibrary(merged.library, playing)
      const shown = playing && !live ? library[playing] : undefined
      set(shown && shown !== state.library[playing!] ? { library, lyrics: shown, sessionCalibration: null } : { library })
    }
    return { added: merged.added, updated: merged.updated, kept: merged.kept + (documents.length - usable.length) }
  },
  retryCurrentLyrics: () => set(state => {
    const trackId = state.playback?.track?.id
    if (!trackId) return { lyricsRetryToken: state.lyricsRetryToken + 1, lyrics: null }
    const stored = state.library[trackId]
    const baseline = state.lyrics?.trackId === trackId ? state.lyrics : stored
    // Refresh provider data without destroying edits, imports or calibration.
    const pending = baseline ? { ...baseline, providerRevision: undefined } : null
    // Only the saved copy is marked for refresh. The view can be a "not found"
    // placeholder or a partial result of a failed lookup: writing it over the
    // saved copy stored an empty entry, or replaced the last good lyrics.
    const library = stored ? { ...state.library, [trackId]: stored === baseline ? pending! : { ...stored, providerRevision: undefined } } : state.library
    return { library, lyrics: pending, lyricsRetryToken: state.lyricsRetryToken + 1 }
  }),
  setLyricsSource: (source, chosenBy = 'user') => set(state => {
    const track = state.playback?.track
    if (!track || state.demoMode) return state
    const stored = state.library[track.id]
    const baseline = state.lyrics?.trackId === track.id ? state.lyrics : stored
    const now = Date.now()
    const choose = (document: LyricsDocument): LyricsDocument => {
      const next: LyricsDocument = { ...document, providerRevision: undefined, updatedAt: now }
      if (source) { next.sourcePreference = source; next.sourceChosenBy = chosenBy }
      else { delete next.sourcePreference; delete next.sourceChosenBy }
      // A choice in the menu starts over; listening keeps its verdicts so it never retries a source.
      if (chosenBy === 'user') delete next.sourceTrials
      delete next.sourceUnavailable
      // A manual offset was tuned against the previous file's timing. A listened
      // offset carries its own timing key and simply stops applying. The
      // user's own original stays whatever the source is, and so does the
      // offset tuned for it.
      const original = document.tracks.find(item => item.kind === 'original')
      if (!(original?.lines.length && isUserOwnedTrack(original, document))) delete next.offsetMs
      return next
    }
    const pending = choose(baseline ?? { trackId: track.id, track, tracks: [] })
    // The choice is saved on the song's saved copy only. The view can be a
    // "not found" placeholder or a partial result: the lookup reads the choice
    // from the view, and saving the view stored an empty library entry.
    const library = stored ? { ...state.library, [track.id]: stored === baseline ? savedDocument(pending) : choose(stored) } : state.library
    const lyricsRetryToken = state.lyricsRetryToken + 1
    return { library, lyrics: pending, lyricsRetryToken, sourceSwitchToken: lyricsRetryToken, sourceSwitchTrackId: track.id, sessionCalibration: null }
  }),
  recordSourceTrial: (trackId, source, verdict) => set(state => {
    const apply = (document: LyricsDocument): LyricsDocument => ({ ...document, sourceTrials: { ...document.sourceTrials, [source]: verdict } })
    const lyrics = state.lyrics?.trackId === trackId ? apply(state.lyrics) : state.lyrics
    const stored = state.library[trackId]
    return { lyrics, library: stored ? { ...state.library, [trackId]: apply(stored) } : state.library }
  }),
  clearSourceTrials: trackId => set(state => {
    const apply = (document: LyricsDocument): LyricsDocument => { const next = { ...document }; delete next.sourceTrials; return next }
    const lyrics = state.lyrics?.trackId === trackId && state.lyrics.sourceTrials ? apply(state.lyrics) : state.lyrics
    const stored = state.library[trackId]
    return { lyrics, library: stored?.sourceTrials ? { ...state.library, [trackId]: apply(stored) } : state.library }
  }),
  retryTransientLyrics: () => set(state => ({ lyricsRetryToken: state.lyricsRetryToken + 1 })),
  rerunLyricsLookup: () => set(state => {
    const lyricsRetryToken = state.lyricsRetryToken + 1
    // A lookup that was a source switch stays one: provider results are reused and listening keeps waiting for it.
    return state.sourceSwitchToken === state.lyricsRetryToken ? { lyricsRetryToken, sourceSwitchToken: lyricsRetryToken } : { lyricsRetryToken }
  }),
  setEditorOpen: editorOpen => set(state => state.editorOpen === editorOpen ? state : { editorOpen }),
  patchSettings: value => set(state => Object.entries(value).every(([key, next]) => state.settings[key as keyof AppSettings] === next)
    ? state
    : { settings: { ...state.settings, ...value } }),
  startDemo: () => set({ demoMode: true, playback: createDemoPlayback(), lyrics: demoDocument })
}), {
  name: 'syllable-preferences',
  version: 9,
  storage: isAuxiliaryWindow ? memoryOnlyStorage : persistentStorage,
  migrate: (persisted, version) => {
    const state = persisted as { settings?: Partial<AppSettings>; library?: Record<string, LyricsDocument> }
    const settings = { ...defaults, ...state.settings }
    let library = compactLibrary(state.library ?? {})
    if (version < 2) settings.fontSize = Math.max(50, settings.fontSize)
    if (version < 5) settings.overlayVisible = true
    if (version < 6) {
      settings.overlayVisible = true
      settings.clickThrough = false
      settings.positionLocked = false
      settings.backgroundEnabled = false
    }
    if (version < 8) settings.offsetMs = -settings.offsetMs
    // Offset used to be global. Preserve the old visual result for songs that
    // are already in the library, then reset the default for newly seen songs.
    if (version < 9) {
      const previousOffset = settings.offsetMs
      if (previousOffset) library = Object.fromEntries(Object.entries(library).map(([id, document]) => [id, { ...document, offsetMs: document.offsetMs ?? previousOffset }]))
      settings.offsetMs = 0
    }
    return { settings, library }
  },
  partialize: state => ({ settings: state.settings, library: state.library })
}))
