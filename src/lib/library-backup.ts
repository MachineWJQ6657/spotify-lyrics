import type { LyricsDocument } from '../types'

/**
 * Backup of the saved lyrics library (lyrics, per-song offsets, listening
 * results, source choices) as one JSON file, and its restore. The file is the
 * user's own data written by this app; it is still checked before use, so a
 * damaged or unrelated file cannot break the library.
 */
export const BACKUP_FORMAT = 'syllable-library'
export const BACKUP_VERSION = 1

export function serializeLibraryBackup(library: Record<string, LyricsDocument>, now = Date.now()): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), documents: Object.values(library) })
}

export function backupFileName(now = Date.now()): string {
  const date = new Date(now)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `syllable-library-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A document the app can show: a song id and well-formed tracks. Anything else in the file is skipped. */
export function isBackupDocument(value: unknown): value is LyricsDocument {
  if (!isRecord(value) || typeof value.trackId !== 'string' || !value.trackId || value.trackId.length > 200 || !Array.isArray(value.tracks)) return false
  if (value.updatedAt !== undefined && !Number.isFinite(value.updatedAt)) return false
  if (value.offsetMs !== undefined && !Number.isFinite(value.offsetMs)) return false
  return value.tracks.every(track => isRecord(track) && typeof track.id === 'string' && typeof track.language === 'string' && typeof track.label === 'string'
    && typeof track.source === 'string' && (track.kind === 'original' || track.kind === 'translation' || track.kind === 'romanization')
    && Array.isArray(track.lines) && track.lines.every(line => isRecord(line) && typeof line.text === 'string' && Number.isFinite(line.startMs)))
}

export type ParsedBackup = { documents: LyricsDocument[]; skipped: number } | { error: string }

export function parseLibraryBackup(text: string): ParsedBackup {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { error: '这不是有效的备份文件（无法解析）' } }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !Array.isArray(parsed.documents)) return { error: '这不是 Syllable 的资料库备份文件' }
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) return { error: '这个备份来自更新的版本，请先升级 Syllable' }
  const documents = parsed.documents.filter(isBackupDocument)
  return { documents, skipped: parsed.documents.length - documents.length }
}

export interface BackupMerge { library: Record<string, LyricsDocument>; added: number; updated: number; kept: number }

/**
 * Adds a backup's songs to the library. A song already in the library is
 * replaced only by a newer copy (later `updatedAt`); otherwise the library's
 * own copy stays.
 */
export function mergeLibraryBackup(current: Record<string, LyricsDocument>, incoming: LyricsDocument[]): BackupMerge {
  const library = { ...current }
  let added = 0, updated = 0, kept = 0
  for (const document of incoming) {
    const existing = library[document.trackId]
    if (!existing) { library[document.trackId] = document; added += 1 }
    else if ((document.updatedAt ?? 0) > (existing.updatedAt ?? 0)) { library[document.trackId] = document; updated += 1 }
    else kept += 1
  }
  return { library, added, updated, kept }
}
