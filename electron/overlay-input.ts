export interface OverlayInputPoint { x: number; y: number }
export interface OverlayInputRect extends OverlayInputPoint { width: number; height: number }

export interface OverlayInputSnapshot {
  /** Native bounds/cursor and accepted regions are already logical DIP. */
  bounds: OverlayInputRect
  cursor: OverlayInputPoint
  regions: readonly OverlayInputRect[]
  layoutReady: boolean
  movable: boolean
  clickThrough: boolean
}

export interface OverlayInputState {
  ignoreMouse: boolean
  /** An allowed input target, not locked-toolbar hover geometry. */
  overInteractive: boolean
  pollMs: number
}

export const OVERLAY_INPUT_NEAR_POLL_MS = 24
export const OVERLAY_INPUT_FAR_POLL_MS = 200
export const OVERLAY_INPUT_NEAR_MARGIN = 64
export const OVERLAY_INPUT_RESIZE_EDGE = 8
export const OVERLAY_INPUT_PADDING_X = 10
export const OVERLAY_INPUT_PADDING_Y = 8

const MAX_DIMENSION = 32_768
const MAX_COORDINATE = 131_072
const MAX_REGIONS = 64

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function point(value: OverlayInputPoint) {
  return value != null && finite(value.x) && finite(value.y)
    && Math.abs(value.x) <= MAX_COORDINATE && Math.abs(value.y) <= MAX_COORDINATE
}

function rect(value: OverlayInputRect) {
  return point(value) && finite(value.width) && finite(value.height)
    && value.width > 0 && value.height > 0
    && value.width <= MAX_DIMENSION && value.height <= MAX_DIMENSION
}

/**
 * Input-only policy: never turn text geometry into a native window paint clip.
 *
 * Forwarded mouse movement can update this policy immediately. Polling is only a
 * bounded fallback, including when Chromium does not receive forwarded events.
 * During an acquired pointer/native resize gesture the caller must retain input
 * until release rather than re-evaluating the moving pointer against old text.
 */
export function overlayInputState(snapshot: OverlayInputSnapshot): OverlayInputState {
  const { bounds, cursor } = snapshot
  const ignored = (pollMs = OVERLAY_INPUT_FAR_POLL_MS): OverlayInputState => ({
    ignoreMouse: true, overInteractive: false, pollMs
  })
  if (!rect(bounds) || !point(cursor)) return ignored()

  const x = cursor.x - bounds.x
  const y = cursor.y - bounds.y
  const margin = OVERLAY_INPUT_NEAR_MARGIN
  const near = x >= -margin && y >= -margin
    && x < bounds.width + margin && y < bounds.height + margin
  const pollMs = near ? OVERLAY_INPUT_NEAR_POLL_MS : OVERLAY_INPUT_FAR_POLL_MS

  // Lock, explicit click-through and unmeasured layouts pass every pixel,
  // including native resize borders. Never infer a successful layout here.
  if (snapshot.movable !== true || snapshot.clickThrough !== false || snapshot.layoutReady !== true) return ignored(pollMs)
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return ignored(pollMs)
  if (!Array.isArray(snapshot.regions) || snapshot.regions.length > MAX_REGIONS) return ignored(pollMs)

  const edge = OVERLAY_INPUT_RESIZE_EDGE
  let overInteractive = x < edge || y < edge || x >= bounds.width - edge || y >= bounds.height - edge
  for (let index = 0; !overInteractive && index < snapshot.regions.length; index++) {
    const region = snapshot.regions[index]
    if (!rect(region)) continue
    // Clip the real region first: padding an entirely off-window stale region
    // must not manufacture a new target at the opposite side of the HWND.
    const left = Math.max(0, region.x)
    const top = Math.max(0, region.y)
    const right = Math.min(bounds.width, region.x + region.width)
    const bottom = Math.min(bounds.height, region.y + region.height)
    if (right <= left || bottom <= top) continue
    overInteractive = x >= left - OVERLAY_INPUT_PADDING_X && x < right + OVERLAY_INPUT_PADDING_X
      && y >= top - OVERLAY_INPUT_PADDING_Y && y < bottom + OVERLAY_INPUT_PADDING_Y
  }
  return { ignoreMouse: !overInteractive, overInteractive, pollMs }
}
