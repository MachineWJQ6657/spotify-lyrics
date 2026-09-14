type Surface = 'shell' | 'lyrics' | 'player' | 'editor'

declare global {
  interface Window {
    __syllableRenderProbe?: Partial<Record<Surface, number>>
  }
}

/** Inert unless an internal QA run explicitly starts counting renders. */
export function recordSurfaceRender(surface: Surface) {
  const probe = typeof window === 'undefined' ? undefined : window.__syllableRenderProbe
  if (probe) probe[surface] = (probe[surface] ?? 0) + 1
}
