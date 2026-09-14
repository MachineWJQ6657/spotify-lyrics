import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordSurfaceRender } from './render-probe'

afterEach(() => vi.unstubAllGlobals())

describe('opt-in render measurements', () => {
  it('allocates no counter when diagnostics are disabled', () => {
    const target = {}
    vi.stubGlobal('window', target)
    recordSurfaceRender('shell')
    expect(target).toEqual({})
  })

  it('counts surfaces independently and stops when the probe is removed', () => {
    const counts: Record<string, number> = {}
    const target: { __syllableRenderProbe?: Record<string, number> } = { __syllableRenderProbe: counts }
    vi.stubGlobal('window', target)
    recordSurfaceRender('shell')
    recordSurfaceRender('player')
    recordSurfaceRender('player')
    delete target.__syllableRenderProbe
    recordSurfaceRender('player')
    expect(counts).toEqual({ shell: 1, player: 2 })
  })
})
