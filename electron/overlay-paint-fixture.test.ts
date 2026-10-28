import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

// Exercise the actual diagnostic function, not a separately reimplemented
// approximation that could let the desktop fixture silently accept strips.
const source = readFileSync(new URL('../scripts/verify-overlay-paint.cjs', import.meta.url), 'utf8')
const block = source.split('// BEGIN PURE PAINT COVERAGE')[1].split('// END PURE PAINT COVERAGE')[0]
const coverage = vm.runInNewContext(`(() => { ${block}; return paintCoverage })()`)
const regions = [20, 60, 100].map(y => ({ x: 20, y, width: 160, height: 20 }))
const viewport = { width: 200, height: 140 }
function bitmap(keep: (x: number, y: number) => boolean = () => true) {
  const pixels = Buffer.alloc(200 * 140 * 4)
  for (const region of regions) for (let y = region.y + 4; y < region.y + 16; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      if (x % 10 > 6 || !keep(x, y)) continue
      const at = (y * 200 + x) * 4
      pixels[at] = 240; pixels[at + 1] = 255; pixels[at + 2] = 240; pixels[at + 3] = 255
    }
  }
  return { getSize: () => viewport, toBitmap: () => pixels }
}

describe('compositor paint fixture acceptance', () => {
  it('accepts all three complete rows', () => {
    expect(coverage(bitmap(), bitmap(), regions, viewport).passed).toBe(true)
  })
  it.each([
    ['a narrow vertical strip', (x: number) => x < 28],
    ['a horizontal strip', (_x: number, y: number) => y % 40 < 25],
    ['a missing translation', (_x: number, y: number) => y < 60 || y > 80],
    ['a missing romanization', (_x: number, y: number) => y < 100],
    ['half of every row', (x: number) => x < 100],
    ['a completely blank surface', () => false],
  ])('rejects %s', (_name, keep) => {
    expect(coverage(bitmap(), bitmap(keep), regions, viewport).passed).toBe(false)
  })
  it('does not accept an empty renderer as a matching blank compositor', () => {
    expect(coverage(bitmap(() => false), bitmap(() => false), regions, viewport).passed).toBe(false)
  })
})
