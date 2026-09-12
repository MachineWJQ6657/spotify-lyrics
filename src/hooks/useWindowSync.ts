import { useEffect } from 'react'
import type { AppSettings, LyricsDocument } from '../types'
import { useAppStore } from '../store/useAppStore'
import { receiveWindowDocument, snapshotOwnsTrack } from '../lib/window-document'

type SyncMessage =
  | { source: string; type: 'settings'; settings: AppSettings }
  | { source: string; type: 'library-upsert'; document: LyricsDocument }
  | { source: string; type: 'library-remove'; trackId: string }
  | { source: string; type: 'lyrics-view'; trackId: string | null; document: LyricsDocument | null }
  | { source: string; type: 'hello'; wantsLibrary: boolean }
  | { source: string; target: string; type: 'snapshot'; trackId: string | null; settings: AppSettings; document?: LyricsDocument | null }

const instanceId = crypto.randomUUID()
const isPrimaryWindow = window.location.hash !== '#/overlay' && window.location.hash !== '#/overlay-controls'

/** Keeps the independently rendered main and overlay windows in lockstep. */
export function useWindowSync(syncLibrary = true) {
  useEffect(() => {
    const channel = new BroadcastChannel('syllable-window-state-v1')
    let applyingRemote = false
    let receivedSnapshot = isPrimaryWindow
    let acknowledgedTrackId: string | null | undefined
    const requestSnapshot = () => channel.postMessage({ source: instanceId, type: 'hello', wantsLibrary: syncLibrary } satisfies SyncMessage)
    let helloTimer: number | undefined
    const missingCurrentLyrics = () => {
      const state = useAppStore.getState()
      const trackId = state.playback?.track?.id ?? null
      return syncLibrary && acknowledgedTrackId !== trackId && state.lyrics?.trackId !== trackId
    }
    const stopSnapshotRetry = () => {
      if (helloTimer === undefined) return
      window.clearTimeout(helloTimer)
      helloTimer = undefined
    }
    const scheduleSnapshotRetry = () => {
      if (isPrimaryWindow || helloTimer !== undefined) return
      helloTimer = window.setTimeout(() => {
        helloTimer = undefined
        if (receivedSnapshot && !missingCurrentLyrics()) return
        requestSnapshot()
        scheduleSnapshotRetry()
      }, 800)
    }
    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const message = event.data
      if (!message || message.source === instanceId) return
      if (message.type === 'hello') {
        if (!isPrimaryWindow) return
        const state = useAppStore.getState()
        channel.postMessage({
          source: instanceId,
          target: message.source,
          type: 'snapshot',
          trackId: state.playback?.track?.id ?? null,
          settings: state.settings,
          document: message.wantsLibrary ? state.lyrics : undefined
        } satisfies SyncMessage)
        return
      }
      if (message.type === 'snapshot') {
        if (message.target !== instanceId) return
        const currentTrackId = useAppStore.getState().playback?.track?.id ?? null
        const documentMatches = !syncLibrary || snapshotOwnsTrack(currentTrackId, message.trackId, message.document)
        receivedSnapshot = documentMatches
        if (documentMatches) acknowledgedTrackId = currentTrackId
        applyingRemote = true
        useAppStore.setState(state => ({
          settings: message.settings,
          ...(syncLibrary && documentMatches ? {
            library: isPrimaryWindow ? (message.document ? { ...state.library, [message.document.trackId]: message.document } : state.library) : {},
            lyrics: message.document ?? null
          } : {})
        }))
        applyingRemote = false
        if (receivedSnapshot && !missingCurrentLyrics()) stopSnapshotRetry()
        else scheduleSnapshotRetry()
        return
      }
      if (!syncLibrary && message.type !== 'settings') return
      applyingRemote = true
      if (message.type === 'settings') useAppStore.setState({ settings: message.settings })
      else if (message.type === 'lyrics-view') {
        const currentTrackId = useAppStore.getState().playback?.track?.id ?? null
        if (message.trackId === currentTrackId && (!message.document || message.document.trackId === currentTrackId)) {
          useAppStore.setState({ lyrics: message.document })
          receivedSnapshot = true
          acknowledgedTrackId = currentTrackId
          stopSnapshotRetry()
        }
      }
      else if (message.type === 'library-upsert') {
        const currentTrackId = useAppStore.getState().playback?.track?.id
        if (currentTrackId === message.document.trackId) {
          receivedSnapshot = true
          acknowledgedTrackId = currentTrackId
          stopSnapshotRetry()
        }
        useAppStore.setState(state => {
          if (!isPrimaryWindow && message.document.trackId !== currentTrackId && Object.keys(state.library).length === 0) return state
          return receiveWindowDocument(isPrimaryWindow, state.library, state.lyrics, message.document, currentTrackId)
        })
      } else useAppStore.setState(state => {
        const library = { ...state.library }; delete library[message.trackId]
        return { library, lyrics: state.lyrics?.trackId === message.trackId ? null : state.lyrics }
      })
      applyingRemote = false
    }
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (applyingRemote) return
      if (state.settings !== previous.settings) channel.postMessage({ source: instanceId, type: 'settings', settings: state.settings } satisfies SyncMessage)
      if (!isPrimaryWindow && syncLibrary && state.playback?.track?.id !== previous.playback?.track?.id) {
        acknowledgedTrackId = undefined
        receivedSnapshot = state.lyrics?.trackId === state.playback?.track?.id
        if (!receivedSnapshot) {
          requestSnapshot()
          scheduleSnapshotRetry()
        }
      }
      let publishedCurrentDocument = false
      if (syncLibrary && state.library !== previous.library) {
        // The primary owns the library; auxiliary windows only render the
        // current song. Do not clone every imported document into their queues.
        const currentId = state.playback?.track?.id
        const updates = isPrimaryWindow
          ? currentId && state.library[currentId] ? [[currentId, state.library[currentId]] as const] : []
          : Object.entries(state.library)
        for (const [trackId, document] of updates) {
          if (previous.library[trackId] !== document) {
            channel.postMessage({ source: instanceId, type: 'library-upsert', document } satisfies SyncMessage)
            if (document === state.lyrics && trackId === state.playback?.track?.id) publishedCurrentDocument = true
          }
        }
        const removals = isPrimaryWindow ? currentId && previous.library[currentId] ? [currentId] : [] : Object.keys(previous.library)
        for (const trackId of removals) {
          if (!(trackId in state.library)) channel.postMessage({ source: instanceId, type: 'library-remove', trackId } satisfies SyncMessage)
        }
      }
      if (syncLibrary && state.lyrics !== previous.lyrics && !publishedCurrentDocument) {
        channel.postMessage({
          source: instanceId,
          type: 'lyrics-view',
          trackId: state.playback?.track?.id ?? null,
          document: state.lyrics
        } satisfies SyncMessage)
      }
    })
    const unsubscribeVisibility = window.syllable.overlay.onVisibilityChanged(visible => {
      if (useAppStore.getState().settings.overlayVisible !== visible) useAppStore.getState().patchSettings({ overlayVisible: visible })
    })
    const unsubscribeClickThrough = window.syllable.overlay.onClickThroughChanged(clickThrough => {
      if (useAppStore.getState().settings.clickThrough !== clickThrough) useAppStore.getState().patchSettings({ clickThrough })
    })
    if (!isPrimaryWindow) {
      requestSnapshot()
      scheduleSnapshotRetry()
    }
    return () => {
      stopSnapshotRetry()
      unsubscribe(); unsubscribeVisibility(); unsubscribeClickThrough(); channel.close()
    }
  }, [syncLibrary])
}
