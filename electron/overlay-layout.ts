import type { ShapeRect } from './overlay-shape'

export interface OverlayLayoutPublication {
  generation: number
  /** DOM/CSS pixels, measured in the same frame as regions and controlsAnchor. */
  viewport: { width: number; height: number }
  regions: ShapeRect[]
  controlsAnchor?: { x: number; y: number }
}

export interface OverlayNativeViewport {
  /** Logical content size (DIP), not the monitor's physical pixels. */
  width: number
  height: number
  /** Read from webContents.getZoomFactor(), never from the renderer publication. */
  zoomFactor: number
}

export type OverlayLayoutResult = {
  accepted: true
  generation: number
  regions: ShapeRect[]
  controlsAnchor?: { x: number; y: number }
} | {
  accepted: false
  reason: 'not-requested' | 'invalid-publication' | 'stale-generation' | 'invalid-native-viewport' | 'viewport-mismatch' | 'invalid-regions' | 'invalid-anchor'
}

export const OVERLAY_LAYOUT_MAX_REGIONS = 64
const MAX_VIEWPORT = 32_768
const MAX_COORDINATE = 131_072
const VIEWPORT_TOLERANCE = 2

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function dimension(value: unknown): value is number {
  return finite(value) && value >= 1 && value <= MAX_VIEWPORT
}

function coordinate(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= MAX_COORDINATE
}

/**
 * Rejects old DOM measurements after resize, screen wake, or display migration.
 *
 * requestLayout() deliberately invalidates readiness immediately. Until a matching
 * publication is accepted, the caller must remove native painting clips and keep
 * the HWND input-transparent. A monitor scale factor is never part of this math:
 * Electron content bounds are already logical DIP; only page zoom scales CSS px.
 */
export class OverlayLayoutGate {
  private currentGeneration = 0
  private currentReady = false

  get generation() { return this.currentGeneration }
  get ready() { return this.currentReady }

  requestLayout(): number {
    if (this.currentGeneration === Number.MAX_SAFE_INTEGER) throw new Error('Overlay layout generation exhausted')
    this.currentReady = false
    return ++this.currentGeneration
  }

  accept(value: unknown, native: OverlayNativeViewport): OverlayLayoutResult {
    if (!this.currentGeneration) return { accepted: false, reason: 'not-requested' }
    // A broken current-generation layout must not keep an older clip active.
    // Delayed messages from another generation cannot invalidate a fresh layout.
    if (record(value) && value.generation === this.currentGeneration) this.currentReady = false
    if (!record(value) || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1
      || !record(value.viewport) || !dimension(value.viewport.width) || !dimension(value.viewport.height)) {
      return { accepted: false, reason: 'invalid-publication' }
    }
    if (value.generation !== this.currentGeneration) return { accepted: false, reason: 'stale-generation' }
    if (!record(native) || !dimension(native.width) || !dimension(native.height)
      || !finite(native.zoomFactor) || native.zoomFactor < 0.25 || native.zoomFactor > 5) {
      return { accepted: false, reason: 'invalid-native-viewport' }
    }
    const zoom = native.zoomFactor
    if (Math.abs(value.viewport.width * zoom - native.width) > VIEWPORT_TOLERANCE
      || Math.abs(value.viewport.height * zoom - native.height) > VIEWPORT_TOLERANCE) {
      return { accepted: false, reason: 'viewport-mismatch' }
    }
    if (!Array.isArray(value.regions) || value.regions.length > OVERLAY_LAYOUT_MAX_REGIONS) {
      return { accepted: false, reason: 'invalid-regions' }
    }
    const regions: ShapeRect[] = []
    for (let index = 0; index < value.regions.length; index++) {
      // Array.every/map skip holes: a sparse IPC-like array must not pass validation.
      if (!Object.hasOwn(value.regions, index)) return { accepted: false, reason: 'invalid-regions' }
      const region: unknown = value.regions[index]
      if (!record(region) || !coordinate(region.x) || !coordinate(region.y)
        || !finite(region.width) || !finite(region.height)
        || region.width <= 0 || region.height <= 0
        || region.width > MAX_COORDINATE || region.height > MAX_COORDINATE) {
        return { accepted: false, reason: 'invalid-regions' }
      }
      const x = Math.max(0, region.x * zoom)
      const y = Math.max(0, region.y * zoom)
      const right = Math.min(native.width, (region.x + region.width) * zoom)
      const bottom = Math.min(native.height, (region.y + region.height) * zoom)
      // Outside text has no intersection, not a synthetic one-pixel native strip.
      if (right > x && bottom > y) regions.push({ x, y, width: right - x, height: bottom - y })
    }
    let controlsAnchor: { x: number; y: number } | undefined
    if (value.controlsAnchor !== undefined) {
      if (!record(value.controlsAnchor) || !coordinate(value.controlsAnchor.x) || !coordinate(value.controlsAnchor.y)) {
        return { accepted: false, reason: 'invalid-anchor' }
      }
      controlsAnchor = {
        x: Math.min(native.width, Math.max(0, value.controlsAnchor.x * zoom)),
        y: Math.min(native.height, Math.max(0, value.controlsAnchor.y * zoom))
      }
    }
    this.currentReady = true
    return { accepted: true, generation: this.currentGeneration, regions, ...(controlsAnchor ? { controlsAnchor } : {}) }
  }
}
