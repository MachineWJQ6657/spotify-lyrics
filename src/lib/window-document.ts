import type { LyricsDocument } from '../types'

/** Auxiliary renderers need the current view, never a second full library. */
export function receiveWindowDocument(primary: boolean, library: Record<string, LyricsDocument>, current: LyricsDocument | null, incoming: LyricsDocument, currentTrackId?: string) {
  return {
    library: primary ? { ...library, [incoming.trackId]: incoming } : {},
    lyrics: incoming.trackId === currentTrackId ? incoming : current,
  }
}
