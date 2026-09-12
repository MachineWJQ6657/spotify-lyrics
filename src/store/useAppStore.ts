import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import type { AppSettings, LyricLine, LyricTrack, LyricsDocument, PlaybackSnapshot } from '../types'
import { createDemoPlayback, demoDocument } from '../data/demo'
import { retimeLines } from '../lib/lyrics'

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
  deleteLibraryDocument(trackId: string): void
  retryCurrentLyrics(): void
  /** Re-runs provider lookup without deleting the last usable document. */
  retryTransientLyrics(): void
  setEditorOpen(value: boolean): void
  patchSettings(value: Partial<AppSettings>): void
  startDemo(): void
}

const defaults: AppSettings = {
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
  let previousSettings: AppSettings | undefined
  let previousLibrary: Record<string, LyricsDocument> | undefined
  return {
    getItem(name) {
      const raw = storage.getItem(name)
      if (!raw) return null
      const value = JSON.parse(raw) as StorageValue<PersistedAppState>
      previousSettings = value.state?.settings
      previousLibrary = value.state?.library
      return value
    },
    setItem(name, value) {
      if (value.state.settings === previousSettings && value.state.library === previousLibrary) return
      previousSettings = value.state.settings
      previousLibrary = value.state.library
      storage.setItem(name, JSON.stringify(value))
    },
    removeItem(name) {
      previousSettings = undefined
      previousLibrary = undefined
      storage.removeItem(name)
    }
  }
}

const persistentStorage = typeof window !== 'undefined' ? createReferenceDeduplicatingStorage(window.localStorage) : undefined

const compactDocument = (document: LyricsDocument): LyricsDocument => document.track?.coverUrl.startsWith('data:image')
  ? { ...document, track: { ...document.track, coverUrl: '' } }
  : document

const compactLibrary = (library: Record<string, LyricsDocument>) => Object.fromEntries(
  Object.entries(library)
    .sort(([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .map(([id, document]) => [id, compactDocument(document)])
)

const putLibraryDocument = (library: Record<string, LyricsDocument>, document: LyricsDocument) => Object.fromEntries(
  Object.entries({ ...library, [document.trackId]: compactDocument(document) })
    .sort(([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
)

export const useAppStore = create<AppState>()(persist((set) => ({
  connected: false,
  localConnected: false,
  // Auxiliary windows are born before the native Spotify clock has finished
  // its startup stabilization. Avoid flashing the demo song in the desktop
  // overlay during those first frames; the main client keeps its useful demo.
  demoMode: !isAuxiliaryWindow,
  playback: isAuxiliaryWindow ? null : createDemoPlayback(),
  lyrics: isAuxiliaryWindow ? null : demoDocument,
  library: {}, settings: defaults, editorOpen: false, lyricsRetryToken: 0,
  setConnected: connected => set(state => state.connected === connected ? state : { connected }),
  setLocalConnected: localConnected => set(state => state.localConnected === localConnected ? state : { localConnected }),
  setDemoMode: demoMode => set(state => state.demoMode === demoMode ? state : { demoMode }),
  setPlayback: playback => set(state => {
    if (playback && state.playback && playback.observedAtMs < state.playback.observedAtMs && playback.track?.id === state.playback.track?.id) return state
    if (playback?.track && state.playback?.track?.id === playback.track.id) {
      return { playback: { ...playback, track: {
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
    return { playback }
  }),
  setLyrics: lyrics => set(state => {
    const compacted = lyrics ? compactDocument(lyrics) : null
    return {
      lyrics: compacted,
      library: compacted && compacted.trackId !== demoDocument.trackId ? putLibraryDocument(state.library, compacted) : state.library
    }
  }),
  setTransientLyrics: lyrics => set(state => {
    const compacted = lyrics ? compactDocument(lyrics) : null
    return state.lyrics === compacted ? state : { lyrics: compacted }
  }),
  addLyricTrack: track => set(state => {
    if (!state.lyrics) return state
    const document = {
      ...state.lyrics,
      tracks: [...state.lyrics.tracks.filter(item => item.id !== track.id && item.language !== track.language), track],
      userEditedTrackIds: [...new Set([...(state.lyrics.userEditedTrackIds ?? []), track.id])],
      updatedAt: Date.now()
    }
    return { lyrics: document, library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  removeLyricTrack: trackId => set(state => {
    if (!state.lyrics) return state
    const document = { ...state.lyrics, tracks: state.lyrics.tracks.filter(track => track.id !== trackId), updatedAt: Date.now() }
    return { lyrics: document, library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  updateLyricLine: (trackId, lineIndex, patch) => set(state => {
    if (!state.lyrics) return state
    const tracks = state.lyrics.tracks.map(track => {
      if (track.id !== trackId) return track
      const lines = track.lines.map((line, index) => index === lineIndex ? { ...line, ...patch } : line).sort((a, b) => a.startMs - b.startMs)
      return { ...track, lines: lines.map((line, index) => ({ ...line, endMs: lines[index + 1]?.startMs })) }
    })
    const document = { ...state.lyrics, tracks, userEditedTrackIds: [...new Set([...(state.lyrics.userEditedTrackIds ?? []), trackId])], updatedAt: Date.now() }
    return { lyrics: document, library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  shiftLyricTrack: (trackId, deltaMs) => set(state => {
    if (!state.lyrics) return state
    const document = {
      ...state.lyrics,
      tracks: state.lyrics.tracks.map(track => track.id === trackId ? { ...track, lines: retimeLines(track.lines, deltaMs) } : track),
      userEditedTrackIds: [...new Set([...(state.lyrics.userEditedTrackIds ?? []), trackId])],
      updatedAt: Date.now()
    }
    return { lyrics: document, library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  setLyricsOffset: offsetMs => set(state => {
    if (!state.lyrics) return state
    const document = { ...state.lyrics, offsetMs: Math.max(-30_000, Math.min(30_000, Math.round(offsetMs))), updatedAt: Date.now() }
    return { lyrics: document, library: document.trackId === demoDocument.trackId ? state.library : putLibraryDocument(state.library, document) }
  }),
  deleteLibraryDocument: trackId => set(state => {
    const library = { ...state.library }
    delete library[trackId]
    return { library }
  }),
  retryCurrentLyrics: () => set(state => {
    const trackId = state.playback?.track?.id
    if (!trackId) return { lyricsRetryToken: state.lyricsRetryToken + 1, lyrics: null }
    const library = { ...state.library }
    delete library[trackId]
    return { library, lyrics: null, lyricsRetryToken: state.lyricsRetryToken + 1 }
  }),
  retryTransientLyrics: () => set(state => ({ lyricsRetryToken: state.lyricsRetryToken + 1 })),
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
