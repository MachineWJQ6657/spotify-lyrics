export interface GlideOptions {
  durationMs?: number
  /** Least time between two positions: about 60 a second on any display. */
  frameMs?: number
  now?: () => number
  request?: (callback: () => void) => number
  cancel?: (handle: number) => void
}

/**
 * Moves a scroll container to `top` with an ease-out, writing a new position
 * at most every `frameMs`. Returns a function that stops it where it is.
 *
 * `scrollTo({ behavior: 'smooth' })` animated the lyric list at the display's
 * refresh rate: on a 240 Hz screen each new line drew about 70 frames of the
 * whole window in 0.3 s. Positions 16 ms apart look the same and draw a
 * quarter as many; animation frames that change nothing draw nothing.
 */
export function glideScroll(element: { scrollTop: number }, top: number, options: GlideOptions = {}): () => void {
  const durationMs = options.durationMs ?? 320
  const frameMs = options.frameMs ?? 15
  const now = options.now ?? (() => performance.now())
  const request = options.request ?? (callback => window.requestAnimationFrame(callback))
  const cancel = options.cancel ?? (handle => window.cancelAnimationFrame(handle))
  const from = element.scrollTop
  const distance = top - from
  if (Math.abs(distance) < 1) {
    element.scrollTop = top
    return () => {}
  }
  const start = now()
  let last = start
  let handle = 0
  let stopped = false
  const step = () => {
    if (stopped) return
    const time = now()
    const progress = Math.min(1, (time - start) / durationMs)
    if (progress >= 1 || time - last >= frameMs) {
      last = time
      element.scrollTop = from + distance * (1 - Math.pow(1 - progress, 3))
    }
    if (progress < 1) handle = request(step)
  }
  handle = request(step)
  return () => { stopped = true; cancel(handle) }
}
