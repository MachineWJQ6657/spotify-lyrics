import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface MainWindowState { x: number; y: number; width: number; height: number; maximized?: boolean }
interface Rect { x: number; y: number; width: number; height: number }

/**
 * The saved main-window rectangle, adjusted to still be usable on the display
 * it lands on: never smaller than the minimum, never larger than the work
 * area, and fully inside it (a monitor may have been unplugged or rescaled).
 */
export function fitWindowToWorkArea(saved: Rect, workArea: Rect, minimum: { width: number; height: number }): Rect {
  const width = Math.round(Math.min(workArea.width, Math.max(minimum.width, saved.width)))
  const height = Math.round(Math.min(workArea.height, Math.max(minimum.height, saved.height)))
  const x = Math.round(Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, saved.x)))
  const y = Math.round(Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, saved.y)))
  return { x, y, width, height }
}

export function parseMainWindowState(raw: string): MainWindowState | null {
  try {
    const value = JSON.parse(raw) as Partial<MainWindowState> | null
    if (!value || ![value.x, value.y, value.width, value.height].every(item => typeof item === 'number' && Number.isFinite(item))) return null
    if (value.width! < 200 || value.height! < 200 || value.width! > 20_000 || value.height! > 20_000) return null
    return { x: value.x!, y: value.y!, width: value.width!, height: value.height!, maximized: value.maximized === true }
  } catch { return null }
}

/** Read synchronously so the window is created at its saved place instead of jumping there. */
export function readMainWindowState(file: string): MainWindowState | null {
  try { return parseMainWindowState(readFileSync(file, 'utf8')) } catch { return null }
}

/** Serialized, atomic writes: an older resize can never finish after a newer one. */
export function createMainWindowStateWriter(file: string) {
  let pending: Promise<void> = Promise.resolve()
  return (state: MainWindowState) => {
    const raw = JSON.stringify(state)
    pending = pending.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(`${file}.tmp`, raw, 'utf8')
      await rename(`${file}.tmp`, file)
    }).catch(() => undefined)
    return pending
  }
}
