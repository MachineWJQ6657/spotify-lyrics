import { describe, expect, it } from 'vitest'
import { captureQuality } from './capture-quality'
describe('capture signal coverage', () => {
  const sound = () => Float32Array.from({ length: 192000 }, (_, i) => .15 * Math.sin(i * .11))
  it('accepts continuous sound without claiming it contains reliable singing', () => {
    expect(captureQuality(sound())).toBe('usable')
    const quiet = sound().map(x => x * .03)
    expect(captureQuality(quiet)).toBe('usable')
  })
  it('rejects a loud beginning followed by silence before starting inference', () => {
    const gaps = sound(); gaps.fill(0, 80000)
    expect(captureQuality(gaps)).toBe('audio-gaps')
    const tail = sound(); tail.fill(0, 160000)
    expect(captureQuality(tail)).toBe('audio-gaps')
    expect(captureQuality(new Float32Array(192000))).toBe('silence')
  })
  it('rejects non-finite PCM and keeps brief normal musical gaps', () => {
    const valid = sound(); valid.fill(0, 32000, 40000)
    expect(captureQuality(valid)).toBe('usable')
    valid[10] = NaN
    expect(captureQuality(valid)).toBe('audio-gaps')
  })
})
