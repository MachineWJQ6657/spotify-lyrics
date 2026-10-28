import type { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import type { ShapeRect } from './overlay-shape'

type NativeFunction = (...args: Array<number | Buffer | null>) => number

interface WindowRegionApi {
  isWindow: NativeFunction
  getDpiForWindow: NativeFunction
  getWindowRgn: NativeFunction
  createRectRgn: NativeFunction
  getRegionData: NativeFunction
  deleteObject: NativeFunction
  getDwmAttribute: NativeFunction
}

export interface WindowRegionInspection {
  ok: boolean
  hasCustomRegion: boolean
  dpi: number
  /** Raw Win32 logical units relative to the window's top-left, not its client. */
  rectangles: ShapeRect[]
  regionType?: number
  cloaked?: number
  error?: string
}

const MAX_REGION_BYTES = 1_048_576
const MAX_REGION_RECTANGLES = 10_000
const REGION_HEADER_BYTES = 32
const RECTANGLE_BYTES = 16

let cachedApi: WindowRegionApi | null | undefined
let apiError = ''

function loadApi(): WindowRegionApi | null {
  if (cachedApi !== undefined) return cachedApi
  if (process.platform !== 'win32') {
    apiError = 'not running on Windows'
    return cachedApi = null
  }
  try {
    // Resolve the unpacked native module, exactly as the tool-window helper does.
    const nodeRequire = createRequire(import.meta.url)
    const koffiPath = nodeRequire.resolve('koffi').replace(/([\\/])app\.asar\1/, '$1app.asar.unpacked$1')
    const koffi = nodeRequire(koffiPath) as {
      load(name: string): { func(prototype: string): NativeFunction }
    }
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    cachedApi = {
      isWindow: user32.func('int __stdcall IsWindow(intptr_t hwnd)'),
      getDpiForWindow: user32.func('uint32_t __stdcall GetDpiForWindow(intptr_t hwnd)'),
      getWindowRgn: user32.func('int __stdcall GetWindowRgn(intptr_t hwnd, intptr_t region)'),
      createRectRgn: gdi32.func('intptr_t __stdcall CreateRectRgn(int left, int top, int right, int bottom)'),
      getRegionData: gdi32.func('uint32_t __stdcall GetRegionData(intptr_t region, uint32_t size, void *data)'),
      deleteObject: gdi32.func('int __stdcall DeleteObject(intptr_t object)'),
      getDwmAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attribute, void *value, uint32_t size)')
    }
  } catch (error) {
    apiError = error instanceof Error ? error.message : String(error)
    cachedApi = null
  }
  return cachedApi
}

function readHandle(window: BrowserWindow): number {
  const buffer = window.getNativeWindowHandle()
  if (buffer.length < 4) throw new Error('native window handle is truncated')
  const value = buffer.length >= 8 ? Number(buffer.readBigUInt64LE(0)) : buffer.readUInt32LE(0)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('native window handle is invalid')
  return value
}

/**
 * Read-only native QA. Never changes the HWND, focus, size, region, or playback.
 *
 * GetWindowRgn returns 0 both for "no custom region" and for read failure. With
 * a still-valid own HWND and DPI, that is reported as no observed custom region
 * (regionType: 0), not conclusive proof that a previous SetWindowRgn succeeded.
 */
export function inspectWindowRegion(window: BrowserWindow): WindowRegionInspection {
  const failure = (error: string, dpi = 0): WindowRegionInspection => ({
    ok: false, hasCustomRegion: false, dpi, rectangles: [], error
  })
  if (window.isDestroyed()) return failure('window is destroyed')
  const api = loadApi()
  if (!api) return failure(apiError || 'Win32 region API unavailable')
  let region = 0
  let dpi = 0
  try {
    const hwnd = readHandle(window)
    if (!api.isWindow(hwnd)) return failure('HWND is no longer valid')
    dpi = api.getDpiForWindow(hwnd)
    // Visibility alone includes windows hidden by the shell/virtual desktop.
    const cloakData = Buffer.alloc(4)
    const cloaked = api.getDwmAttribute(hwnd, 14, cloakData, 4) === 0 ? cloakData.readUInt32LE(0) : undefined
    if (!Number.isSafeInteger(dpi) || dpi <= 0) return failure('GetDpiForWindow failed')
    region = api.createRectRgn(0, 0, 0, 0)
    if (!region) return failure('CreateRectRgn failed', dpi)
    const regionType = api.getWindowRgn(hwnd, region)
    if (regionType === 0) {
      if (window.isDestroyed() || !api.isWindow(hwnd)) return failure('HWND disappeared during inspection', dpi)
      return { ok: true, hasCustomRegion: false, dpi, rectangles: [], regionType, cloaked }
    }
    if (![1, 2, 3].includes(regionType)) return failure('GetWindowRgn returned an invalid region type', dpi)
    const size = api.getRegionData(region, 0, null)
    if (!Number.isSafeInteger(size) || size < REGION_HEADER_BYTES || size > MAX_REGION_BYTES) {
      return failure('GetRegionData size is invalid or exceeds the QA limit', dpi)
    }
    const data = Buffer.alloc(size)
    const used = api.getRegionData(region, size, data)
    if (!Number.isSafeInteger(used) || used < REGION_HEADER_BYTES || used > size) {
      return failure('GetRegionData did not return a valid bounded buffer', dpi)
    }
    const headerSize = data.readUInt32LE(0)
    const dataType = data.readUInt32LE(4)
    const count = data.readUInt32LE(8)
    const regionSize = data.readUInt32LE(12)
    if (headerSize !== REGION_HEADER_BYTES || dataType !== 1 || count > MAX_REGION_RECTANGLES
      || regionSize !== count * RECTANGLE_BYTES || headerSize + regionSize > used) {
      return failure('GetRegionData header is invalid or exceeds the rectangle limit', dpi)
    }
    const rectangles: ShapeRect[] = []
    for (let index = 0; index < count; index++) {
      const offset = headerSize + index * RECTANGLE_BYTES
      const x = data.readInt32LE(offset)
      const y = data.readInt32LE(offset + 4)
      const right = data.readInt32LE(offset + 8)
      const bottom = data.readInt32LE(offset + 12)
      if (right <= x || bottom <= y) return failure('GetRegionData contains an empty or inverted rectangle', dpi)
      rectangles.push({ x, y, width: right - x, height: bottom - y })
    }
    return { ok: true, hasCustomRegion: true, dpi, rectangles, regionType, cloaked }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error), dpi)
  } finally {
    if (region) {
      // This is our temporary copy, never the HWND-owned region.
      try { api.deleteObject(region) } catch { /* preserve inspection diagnostics */ }
    }
  }
}
