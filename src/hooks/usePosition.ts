import { useEffect, useRef, useState } from 'react'
import type { PlaybackSnapshot } from '../types'
import { TransportClock } from '../lib/clock'

declare global {
  interface Window {
    /** Inert unless a bounded internal performance QA explicitly opts in. */
    __syllablePositionProbe?: { ticks: number; samples: number }
  }
}

export function usePosition(playback: PlaybackSnapshot | null, refreshMs = 100) {
  const clock = useRef(new TransportClock())
  const nativeVisible = useRef<boolean | null>(typeof window.syllable?.window?.visibility === 'function' ? null : true)
  const [position, setPosition] = useState(0)
  // Keep every transport observation, including hidden-window seeks/track
  // changes, but do not render a visual clock nobody can currently see.
  useEffect(() => {
    clock.current.update(playback)
    const probe = window.__syllablePositionProbe
    if (probe) probe.samples += 1
    if (document.visibilityState !== 'hidden' && nativeVisible.current === true) setPosition(clock.current.position())
  }, [playback])
  useEffect(() => {
    let timer: number | undefined
    let disposed = false
    let visibilityRevision = 0
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
    }
    const refreshVisibility = () => {
      stop()
      if (document.visibilityState === 'hidden' || nativeVisible.current !== true) return
      // Project the latest observation immediately. Reopening after a minute
      // must not replay missed ticks or wait for a fresh Spotify sample.
      setPosition(clock.current.position())
      if (playback?.isPlaying) timer = window.setInterval(() => {
        const probe = window.__syllablePositionProbe
        if (probe) probe.ticks += 1
        setPosition(clock.current.position())
      }, refreshMs)
    }
    document.addEventListener('visibilitychange', refreshVisibility)
    const nativeWindow = window.syllable?.window
    // Chromium visibility can lag native hide/minimize (and offscreen QA can
    // report visible indefinitely). Native state gates only this visual timer,
    // not the playback store, transport observations, or audio capture.
    const unsubscribe = nativeWindow?.onVisibilityChanged?.(visible => {
      visibilityRevision += 1
      nativeVisible.current = visible
      refreshVisibility()
    })
    if (nativeWindow?.visibility) {
      const queryRevision = visibilityRevision
      void nativeWindow.visibility().then(visible => {
        if (disposed || queryRevision !== visibilityRevision) return
        nativeVisible.current = visible
        refreshVisibility()
      }).catch(() => {
        if (disposed || queryRevision !== visibilityRevision) return
        // A missing/old preload must not strand a visible client. The DOM
        // visibility gate still suspends normal hidden windows.
        nativeVisible.current = true
        refreshVisibility()
      })
    }
    refreshVisibility()
    return () => {
      disposed = true
      unsubscribe?.()
      document.removeEventListener('visibilitychange', refreshVisibility)
      stop()
    }
  }, [playback?.isPlaying, refreshMs])
  return position
}
