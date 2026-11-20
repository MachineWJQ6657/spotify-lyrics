import { t } from '../src/lib/i18n'

/** Windows keeps 127 characters of a notification-icon tooltip. */
export const TRAY_TOOLTIP_LIMIT = 127
// Worded at each call: the hint follows the interface language.
const idle = () => t('Syllable · 单击打开客户端')

const clip = (text: string, limit: number) => {
  const chars = [...text]
  return chars.length <= limit ? text : `${chars.slice(0, Math.max(0, limit - 1)).join('')}…`
}

/**
 * Tooltip of the tray icon: the song being played on the first row, so a
 * glance at the tray names it without opening the window.
 */
export function trayTooltipText(track: { name?: string; artist?: string } | null | undefined): string {
  const hint = idle()
  const name = track?.name?.replace(/\s+/g, ' ').trim()
  if (!name) return hint
  const artist = track?.artist?.replace(/\s+/g, ' ').trim()
  const song = artist ? `${name} — ${artist}` : name
  // UTF-16 units, as Windows counts them; the song row gives way, not the hint.
  const room = TRAY_TOOLTIP_LIMIT - hint.length - 1
  let row = clip(song, room)
  while (row.length > room) row = clip(row, [...row].length - 1)
  return `${row}\n${hint}`
}
