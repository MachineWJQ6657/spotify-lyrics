import type { LyricsCandidate, PlaybackSnapshot, TrackInfo } from './types'

interface SyllableApi {
  auth: { status(): Promise<{ connected: boolean; localConnected?: boolean }>; login(clientId: string): Promise<{ connected: boolean }>; logout(): Promise<{ connected: boolean }> }
  playback: {
    current(): Promise<PlaybackSnapshot | null>
    exportDiagnostics(context: import('./lib/sync-diagnostics').LyricDiagnosticContext): Promise<boolean>
    command(command: 'play' | 'pause' | 'next' | 'previous'): Promise<{
      accepted: boolean
      action: 'play' | 'pause' | 'next' | 'previous' | 'seek-to-zero' | null
      pending: boolean
    }>
    seek(positionMs: number): Promise<void>
    onUpdate(callback: (value: PlaybackSnapshot | null | { error: string }) => void): () => void
  }
  lyrics: {
    fetch(track: TrackInfo, options?: { bypassCache?: boolean }): Promise<{
      syncedLyrics: string | null; plainLyrics: string | null; source: string; confidence?: number; matchedDurationMs?: number; transient?: boolean
      additionalTracks?: Array<{ language: string; label: string; kind: 'translation' | 'romanization'; syncedLyrics: string; source: string }>
    } | null>
    search(query: { track: string; artist: string; album?: string; durationMs?: number }): Promise<LyricsCandidate[]>
    romanize(lines: string[]): Promise<string[]>
    export(filename: string, content: string): Promise<string | null>
  }
  overlay: {
    show(): Promise<boolean>; hide(): Promise<boolean>; setClickThrough(value: boolean): Promise<boolean>; setHitRegions(regions: Array<{ x: number; y: number; width: number; height: number }>, controlsAnchor?: { x: number; y: number }): Promise<boolean>
    setControlsHover(hovered: boolean): void
    getBounds(): Promise<{ x: number; y: number; width: number; height: number }>
    setSize(width: number, height: number): Promise<{ x: number; y: number; width: number; height: number }>
    beginMove(): void
    moveTo(x: number, y: number): void
    endMove(): void
    setPosition(position: 'top' | 'center' | 'bottom'): Promise<{ x: number; y: number; width: number; height: number }>
    resetPosition(): Promise<{ x: number; y: number; width: number; height: number }>
    setMovable(value: boolean): Promise<boolean>
    onBoundsChanged(callback: (bounds: { x: number; y: number; width: number; height: number }) => void): () => void
    onVisibilityChanged(callback: (visible: boolean) => void): () => void
    onClickThroughChanged(callback: (value: boolean) => void): () => void
  }
  window: { show(): Promise<boolean>; minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void> }
  meta: { redirectUri: string }
}

declare global { interface Window { syllable: SyllableApi } }
export {}
