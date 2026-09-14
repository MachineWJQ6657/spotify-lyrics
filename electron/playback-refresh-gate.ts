/** A late response must not replace a newer request or native observation. */
export class PlaybackRefreshGate {
  private generation = 0

  invalidate() { this.generation++ }

  async refresh<T>(read: () => Promise<T>, publish: (value: T) => void) {
    const generation = ++this.generation
    try {
      const value = await read()
      if (generation !== this.generation) return false
      publish(value)
      return true
    } catch (error) {
      if (generation !== this.generation) return false
      throw error
    }
  }
}
