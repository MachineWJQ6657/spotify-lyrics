/** Reject overlapping mutations rather than queueing stale playback intent. */
export class PlaybackRequestGate {
  private busy = false

  async run<T>(operation: () => Promise<T>): Promise<{ accepted: true; value: T } | { accepted: false }> {
    if (this.busy) return { accepted: false }
    this.busy = true
    try {
      return { accepted: true, value: await operation() }
    } finally {
      this.busy = false
    }
  }
}
