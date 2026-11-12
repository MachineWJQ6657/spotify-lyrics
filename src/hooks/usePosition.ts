import { useEffect, useRef, useState } from 'react'
import type { PlaybackSnapshot } from '../types'
import { TransportClock } from '../lib/clock'

declare global {
  interface Window {
    /** Inert unless a bounded internal performance QA explicitly opts in. */
    __syllablePositionProbe?: { ticks: number; samples: number }
  }
}

/**
 * Visual transport position, re-rendered while playing and visible.
 *
 * Without `nextDueMs` it ticks every `refreshMs` (progress bars, the editor).
 * With it, `refreshMs` is only the longest wait: the hook asks how many ms
 * remain until the display next changes (a line or word boundary) and wakes
 * just after it, so a line switches on time instead of up to one tick late,
 * and a line without word timing costs a couple of renders per second.
 */
export function usePosition(playback: PlaybackSnapshot | null, refreshMs = 100, nextDueMs?: (positionMs: number) => number | undefined) {
  const clock = useRef(new TransportClock())
  const nextDue = useRef(nextDueMs)
  nextDue.current = nextDueMs
  const plan = useRef<() => void>(() => {})
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
    let timeout: number | undefined
    let disposed = false
    let visibilityRevision = 0
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer)
      if (timeout !== undefined) window.clearTimeout(timeout)
      timer = undefined; timeout = undefined
      plan.current = () => {}
    }
    const refreshVisibility = () => {
      stop()
      if (document.visibilityState === 'hidden' || nativeVisible.current !== true) return
      // Project the latest observation immediately. Reopening after a minute
      // must not replay missed ticks or wait for a fresh Spotify sample.
      setPosition(clock.current.position())
      if (!playback?.isPlaying) return
      if (nextDue.current) {
        const tick = () => {
          timeout = undefined
          const probe = window.__syllablePositionProbe
          if (probe) probe.ticks += 1
          setPosition(clock.current.position())
          // A tick that changes nothing visible may not re-render; plan anyway.
          plan.current()
        }
        plan.current = () => {
          if (timeout !== undefined) window.clearTimeout(timeout)
          const due = nextDue.current?.(clock.current.position())
          // +2 ms lands just after the boundary; 4 ms floor avoids a busy loop.
          const delay = due === undefined || !Number.isFinite(due) ? refreshMs : Math.max(4, Math.min(refreshMs, Math.ceil(due) + 2))
          timeout = window.setTimeout(tick, delay)
        }
        plan.current()
      } else timer = window.setInterval(() => {
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
  // Boundary mode re-plans after every render: new lyrics, an offset change or
  // a fresh transport sample can move the next boundary.
  useEffect(() => { plan.current() })
  return position
}
