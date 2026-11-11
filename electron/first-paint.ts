interface PaintEvents {
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
}
interface PaintWindow extends PaintEvents {
  isDestroyed(): boolean
  webContents: PaintEvents
}

/** Register before loadURL. Failure must release callers, not strand show(). */
export function waitForFirstPaint(window: PaintWindow, timeoutMs = 10_000): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(false)
  return new Promise(resolve => {
    const done = (painted: boolean) => {
      clearTimeout(timer)
      window.removeListener('ready-to-show', ready)
      window.removeListener('closed', failed)
      window.webContents.removeListener('render-process-gone', failed)
      window.webContents.removeListener('destroyed', failed)
      window.webContents.removeListener('did-fail-load', loadFailed)
      resolve(painted && !window.isDestroyed())
    }
    const ready = () => done(true)
    const failed = () => done(false)
    const loadFailed = (_event: unknown, _code: number, _description: string, _url: string, mainFrame: boolean) => {
      if (mainFrame) failed()
    }
    const duration = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(30_000, timeoutMs)) : 10_000
    const timer = setTimeout(failed, duration)
    window.on('ready-to-show', ready)
    window.on('closed', failed)
    window.webContents.on('render-process-gone', failed)
    window.webContents.on('destroyed', failed)
    window.webContents.on('did-fail-load', loadFailed)
  })
}

export type PaintRecovery = 'show' | 'reload' | 'give-up'

/** What to do after the bounded first-paint wait expired or failed.
 * `ready-to-show` is emitted once per window, so a timeout on a renderer that
 * DID load cannot be re-armed by reloading it (the old retry always waited
 * another 10 s and then left the overlay hidden for the whole session). A
 * loaded, healthy renderer paints as soon as its window is visible: show it.
 * Only a crashed, failed or still-loading renderer is reloaded. */
export function paintRecovery(state: { destroyed: boolean; crashed: boolean; loading: boolean; url: string }): PaintRecovery {
  if (state.destroyed) return 'give-up'
  if (state.crashed || state.loading || !state.url) return 'reload'
  return 'show'
}

/** Every navigation emits did-finish-load, unlike ready-to-show. */
export function waitForLoad(window: PaintWindow, timeoutMs = 10_000): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(false)
  return new Promise(resolve => {
    const done = (loaded: boolean) => {
      clearTimeout(timer)
      window.removeListener('closed', failed)
      window.webContents.removeListener('did-finish-load', finished)
      window.webContents.removeListener('render-process-gone', failed)
      window.webContents.removeListener('did-fail-load', loadFailed)
      resolve(loaded && !window.isDestroyed())
    }
    const finished = () => done(true)
    const failed = () => done(false)
    const loadFailed = (_event: unknown, _code: number, _description: string, _url: string, mainFrame: boolean) => {
      if (mainFrame) failed()
    }
    const timer = setTimeout(failed, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(30_000, timeoutMs)) : 10_000)
    window.on('closed', failed)
    window.webContents.on('did-finish-load', finished)
    window.webContents.on('render-process-gone', failed)
    window.webContents.on('did-fail-load', loadFailed)
  })
}
