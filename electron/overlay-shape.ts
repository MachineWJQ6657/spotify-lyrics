export interface ShapeRect { x: number; y: number; width: number; height: number }

/** Electron setShape clips PAINT as well as input. Repeated lyric masks caused
 * real compositor strips despite correct native region inspection. Painting
 * is now unconditionally whole-surface; overlay-input owns cursor hit testing.
 * Keep this signature for the standalone compositor regression fixture. */
export function overlayShape(_width: number, _height: number, _regions: readonly ShapeRect[], _clickThrough: boolean): ShapeRect[] {
  return []
}
