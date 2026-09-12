export interface ShapeRect { x: number; y: number; width: number; height: number }

/** Window-local DIP geometry; screen coordinates must never enter this shape. */
export function overlayShape(width: number, height: number, regions: readonly ShapeRect[], clickThrough: boolean): ShapeRect[] {
  if (![width, height].every(Number.isFinite) || width < 1 || height < 1) return []
  width = Math.floor(width)
  height = Math.floor(height)
  const padded = (clickThrough ? [] : regions).flatMap(region => {
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) return []
    const x = Math.max(0, Math.floor(region.x - 10))
    const y = Math.max(0, Math.floor(region.y - 8))
    const right = Math.min(width, Math.ceil(region.x + region.width + 10))
    const bottom = Math.min(height, Math.ceil(region.y + region.height + 8))
    // Fully offscreen regions have an empty intersection, not a 1px rectangle
    // beyond the HWND. This matters while resize and renderer updates race.
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : []
  })
  const edgeX = Math.min(8, width)
  const edgeY = Math.min(8, height)
  return [...padded,
    { x: 0, y: 0, width, height: edgeY },
    { x: 0, y: height - edgeY, width, height: edgeY },
    { x: 0, y: 0, width: edgeX, height },
    { x: width - edgeX, y: 0, width: edgeX, height }
  ]
}
