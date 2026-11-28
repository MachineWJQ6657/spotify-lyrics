import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { hasOverlayColors, OVERLAY_ROWS, overlayColorVariables, overlayHex, overlayRowColor, withOverlayColor } from './overlay-colors'

describe('a colour for each row of the desktop lyrics', () => {
  it('shows every row in its default colour until one is chosen', () => {
    expect(OVERLAY_ROWS.map(item => [item.row, overlayRowColor(undefined, item.row)])).toEqual([
      ['original', '#ffffff'], ['kana', '#b8f5cc'], ['romaji', '#b8f5cc'], ['translation', '#ffffff'], ['next', '#ffffff']
    ])
    expect(hasOverlayColors(undefined)).toBe(false)
    expect(overlayColorVariables(undefined)).toEqual({})
  })

  it('keeps a chosen colour for its row only', () => {
    const colors = withOverlayColor(undefined, 'translation', '#FFD166')
    expect(colors).toEqual({ translation: '#ffd166' })
    expect(overlayRowColor(colors, 'translation')).toBe('#ffd166')
    expect(overlayRowColor(colors, 'original')).toBe('#ffffff')
    expect(hasOverlayColors(colors)).toBe(true)
    expect(overlayColorVariables(colors)).toEqual({ '--overlay-color-translation': '#ffd166' })
    expect(withOverlayColor(colors, 'romaji', '#80c8ff')).toEqual({ translation: '#ffd166', romaji: '#80c8ff' })
  })

  it('forgets a row that was put back on its default colour', () => {
    const colors = withOverlayColor({ translation: '#ffd166', kana: '#ff0000' }, 'kana', '#B8F5CC')
    expect(colors).toEqual({ translation: '#ffd166' })
    expect(withOverlayColor(colors, 'translation', '#ffffff')).toBeUndefined()
  })

  it('takes nothing but a six-digit colour', () => {
    for (const value of ['red', '#fff', '#12345g', 'url(x)', '#ffffff;color:red', '', null, 7]) expect(overlayHex(value)).toBeUndefined()
    expect(overlayColorVariables({ original: 'red', next: '#ABCDEF' } as never)).toEqual({ '--overlay-color-next': '#abcdef' })
    expect(overlayRowColor({ original: 'javascript:1' } as never, 'original')).toBe('#ffffff')
    expect(withOverlayColor({ kana: 'nonsense' } as never, 'original', 'also nonsense')).toBeUndefined()
  })

  it('has a rule in the overlay style sheet for every row, falling back to the default it lists', () => {
    const css = readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8')
    const fallback: Record<string, string> = { original: '#fff', kana: '#b8f5cc', romaji: '#b8f5cc', translation: '#fff', next: '#fff' }
    for (const item of OVERLAY_ROWS) {
      expect(css).toContain(`var(--overlay-color-${item.row}, ${fallback[item.row]})`)
      // The short form in the style sheet is the same colour as the default in the list.
      const short = fallback[item.row]
      const long = short.length === 4 ? `#${[...short.slice(1)].map(digit => digit + digit).join('')}` : short
      expect(long).toBe(item.color)
    }
  })
})
