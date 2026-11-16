/**
 * When the pointer over the lyrics means "show me the control bar".
 *
 * Touching the lyrics used to be enough (after 350 ms, and only while they
 * were locked): a pointer crossing the overlay on its way to another window,
 * or left parked over it while the user typed or read underneath, popped the
 * bar up over the desktop. The bar now waits for the pointer to come to rest
 * on the lyrics after moving there, and a pointer that then stays still for a
 * while puts it away again until it moves.
 */
export interface HoverIntent {
  /** A cursor position has been seen (inside or outside the lyrics). */
  seen: boolean
  /** The pointer is over the lyrics (last sample). */
  inside: boolean
  /** Where it came to rest, and since when it has stayed within the radius, inside or outside. */
  anchorX: number
  anchorY: number
  restSince: number
  /** It moved onto or over the lyrics since it was last outside them or put away for idleness. */
  armed: boolean
}

/** Resting this long after moving over the lyrics shows the bar. */
export const HOVER_REST_MS = 500
/** Movement within this radius (DIP) is still resting: a hand on the mouse jitters. */
export const HOVER_REST_RADIUS = 6
/** A pointer parked this long over the lyrics puts the bar away until it moves again. */
export const HOVER_IDLE_MS = 2500

/** Nothing known yet: the first sample sets where the pointer is, and does not count as a movement. */
export const HOVER_OUTSIDE: HoverIntent = { seen: false, inside: false, anchorX: 0, anchorY: 0, restSince: 0, armed: false }

export interface HoverIntentResult {
  state: HoverIntent
  /** The pointer has rested over the lyrics after moving there: the bar may open. */
  ready: boolean
  /** The pointer has been parked over the lyrics: an open bar may close. */
  idle: boolean
}

export function advanceHoverIntent(previous: HoverIntent, now: number, cursor: { x: number; y: number }, over: boolean): HoverIntentResult {
  // Movement is the pointer's own: the lyric region also grows, shrinks and
  // reappears under a pointer parked on it (a longer line, the title card,
  // playing again after hiding while paused), and that is not a reach for it.
  const moved = !previous.seen || Math.hypot(cursor.x - previous.anchorX, cursor.y - previous.anchorY) > HOVER_REST_RADIUS
  const anchored = moved ? { anchorX: cursor.x, anchorY: cursor.y, restSince: now } : { anchorX: previous.anchorX, anchorY: previous.anchorY, restSince: previous.restSince }
  if (!over) return { state: { seen: true, inside: false, ...anchored, armed: false }, ready: false, idle: false }
  const state: HoverIntent = { seen: true, inside: true, ...anchored, armed: previous.armed && previous.inside || (moved && previous.seen) }
  const rested = now - state.restSince
  const idle = rested >= HOVER_IDLE_MS
  // Once idle, the bar stays away until the pointer moves (which re-arms it).
  const settled: HoverIntent = idle && state.armed ? { ...state, armed: false } : state
  return { state: settled, ready: settled.armed && rested >= HOVER_REST_MS, idle }
}
