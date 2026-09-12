export interface LyricRowMetrics {
  offsetTop: number
  offsetHeight: number
}

/**
 * Returns the synchronized viewport offset for a lyric row. Before the first
 * timestamp, activeIndex is -1 and the only correct target is the top rather
 * than an absent DOM element.
 */
export function lyricScrollTarget(activeIndex: number, viewportHeight: number, current?: LyricRowMetrics | null) {
  if (activeIndex < 0) return 0
  if (!current) return null
  return Math.max(0, current.offsetTop + current.offsetHeight / 2 - viewportHeight * .44)
}
