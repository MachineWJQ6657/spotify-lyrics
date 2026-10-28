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
