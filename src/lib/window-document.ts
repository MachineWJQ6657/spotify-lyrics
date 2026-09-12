import type { LyricsDocument } from '../types'

export function snapshotOwnsTrack(currentTrackId: string | null, snapshotTrackId: string | null, document: LyricsDocument | null | undefined) {
  return currentTrackId === snapshotTrackId && document !== undefined
    && (document === null || document.trackId === currentTrackId)
}

/** Auxiliary renderers need the current view, never a second full library. */
export function receiveWindowDocument(primary: boolean, library: Record<string, LyricsDocument>, current: LyricsDocument | null, incoming: LyricsDocument, currentTrackId?: string) {
  return {
    library: primary ? { ...library, [incoming.trackId]: incoming } : {},
    lyrics: incoming.trackId === currentTrackId ? incoming : current,
  }
}
