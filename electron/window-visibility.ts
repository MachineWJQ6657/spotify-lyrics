interface VisibilityWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}

export function windowVisible(window: VisibilityWindow | null | undefined): boolean {
  return Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized())
}

/** Document visibility alone is insufficient when a transparent sibling keeps
 * the shared renderer active (and in offscreen diagnostics). Native state is
 * only a rendering hint: media observation/control/audio must remain alive. */
export function watchWindowVisibility(window: VisibilityWindow, publish: (visible: boolean) => void) {
  let previous = windowVisible(window)
  const update = () => {
    const visible = windowVisible(window)
    if (visible === previous) return
    previous = visible; publish(visible)
  }
  const events = ['show', 'hide', 'minimize', 'restore']
  const stop = () => {
    for (const event of events) window.removeListener(event, update)
    window.removeListener('closed', stop)
  }
  for (const event of events) window.on(event, update)
  window.on('closed', stop)
  return stop
}
