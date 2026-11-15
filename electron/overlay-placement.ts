export interface PlacementRect { x: number; y: number; width: number; height: number }

/** How much of the overlay a drag keeps inside the work area: enough to grab it again. */
export const OVERLAY_GRIP_PX = 48

/**
 * The overlay's bounds when it is shown, restored at startup, or recovered
 * after a display change, an unlock or a resume from sleep.
 *
 * A place the drag itself allows stays: lyrics set low so that they hang over
 * the taskbar (the drag keeps a 48 px grip inside the work area), with at
 * least half their width on the display. They used to be pulled wholly inside
 * the work area by every unlock, resume, show and restart, so lyrics dragged
 * to y = 900 on a 1080p desktop moved to y = 812 at the next Win+L. Only an
 * axis that is out of reach (the display went away or shrank) is brought back
 * whole.
 */
export function visibleOverlayPlacement(bounds: PlacementRect, area: PlacementRect): PlacementRect {
  const width = Math.min(Math.max(480, bounds.width), area.width)
  const height = Math.min(Math.max(140, bounds.height), area.height)
  // A size that had to be cut to fit was not chosen on this display: such an
  // axis is brought back whole as well.
  const keepsX = width === bounds.width && bounds.x >= area.x - width / 2 && bounds.x <= area.x + area.width - width / 2
  const keepsY = height === bounds.height && bounds.y >= area.y && bounds.y <= area.y + area.height - OVERLAY_GRIP_PX
  return {
    width, height,
    x: keepsX ? bounds.x : Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: keepsY ? bounds.y : Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  }
}
