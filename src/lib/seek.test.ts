import { describe, expect, it } from 'vitest'
import { calibratedPosition } from './clock'
import { isShortcutTarget, lyricSeekTarget } from './seek'

describe('seeking to a lyric line', () => {
  it('lands where the line starts on screen with the per-song offset', () => {
    for (const offset of [0, 850, -400, 7120]) {
      const target = lyricSeekTarget(60_000, offset, 240_000)
      expect(calibratedPosition(target, offset)).toBe(60_000)
    }
  })

  it('stays inside the song', () => {
    expect(lyricSeekTarget(200, -1000, 240_000)).toBe(0)
    expect(lyricSeekTarget(239_900, 500, 240_000)).toBe(239_000)
    expect(lyricSeekTarget(12_345.6, 0, undefined)).toBe(12_346)
  })
})

describe('main-window shortcuts', () => {
  const element = (matches: string | null, extra: Partial<HTMLElement> = {}) =>
    ({ closest: (selector: string) => matches && selector.split(',').some(part => part.trim() === matches) ? {} : null, isContentEditable: false, ...extra }) as unknown as HTMLElement
  it('fire on the page and the lyrics list', () => {
    expect(isShortcutTarget(element(null))).toBe(true)
    expect(isShortcutTarget(null)).toBe(true)
  })
  it('leave fields and focused controls alone', () => {
    for (const tag of ['input', 'textarea', 'select', 'button']) expect(isShortcutTarget(element(tag))).toBe(false)
    expect(isShortcutTarget(element(null, { isContentEditable: true }))).toBe(false)
  })
})
