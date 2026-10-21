import { describe, expect, it } from 'vitest'
import { OverlayLayoutGate, OVERLAY_LAYOUT_MAX_REGIONS, type OverlayLayoutPublication } from './overlay-layout'

function fixture() {
  const gate = new OverlayLayoutGate()
  const generation = gate.requestLayout()
  const publication: OverlayLayoutPublication = {
    generation, viewport: { width: 800, height: 240 },
    regions: [{ x: 100, y: 40, width: 600, height: 100 }], controlsAnchor: { x: 400, y: 20 }
  }
  const native = { width: 800, height: 240, zoomFactor: 1 }
  return { gate, publication, native }
}

describe('overlay renderer layout generation gate', () => {
  it('requires a main-process request and invalidates readiness on each request', () => {
    const { publication, native } = fixture()
    const gate = new OverlayLayoutGate()
    expect(gate.accept(publication, native)).toEqual({ accepted: false, reason: 'not-requested' })
    expect(gate.requestLayout()).toBe(1)
    expect(gate.accept(publication, native).accepted).toBe(true)
    expect(gate.ready).toBe(true)
    expect(gate.requestLayout()).toBe(2)
    expect(gate.ready).toBe(false)
    expect(gate.accept(publication, native)).toEqual({ accepted: false, reason: 'stale-generation' })
    expect(gate.ready).toBe(false)
  })

  it('rejects future generations too, without advancing main ownership', () => {
    const { gate, publication, native } = fixture()
    expect(gate.accept({ ...publication, generation: 2 }, native)).toEqual({ accepted: false, reason: 'stale-generation' })
    expect(gate.generation).toBe(1)
    expect(gate.ready).toBe(false)
  })

  it('invalidates a broken current publication, but a delayed generation cannot invalidate a fresh one', () => {
    const { gate, publication, native } = fixture()
    expect(gate.accept(publication, native).accepted).toBe(true)
    expect(gate.accept({ ...publication, generation: 2 }, native).accepted).toBe(false)
    expect(gate.ready).toBe(true)
    expect(gate.accept({ ...publication, regions: [null] }, native).accepted).toBe(false)
    expect(gate.ready).toBe(false)
    expect(gate.accept(publication, native).accepted).toBe(true)
    expect(gate.accept({ ...publication, viewport: null }, native).accepted).toBe(false)
    expect(gate.ready).toBe(false)
  })

  it('rejects a stale viewport from a monitor switch even when generation matches', () => {
    const { gate, publication, native } = fixture()
    expect(gate.accept(publication, { ...native, width: 1_200 })).toEqual({ accepted: false, reason: 'viewport-mismatch' })
    expect(gate.ready).toBe(false)
    expect(gate.accept({ ...publication, viewport: { width: 1_200, height: 240 } }, { ...native, width: 1_200 }).accepted).toBe(true)
  })

  it('normalizes actual 125% page zoom exactly once, including the controls anchor', () => {
    const { gate, publication } = fixture()
    expect(gate.accept(publication, { width: 1_000, height: 300, zoomFactor: 1.25 })).toEqual({
      accepted: true, generation: 1,
      regions: [{ x: 125, y: 50, width: 750, height: 125 }], controlsAnchor: { x: 500, y: 25 }
    })
  })

  it('does not multiply by renderer-provided zoom or monitor DPI', () => {
    const { gate, publication, native } = fixture()
    expect(gate.accept({ ...publication, zoomFactor: 2, scaleFactor: 1.5 }, native)).toMatchObject({
      accepted: true, regions: publication.regions, controlsAnchor: publication.controlsAnchor
    })
  })

  it('allows at most two logical pixels of viewport rounding per axis', () => {
    const { gate, publication, native } = fixture()
    expect(gate.accept({ ...publication, viewport: { width: 802, height: 238 } }, native).accepted).toBe(true)
    expect(gate.accept({ ...publication, viewport: { width: 802.01, height: 240 } }, native)).toEqual({ accepted: false, reason: 'viewport-mismatch' })
  })

  it('clips negative and oversized visible rectangles, drops fully outside rectangles', () => {
    const { gate, publication, native } = fixture()
    expect(gate.accept({ ...publication, regions: [
      { x: -20, y: -10, width: 50, height: 40 },
      { x: 790, y: 220, width: 50, height: 100 },
      { x: -30, y: 0, width: 10, height: 20 },
      { x: 801, y: 0, width: 10, height: 20 }
    ], controlsAnchor: { x: -5, y: 250 } }, native)).toEqual({
      accepted: true, generation: 1,
      regions: [{ x: 0, y: 0, width: 30, height: 30 }, { x: 790, y: 220, width: 10, height: 20 }],
      controlsAnchor: { x: 0, y: 240 }
    })
  })

  it('accepts an empty render and copies geometry instead of retaining renderer objects', () => {
    const { gate, publication, native } = fixture()
    expect(gate.accept({ ...publication, regions: [], controlsAnchor: undefined }, native)).toEqual({ accepted: true, generation: 1, regions: [] })
    const result = gate.accept(publication, native)
    publication.regions[0].x = 900
    publication.controlsAnchor!.x = 900
    expect(result).toMatchObject({ accepted: true, regions: [{ x: 100 }], controlsAnchor: { x: 400 } })
  })

  it('rejects sparse, over-limit and malformed region arrays rather than truncating', () => {
    const { gate, publication, native } = fixture()
    for (const regions of [new Array(1), [undefined], null, {},
      Array.from({ length: OVERLAY_LAYOUT_MAX_REGIONS + 1 }, () => publication.regions[0]),
      [{ x: 1e20, y: 0, width: 1, height: 1 }],
      [{ x: 0, y: 0, width: 0, height: 1 }],
      [{ x: 0, y: 0, width: 1, height: Infinity }],
      [{ x: '0', y: 0, width: 1, height: 1 }]
    ]) expect(gate.accept({ ...publication, regions }, native)).toEqual({ accepted: false, reason: 'invalid-regions' })
    expect(gate.accept({ ...publication, regions: Array.from({ length: OVERLAY_LAYOUT_MAX_REGIONS }, () => publication.regions[0]) }, native).accepted).toBe(true)
  })

  it('rejects malformed metadata, unsafe generations, and unbounded viewport dimensions', () => {
    const { gate, publication, native } = fixture()
    for (const bad of [null, [], {}, { ...publication, generation: NaN }, { ...publication, generation: 1.5 },
      { ...publication, generation: Number.MAX_SAFE_INTEGER + 1 }, { ...publication, generation: 0 },
      { ...publication, viewport: { width: Infinity, height: 240 } },
      { ...publication, viewport: { width: 1e9, height: 240 } },
      { ...publication, viewport: { width: 800, height: '240' } }
    ]) expect(gate.accept(bad, native)).toEqual({ accepted: false, reason: 'invalid-publication' })
  })

  it('rejects invalid native geometry and actual zoom rather than trusting the renderer', () => {
    const { gate, publication, native } = fixture()
    for (const bad of [null, { ...native, width: 0 }, { ...native, height: NaN },
      { ...native, zoomFactor: 0 }, { ...native, zoomFactor: 6 }, { ...native, zoomFactor: Infinity }
    ]) expect(gate.accept(publication, bad as typeof native)).toEqual({ accepted: false, reason: 'invalid-native-viewport' })
  })

  it('rejects malformed anchors without marking a pending generation ready', () => {
    const { gate, publication, native } = fixture()
    for (const controlsAnchor of [null, [], { x: NaN, y: 0 }, { x: 0, y: '0' }, { x: 1e10, y: 0 }]) {
      expect(gate.accept({ ...publication, controlsAnchor }, native)).toEqual({ accepted: false, reason: 'invalid-anchor' })
      expect(gate.ready).toBe(false)
    }
  })
})
