import { create } from 'zustand'
import type { LyricsDocument } from '../types'
import { hitTrack, readingDocument, type SongHit } from '../lib/song-reader'
import { makeRomanizedTrack } from '../lib/lyrics'
import { completeRomanization } from '../hooks/usePlayback'

/**
 * The "查歌词" page: a search for songs and the lyrics of the one opened,
 * independent of playback. Nothing here touches the playing song's document
 * or the library; a found song's lyrics live only in this window's memory.
 * Kept in a store (not component state) so the search survives a visit to
 * another page.
 */
export type ReadingStatus = 'loading' | 'ready' | 'missing' | 'failed'

export interface Reading {
  /** The hit's key, or `saved:<trackId>` for a song of the library. */
  key: string
  origin: 'search' | 'library'
  hit?: SongHit
  status: ReadingStatus
  document: LyricsDocument | null
}

interface BrowseState {
  query: string
  /** The query the hits answer ('' before the first search). */
  searchedQuery: string
  hits: SongHit[]
  /** Catalogues that did not answer the last search. */
  failed: string[]
  searching: boolean
  searchError: string
  reading: Reading | null
  setQuery(query: string): void
  search(): Promise<void>
  /** `fresh` looks the song up again instead of showing what this window remembers (the retry button). */
  openHit(hit: SongHit, fresh?: boolean): Promise<void>
  openSaved(document: LyricsDocument): void
  close(): void
}

// A newer search or a newer opened song makes an older answer irrelevant.
let searchSequence = 0
let readSequence = 0
/** Lyrics already looked up in this session, so going back and forth is instant. */
const remembered = new Map<string, LyricsDocument>()
const REMEMBERED_SONGS = 30
const remember = (key: string, document: LyricsDocument) => {
  remembered.delete(key)
  remembered.set(key, document)
  if (remembered.size > REMEMBERED_SONGS) remembered.delete(remembered.keys().next().value!)
}

export const useBrowseStore = create<BrowseState>((set, get) => ({
  query: '', searchedQuery: '', hits: [], failed: [], searching: false, searchError: '', reading: null,
  setQuery: query => {
    if (query.trim()) { set({ query }); return }
    // An emptied box takes the old results with it.
    searchSequence += 1
    set({ query, searchedQuery: '', hits: [], failed: [], searching: false, searchError: '' })
  },
  search: async () => {
    const query = get().query.trim()
    if (!query) return
    const sequence = ++searchSequence
    set({ searching: true, searchError: '' })
    try {
      const result = await window.syllable.lyrics.findSongs(query)
      if (sequence !== searchSequence) return
      set({ hits: result.hits, failed: result.failed, searchedQuery: query, searching: false })
    } catch {
      if (sequence !== searchSequence) return
      set({ hits: [], failed: [], searchedQuery: query, searching: false, searchError: '歌曲搜索暂时没有响应，请稍后再试。' })
    }
  },
  openHit: async (hit, fresh = false) => {
    const sequence = ++readSequence
    const known = fresh ? undefined : remembered.get(hit.key)
    set({ reading: { key: hit.key, origin: 'search', hit, status: known ? 'ready' : 'loading', document: known ?? null } })
    if (known) return
    const show = (status: ReadingStatus, document: LyricsDocument | null) => {
      if (sequence === readSequence) set({ reading: { key: hit.key, origin: 'search', hit, status, document } })
    }
    try {
      // Never `bypassCache` from here: an unfinished or empty answer is not cached
      // anyway, and bypassing drops the provider results of a playing song that
      // happens to share this one's title, performer, album and length.
      const lookup = await window.syllable.lyrics.fetch(hitTrack(hit))
      if (sequence !== readSequence) return
      let document = readingDocument(hit, lookup)
      if (!document) { show(lookup?.transient ? 'failed' : 'missing', null); return }
      show('ready', document)
      const original = document.tracks.find(track => track.kind === 'original')
      if (original?.language === 'ja') {
        // Readings come a moment later; the words are already on screen.
        try {
          const tracks = await completeRomanization(original, document.tracks)
          if (sequence !== readSequence) return
          document = { ...document, tracks }
          show('ready', document)
        } catch {
          // The analyzer is unavailable: kana-only readings, as playback falls back to.
          if (sequence !== readSequence) return
          if (!document.tracks.some(track => track.kind === 'romanization')) {
            document = { ...document, tracks: [...document.tracks, makeRomanizedTrack(original)] }
            show('ready', document)
          }
        }
      }
      if (!lookup?.transient) remember(hit.key, document)
    } catch {
      // The lookup itself failed: the entry's own lyrics are still better than nothing.
      const own = readingDocument(hit, null)
      show(own ? 'ready' : 'failed', own)
    }
  },
  openSaved: document => {
    readSequence += 1
    set({ reading: { key: `saved:${document.trackId}`, origin: 'library', status: 'ready', document } })
  },
  close: () => {
    readSequence += 1
    set({ reading: null })
  }
}))

/** Test seam: forget remembered lyrics and pending requests. */
export function resetBrowseStore() {
  searchSequence += 1
  readSequence += 1
  remembered.clear()
  useBrowseStore.setState({ query: '', searchedQuery: '', hits: [], failed: [], searching: false, searchError: '', reading: null })
}
