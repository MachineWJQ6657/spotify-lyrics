import { describe, expect, it } from 'vitest'
import { createReferenceDeduplicatingStorage, useAppStore } from './useAppStore'
import type { LyricsDocument } from '../types'

describe('application-state persistence', () => {
  it('does not serialize unchanged settings and lyrics library on playback-only updates', () => {
    const values = new Map<string, string>()
    let writes = 0
    const backend = {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { writes += 1; values.set(name, value) },
      removeItem: (name: string) => { values.delete(name) }
    } as unknown as Storage
    const storage = createReferenceDeduplicatingStorage(backend)
    const settings = { overlayVisible: true }
    const library = { song: { trackId: 'song' } }
    const first = { state: { settings, library } } as unknown as Parameters<typeof storage.setItem>[1]

    storage.setItem('preferences', first)
    storage.setItem('preferences', { state: { settings, library } } as unknown as Parameters<typeof storage.setItem>[1])
    expect(writes).toBe(1)

    storage.setItem('preferences', { state: { settings: { ...settings }, library } } as unknown as Parameters<typeof storage.setItem>[1])
    expect(writes).toBe(2)
  })

  it('does not notify the UI for repeated connection flags or no-op setting patches', () => {
    const before = useAppStore.getState()
    let notifications = 0
    const unsubscribe = useAppStore.subscribe(() => { notifications += 1 })
    before.setConnected(before.connected)
    before.setLocalConnected(before.localConnected)
    before.setDemoMode(before.demoMode)
    before.setEditorOpen(before.editorOpen)
    before.patchSettings({ fontSize: before.settings.fontSize, overlayVisible: before.settings.overlayVisible })
    unsubscribe()
    expect(notifications).toBe(0)
    expect(useAppStore.getState()).toBe(before)
  })

  it('keeps transient provider generations out of the persistent lyrics library', () => {
    const before = useAppStore.getState()
    const library = before.library
    const document: LyricsDocument = { trackId: 'transient-test', tracks: [], updatedAt: 123 }
    before.setTransientLyrics(document)
    expect(useAppStore.getState().lyrics).toEqual(document)
    expect(useAppStore.getState().library).toBe(library)
    useAppStore.setState({ lyrics: before.lyrics, library })
  })

  it('retries a transient lookup without deleting the last good document', () => {
    const before = useAppStore.getState()
    const token = before.lyricsRetryToken
    const library = before.library
    const lyrics = before.lyrics
    before.retryTransientLyrics()
    const after = useAppStore.getState()
    expect(after.lyricsRetryToken).toBe(token + 1)
    expect(after.library).toBe(library)
    expect(after.lyrics).toBe(lyrics)
    useAppStore.setState({ lyricsRetryToken: token })
  })
})
