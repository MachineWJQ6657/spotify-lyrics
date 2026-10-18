import type { LyricLine } from '../types'

/** Local version identity, not a security/authentication hash. Never exports text. */
export function lyricTimingKey(lines: Pick<LyricLine, 'startMs' | 'text'>[]): string {
  if (!Array.isArray(lines) || lines.length > 400 || lines.some(line => !Number.isFinite(line.startMs) || typeof line.text !== 'string' || line.text.length > 500)) return ''
  const value = JSON.stringify(lines.map(line => [line.startMs, line.text]))
  let a = 2166136261, b = 5381
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619)
    b = Math.imul(b, 33) ^ value.charCodeAt(i)
  }
  return `${value.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
