import { describe, expect, it } from 'vitest'
import type { LyricsDocument } from '../types'
import { backupFileName, isBackupDocument, mergeLibraryBackup, parseLibraryBackup, serializeLibraryBackup } from './library-backup'

const document = (id: string, updatedAt: number, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: id, updatedAt,
  tracks: [{ id: `${id}-o`, language: 'ja', label: '日本語', kind: 'original', source: 'LRCLIB · 精确匹配', lines: [{ startMs: 1000, text: '歌詞' }, { startMs: 5000, text: '' }] }],
  ...extra
})

describe('library backup', () => {
  it('round-trips the library, with offsets and listening results', () => {
    const library = { a: document('a', 5, { offsetMs: 250 }), b: document('b', 7, { listenedOffset: { timingKey: 'k', state: 'decided', offsetMs: 300, lines: 6, measuredAt: 1 } }) }
    const parsed = parseLibraryBackup(serializeLibraryBackup(library, Date.UTC(2026, 10, 15)))
    expect(parsed).toEqual({ documents: [library.a, library.b], skipped: 0 })
  })
  it('names the file by date', () => {
    expect(backupFileName(new Date(2026, 10, 5).getTime())).toBe('syllable-library-20261105.json')
  })
  it('rejects files that are not a backup', () => {
    expect(parseLibraryBackup('not json')).toEqual({ error: '这不是有效的备份文件（无法解析）' })
    expect(parseLibraryBackup('{"hello":1}')).toEqual({ error: '这不是 Syllable 的资料库备份文件' })
    expect(parseLibraryBackup('[1,2]')).toEqual({ error: '这不是 Syllable 的资料库备份文件' })
    expect(parseLibraryBackup(JSON.stringify({ format: 'syllable-library', version: 99, documents: [] }))).toEqual({ error: '这个备份来自更新的版本，请先升级 Syllable' })
  })
  it('skips damaged entries and keeps the good ones', () => {
    const good = document('good', 1)
    const text = JSON.stringify({ format: 'syllable-library', version: 1, documents: [good, { trackId: 'no-tracks' }, { trackId: 5, tracks: [] }, null,
      { trackId: 'bad-line', tracks: [{ id: 'x', language: 'ja', label: '', kind: 'original', source: '', lines: [{ startMs: 'soon', text: 'a' }] }] },
      { trackId: 'bad-kind', tracks: [{ id: 'x', language: 'ja', label: '', kind: 'cover', source: '', lines: [] }] }] })
    expect(parseLibraryBackup(text)).toEqual({ documents: [good], skipped: 5 })
    expect(isBackupDocument({ trackId: 'empty', tracks: [] })).toBe(true)
    expect(isBackupDocument({ trackId: 'x', tracks: [], offsetMs: 'late' })).toBe(false)
  })
  it('adds new songs, takes newer copies, and keeps the library copy otherwise', () => {
    const current = { a: document('a', 10), b: document('b', 10), c: document('c', 10) }
    const newerB = document('b', 20, { offsetMs: 100 })
    const olderC = document('c', 5)
    const merged = mergeLibraryBackup(current, [document('d', 1), newerB, olderC, document('a', 10)])
    expect(merged).toMatchObject({ added: 1, updated: 1, kept: 2 })
    expect(Object.keys(merged.library).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(merged.library.b).toBe(newerB)
    expect(merged.library.c).toBe(current.c)
    // The current library object is not modified.
    expect(Object.keys(current)).toEqual(['a', 'b', 'c'])
  })
})
