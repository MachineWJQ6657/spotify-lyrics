import { useEffect, useRef, useState } from 'react'
import type { PlaybackSnapshot } from '../types'
import { TransportClock } from '../lib/clock'

export function usePosition(playback: PlaybackSnapshot | null, refreshMs = 100) {
  const clock = useRef(new TransportClock())
  const [position, setPosition] = useState(0)
  useEffect(() => { clock.current.update(playback); setPosition(clock.current.position()) }, [playback])
  useEffect(() => {
    if (!playback?.isPlaying) return
    const timer = window.setInterval(() => setPosition(clock.current.position()), refreshMs)
    return () => window.clearInterval(timer)
  }, [playback?.isPlaying, refreshMs])
  return position
}
