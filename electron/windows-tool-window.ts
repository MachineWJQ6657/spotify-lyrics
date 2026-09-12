import type { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'

const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x00000080
const WS_EX_APPWINDOW = 0x00040000
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOZORDER = 0x0004
const SWP_NOACTIVATE = 0x0010
const SWP_FRAMECHANGED = 0x0020

type NativeFunction = (...args: number[]) => number

interface WindowsStyleApi {
  getWindowLong: NativeFunction
  setWindowLong: NativeFunction
  setWindowPos: NativeFunction
}

export interface ToolWindowStyleResult {
  ok: boolean
  changed: boolean
  before?: number
  after?: number
  error?: string
}

let windowsStyleApi: WindowsStyleApi | null | undefined
let windowsStyleApiError = ''

function loadWindowsStyleApi() {
  if (windowsStyleApi !== undefined) return windowsStyleApi
  if (process.platform !== 'win32') {
    windowsStyleApi = null
    windowsStyleApiError = 'not running on Windows'
    return windowsStyleApi
  }

  try {
    // Koffi contains a native module and therefore stays external to the main
    // bundle. electron-builder unpacks it from app.asar; resolve that physical
    // copy explicitly so this works in both development and packaged builds.
    const nodeRequire = createRequire(import.meta.url)
    const koffiPath = nodeRequire.resolve('koffi').replace(/([\\/])app\.asar\1/, '$1app.asar.unpacked$1')
    const koffi = nodeRequire(koffiPath) as {
      load(name: string): { func(prototype: string): NativeFunction }
    }
    const user32 = koffi.load('user32.dll')
    const pointerSuffix = process.arch === 'ia32' ? '' : 'Ptr'
    windowsStyleApi = {
      getWindowLong: user32.func(`intptr_t __stdcall GetWindowLong${pointerSuffix}W(intptr_t hwnd, int index)`),
      setWindowLong: user32.func(`intptr_t __stdcall SetWindowLong${pointerSuffix}W(intptr_t hwnd, int index, intptr_t value)`),
      setWindowPos: user32.func('int __stdcall SetWindowPos(intptr_t hwnd, intptr_t insertAfter, int x, int y, int width, int height, uint32_t flags)')
    }
  } catch (error) {
    windowsStyleApi = null
    windowsStyleApiError = error instanceof Error ? error.message : String(error)
  }
  return windowsStyleApi
}

function nativeWindowHandle(window: BrowserWindow) {
  const handle = window.getNativeWindowHandle()
  if (handle.length >= 8) return Number(handle.readBigUInt64LE(0))
  return handle.readUInt32LE(0)
}

/**
 * Electron's setSkipTaskbar() does not consistently add WS_EX_TOOLWINDOW to
 * transparent frameless windows. Enforce the two Win32 flags that determine
 * taskbar and Alt-Tab eligibility, then make Windows recalculate the frame.
 * The operation is intentionally idempotent and safe to repeat after show/load.
 */
export function enforceWindowsToolWindow(window: BrowserWindow): ToolWindowStyleResult {
  if (process.platform !== 'win32') return { ok: true, changed: false }
  if (window.isDestroyed()) return { ok: false, changed: false, error: 'window is destroyed' }

  const api = loadWindowsStyleApi()
  if (!api) return { ok: false, changed: false, error: windowsStyleApiError || 'Win32 style API unavailable' }

  try {
    const hwnd = nativeWindowHandle(window)
    const before = api.getWindowLong(hwnd, GWL_EXSTYLE) >>> 0
    const desired = ((before & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW) >>> 0
    if (desired !== before) {
      api.setWindowLong(hwnd, GWL_EXSTYLE, desired)
      api.setWindowPos(
        hwnd,
        0,
        0,
        0,
        0,
        0,
        SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
      )
    }
    const after = api.getWindowLong(hwnd, GWL_EXSTYLE) >>> 0
    const ok = (after & WS_EX_TOOLWINDOW) !== 0 && (after & WS_EX_APPWINDOW) === 0
    return {
      ok,
      changed: before !== after,
      before,
      after,
      ...(ok ? {} : { error: 'Windows did not retain the requested extended style' })
    }
  } catch (error) {
    return { ok: false, changed: false, error: error instanceof Error ? error.message : String(error) }
  }
}
