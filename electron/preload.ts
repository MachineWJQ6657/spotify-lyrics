import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('syllable', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: (clientId: string) => ipcRenderer.invoke('auth:login', clientId),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  playback: {
    current: () => ipcRenderer.invoke('playback:current'),
    command: (command: string) => ipcRenderer.invoke('playback:command', command),
    seek: (positionMs: number) => ipcRenderer.invoke('playback:seek', positionMs),
    onUpdate: (callback: (value: unknown) => void) => {
      const handler = (_: unknown, value: unknown) => callback(value)
      ipcRenderer.on('playback:update', handler)
      return () => ipcRenderer.removeListener('playback:update', handler)
    }
  },
  lyrics: {
    fetch: (track: unknown, options?: { bypassCache?: boolean }) => ipcRenderer.invoke('lyrics:fetch', track, options),
    search: (query: unknown) => ipcRenderer.invoke('lyrics:search', query),
    romanize: (lines: string[]) => ipcRenderer.invoke('lyrics:romanize', lines),
    export: (filename: string, content: string) => ipcRenderer.invoke('lyrics:export', filename, content)
  },
  overlay: {
    show: () => ipcRenderer.invoke('overlay:show'),
    hide: () => ipcRenderer.invoke('overlay:hide'),
    setClickThrough: (value: boolean) => ipcRenderer.invoke('overlay:click-through', value),
    setHitRegions: (regions: Array<{ x: number; y: number; width: number; height: number }>, controlsAnchor?: { x: number; y: number }) => ipcRenderer.invoke('overlay:hit-regions', regions, controlsAnchor),
    setControlsHover: (hovered: boolean) => ipcRenderer.send('overlay:controls-hover', hovered),
    getBounds: () => ipcRenderer.invoke('overlay:bounds'),
    setSize: (width: number, height: number) => ipcRenderer.invoke('overlay:size', width, height),
    beginMove: () => ipcRenderer.send('overlay:move-start'),
    moveTo: (x: number, y: number) => ipcRenderer.send('overlay:move-to', x, y),
    endMove: () => ipcRenderer.send('overlay:move-end'),
    setPosition: (position: 'top' | 'center' | 'bottom') => ipcRenderer.invoke('overlay:position', position),
    resetPosition: () => ipcRenderer.invoke('overlay:reset-position'),
    setMovable: (value: boolean) => ipcRenderer.invoke('overlay:movable', value),
    onBoundsChanged: (callback: (bounds: unknown) => void) => {
      const handler = (_: unknown, bounds: unknown) => callback(bounds)
      ipcRenderer.on('overlay:bounds-changed', handler)
      return () => ipcRenderer.removeListener('overlay:bounds-changed', handler)
    },
    onVisibilityChanged: (callback: (visible: boolean) => void) => {
      const handler = (_: unknown, visible: boolean) => callback(visible)
      ipcRenderer.on('overlay:visibility-changed', handler)
      return () => ipcRenderer.removeListener('overlay:visibility-changed', handler)
    },
    onClickThroughChanged: (callback: (value: boolean) => void) => {
      const handler = (_: unknown, value: boolean) => callback(value)
      ipcRenderer.on('overlay:click-through-changed', handler)
      return () => ipcRenderer.removeListener('overlay:click-through-changed', handler)
    }
  },
  window: {
    show: () => ipcRenderer.invoke('window:show'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  meta: { redirectUri: 'http://127.0.0.1:43821/callback' }
})
