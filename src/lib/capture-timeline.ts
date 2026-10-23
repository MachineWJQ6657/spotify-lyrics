/** Map a continuous AudioContext sample clock to wall time ONCE per stream.
 * Re-estimating each block independently with Date.now() introduces scheduling
 * and render-quantum jitter: contiguous PCM can look overlapping to a resolver.
 * Gaps/device suspension/wall-clock jumps must reset, never stretch audio. */
export class CaptureTimeline {
  private originMs: number | null = null
  private lastEnd = -1
  reset() { this.originMs = null; this.lastEnd = -1 }

  timestamp(start: number, end: number, contextNow: number, wallNow = Date.now()): number | null {
    if (![start, end, contextNow, wallNow].every(Number.isFinite) || start < 0 || end <= start
      || contextNow - end > 1.5 || end - contextNow > .2 || start < this.lastEnd - .00001) return null
    const observedOrigin = wallNow - contextNow * 1000
    if (this.originMs !== null && Math.abs(observedOrigin - this.originMs) > 75) return null
    this.originMs ??= observedOrigin
    this.lastEnd = end
    return this.originMs + end * 1000
  }
}
