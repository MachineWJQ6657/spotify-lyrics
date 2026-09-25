import type { ShapeRect } from './overlay-shape'

/** Main-process hover fallback for input-transparent lyrics; no DOM events needed. */
export function isOverOverlayRegion(cursor: { x: number; y: number }, bounds: ShapeRect, regions: readonly ShapeRect[]) {
  const x = cursor.x - bounds.x, y = cursor.y - bounds.y
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return false
  return regions.some(rect => x >= rect.x - 8 && x <= rect.x + rect.width + 8
    && y >= rect.y - 8 && y <= rect.y + rect.height + 8)
}
