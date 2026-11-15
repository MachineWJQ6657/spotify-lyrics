/**
 * Plain text of lyrics for the clipboard. A row is the original line followed
 * by the secondary rows on screen (romaji, translation).
 */
const clean = (texts: string[]) => texts.map(text => text.trim()).filter(Boolean)

/** One row: its texts, one per line. */
export function rowText(texts: string[]): string {
  return clean(texts).join('\n')
}

/**
 * The whole song. With `withSecondary` each row is a block (original, romaji,
 * translation) and blocks are separated by an empty line; without it, one
 * original line per row. Interludes (rows without words) are left out.
 */
export function songText(rows: string[][], withSecondary: boolean): string {
  if (!withSecondary) return clean(rows.map(texts => texts[0] ?? '')).join('\n')
  return rows.map(rowText).filter(Boolean).join('\n\n')
}
