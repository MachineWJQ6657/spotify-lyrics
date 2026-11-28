import type { AppSettings } from '../types'
import { tk } from './i18n'

/**
 * A colour of its own for each row of the desktop lyrics.
 *
 * The defaults are the colours the rows had before there was a choice. A row
 * the listener did not change stores nothing and keeps following the style
 * sheet, so "restore defaults" is simply: forget the choices.
 */
export type OverlayRow = 'original' | 'kana' | 'romaji' | 'translation' | 'next'

export const OVERLAY_ROWS: Array<{ row: OverlayRow; label: string; color: string }> = [
  { row: 'original', label: tk('原文'), color: '#ffffff' },
  { row: 'kana', label: tk('假名'), color: '#b8f5cc' },
  { row: 'romaji', label: tk('罗马音'), color: '#b8f5cc' },
  { row: 'translation', label: tk('翻译'), color: '#ffffff' },
  { row: 'next', label: tk('下一句'), color: '#ffffff' }
]

const HEX = /^#[0-9a-f]{6}$/i

/** A colour as the picker gives it (#rrggbb), lower case; anything else is no colour. */
export function overlayHex(value: unknown): string | undefined {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : undefined
}

/** The colour a row is shown in: the listener's, or the default. */
export function overlayRowColor(colors: AppSettings['overlayColors'], row: OverlayRow): string {
  return overlayHex(colors?.[row]) ?? OVERLAY_ROWS.find(item => item.row === row)!.color
}

/** Whether any row has a colour of the listener's own. */
export function hasOverlayColors(colors: AppSettings['overlayColors']): boolean {
  return OVERLAY_ROWS.some(item => overlayHex(colors?.[item.row]) !== undefined)
}

/**
 * The choices after one row was given a colour. Choosing a row's default colour
 * clears the choice, so the row is back on the style sheet and nothing is kept
 * that says "custom" while looking like the default.
 */
export function withOverlayColor(colors: AppSettings['overlayColors'], row: OverlayRow, value: string): AppSettings['overlayColors'] {
  const next: NonNullable<AppSettings['overlayColors']> = {}
  for (const item of OVERLAY_ROWS) {
    const color = item.row === row ? overlayHex(value) : overlayHex(colors?.[item.row])
    if (color && color !== item.color) next[item.row] = color
  }
  return Object.keys(next).length ? next : undefined
}

/** CSS variables for the overlay: one per row with a colour of its own (src/styles.css holds the defaults as fallbacks). */
export function overlayColorVariables(colors: AppSettings['overlayColors']): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const item of OVERLAY_ROWS) {
    const color = overlayHex(colors?.[item.row])
    if (color) variables[`--overlay-color-${item.row}`] = color
  }
  return variables
}
