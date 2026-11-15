import { useEffect, useRef, useState } from 'react'
import { Archive, BookOpen, CheckCircle2, Cloud, Database, Download, Languages, Search, Sparkles, Trash2, Undo2, Upload, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { LyricsDocument } from '../types'
import { listenedLyricsOffset } from '../lib/listened-offset'
import { shiftAmount, shiftDirection } from '../lib/timing-status'
import { serializeLrc } from '../lib/lyrics'
import { hasKana, scriptPresentation } from '../lib/script'
import { LYRICS_SOURCES, lyricsSourceIdOf } from '../lib/lyrics-source'
import { backupFileName, parseLibraryBackup, serializeLibraryBackup } from '../lib/library-backup'

/** Case-, width- and space-insensitive match on title, artist and album. */
export function matchesLibraryQuery(document: Pick<LyricsDocument, 'track' | 'trackId'>, query: string) {
  const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  const needle = fold(query)
  if (!needle) return true
  return [document.track?.name, document.track?.artist, document.track?.album].some(value => value && fold(value).includes(needle))
}

/** "听音 · 延后 0.85 秒" / "手动 · 提前 0.25 秒" for a song whose timing was corrected. */
export function libraryTimingTag(document: LyricsDocument) {
  if (document.offsetMs) return `手动 · ${shiftDirection(document.offsetMs)} ${shiftAmount(document.offsetMs)}`
  const listened = listenedLyricsOffset(document)
  return listened ? `听音 · ${shiftDirection(listened)} ${shiftAmount(listened)}` : ''
}

/**
 * A tile for a song without a saved cover (covers of locally detected songs
 * are not stored): the first character of the title on a colour derived from
 * it, so rows are told apart at a glance.
 */
export function coverTile(name: string | undefined): { initial: string; hue: number } {
  const text = (name ?? '').trim()
  const initial = text ? Array.from(text)[0].toUpperCase() : '♪'
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) % 360
  return { initial, hue: hash }
}

/** Where a saved song's lyrics came from: the provider's name, or "本地" for imported and edited lyrics. */
export function librarySourceTag(document: LyricsDocument) {
  const original = document.tracks.find(track => track.kind === 'original') ?? document.tracks[0]
  if (!original) return ''
  if (document.userEditedTrackIds?.includes(original.id)) return '本地'
  return LYRICS_SOURCES.find(item => item.id === lyricsSourceIdOf(original.source))?.label ?? ''
}

export function LibraryView({ mode, openEditor }: { mode: 'library' | 'sources'; openEditor(): void }) {
  const library = useAppStore(state => state.library)
  const deleteDocument = useAppStore(state => state.deleteLibraryDocument)
  const restoreDocument = useAppStore(state => state.restoreLibraryDocument)
  const documents = Object.values(library).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const [query, setQuery] = useState('')
  // Every song removed within the undo window comes back with one click. A
  // second removal used to replace the first, which could then not be undone.
  const [removed, setRemoved] = useState<LyricsDocument[]>([])
  const undoTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(undoTimer.current), [])
  const remove = (document: LyricsDocument) => {
    deleteDocument(document.trackId)
    setRemoved(current => [...current.filter(item => item.trackId !== document.trackId), document])
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setRemoved([]), 6000)
  }
  const undo = () => {
    for (const document of removed) restoreDocument(document)
    window.clearTimeout(undoTimer.current)
    setRemoved([])
  }
  const shown = documents.filter(document => matchesLibraryQuery(document, query))
  // Backup and restore of the whole library (lyrics, offsets, listening results).
  const importLibrary = useAppStore(state => state.importLibrary)
  const backupInput = useRef<HTMLInputElement>(null)
  const [backupMessage, setBackupMessage] = useState('')
  const backupTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(backupTimer.current), [])
  const say = (message: string) => {
    setBackupMessage(message)
    window.clearTimeout(backupTimer.current)
    backupTimer.current = window.setTimeout(() => setBackupMessage(''), 8000)
  }
  const exportBackup = async () => {
    try {
      const saved = await window.syllable.lyrics.export(backupFileName(), serializeLibraryBackup(library))
      if (saved) say(`已导出 ${documents.length} 首歌的歌词和校准结果`)
    } catch { say('导出失败，请换一个位置再试') }
  }
  const importBackup = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 200 * 1024 * 1024) { say('文件太大，不是资料库备份'); return }
    try {
      const parsed = parseLibraryBackup(await file.text())
      if ('error' in parsed) { say(parsed.error); return }
      const result = importLibrary(parsed.documents)
      say(`已导入：新增 ${result.added} 首，更新 ${result.updated} 首，保留原有 ${result.kept} 首${parsed.skipped ? `，跳过 ${parsed.skipped} 条无法识别的记录` : ''}`)
    } catch { say('读取备份文件失败') }
  }
  const backupControls = <div className="library-backup">
    {documents.length > 0 && <button onClick={() => void exportBackup()} title="把全部歌词、手动校准和听音校准结果存成一个文件"><Archive size={13} />导出备份</button>}
    <button onClick={() => backupInput.current?.click()} title="从备份文件恢复：新歌加入，较新的覆盖，其余保留"><Upload size={13} />导入备份</button>
    <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importBackup(file) }} />
  </div>

  if (mode === 'sources') return <div className="content-page">
    <div className="content-page-header"><span>SOURCE PIPELINE</span><h1>歌词源与处理器</h1><p>Syllable 同时查询下面几个来源，自动选出最合适的一份。想换一个来源时，在「正在播放」页点歌名右边的来源标签。</p></div>
    <div className="source-card-grid">
      <article><i className="source-icon cloud"><Cloud size={19} /></i><div><strong>Spotify / Musixmatch</strong><span>远程 · 原文对照</span></div><em>需连接 Web API</em><p>连接 Spotify Web API 后可以取得 Spotify 自带的歌词，用来核对内容和顺序。</p></article>
      <article><i className="source-icon cloud"><Cloud size={19} /></i><div><strong>LRCLIB Exact</strong><span>远程 · 元数据查询</span></div><em><CheckCircle2 size={13} />已启用</em><p>按歌曲、艺人、专辑和时长精确查询。</p></article>
      <article><i className="source-icon search"><Search size={19} /></i><div><strong>LRCLIB Search</strong><span>远程 · 自动回退</span></div><em><CheckCircle2 size={13} />已启用</em><p>以标题和艺人身份为主，结合专辑、版本时长与同步格式评分。</p></article>
      <article><i className="source-icon cloud"><Languages size={19} /></i><div><strong>网易云多语言</strong><span>远程 · 原文与翻译补全</span></div><em><CheckCircle2 size={13} />已启用</em><p>提供原文和人工罗马音；中文翻译优先采用网易云，在确认对应关系后对齐原文。</p></article>
      <article><i className="source-icon search"><Search size={19} /></i><div><strong>酷狗同步歌词</strong><span>远程 · 补充候选</span></div><em><CheckCircle2 size={13} />已启用</em><p>补充候选。会检查语言和录音版本，排除英文版等不匹配的文件。</p></article>
      <article><i className="source-icon local"><Database size={19} /></i><div><strong>Local Library</strong><span>本机 · 最高优先级</span></div><em><CheckCircle2 size={13} />{documents.length} 首</em><p>你导入和编辑过的歌词优先使用。</p></article>
      <article><i className="source-icon roman"><Sparkles size={19} /></i><div><strong>Kuromoji Romanizer</strong><span>本机 · 日文处理</span></div><em><CheckCircle2 size={13} />已启用</em><p>先分析汉字读音，再以 Hepburn 规则生成罗马音。</p></article>
    </div>
    <button className="page-primary-action" onClick={openEditor}><Search size={15} />打开歌词搜索工作台</button>
  </div>

  const libraryTrackPresentation = (document: (typeof documents)[number], field: 'name' | 'artist') => {
    const value = document.track?.[field] ?? ''
    const context = [document.track?.name ?? '', document.track?.artist ?? '', document.track?.album ?? ''].find(hasKana) ?? ''
    const originalLanguage = document.tracks.find(track => track.kind === 'original')?.language
    return scriptPresentation(value, context, originalLanguage)
  }
  return <div className="content-page">
    <div className="content-page-header"><span>LOCAL LIBRARY</span><h1>歌词资料库</h1><p>播放过的歌曲的歌词保存在本机，下次播放直接使用。存得太多时先清掉最久没更新的自动匹配歌词，导入和编辑过的歌词始终保留。</p></div>
    {documents.length > 0 && <div className="library-toolbar">
      <label className="library-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="按歌名、艺人或专辑筛选" aria-label="筛选资料库" />{query && <button title="清除筛选" aria-label="清除筛选" onClick={() => setQuery('')}><X size={13} /></button>}</label>
      <span>{query ? `${shown.length} / ${documents.length} 首` : `共 ${documents.length} 首`}</span>
      {backupControls}
    </div>}
    {!documents.length && <div className="library-toolbar">{backupControls}</div>}
    {backupMessage && <div className="library-undo" role="status"><span>{backupMessage}</span></div>}
    {removed.length > 0 && <div className="library-undo" role="status"><span>{removed.length === 1 ? `已移除「${removed[0].track?.name ?? removed[0].trackId}」` : `已移除 ${removed.length} 首歌`}</span><button onClick={undo}><Undo2 size={13} />撤销</button></div>}
    {!documents.length ? <div className="library-empty"><BookOpen size={31} /><h3>资料库还是空的</h3><p>播放一首 Spotify 歌曲并搜索或导入歌词后，它会出现在这里。</p><button onClick={openEditor}><Search size={14} />搜索歌词</button></div>
    : !shown.length ? <div className="library-empty"><Search size={28} /><h3>没有匹配的歌曲</h3><p>换个关键词试试，歌名、艺人和专辑都可以。</p><button onClick={() => setQuery('')}><X size={14} />清除筛选</button></div>
    : <div className="library-grid">{shown.map(document => <article key={document.trackId}>
      <div className="library-cover" style={document.track?.coverUrl ? undefined : { '--tile-hue': coverTile(document.track?.name).hue } as React.CSSProperties}>{document.track?.coverUrl ? <img src={document.track.coverUrl} /> : <span className="cover-initial" aria-hidden="true">{coverTile(document.track?.name).initial}</span>}</div>
      <div className="library-copy"><strong {...libraryTrackPresentation(document, 'name')}>{document.track?.name ?? document.trackId}</strong><span><span {...libraryTrackPresentation(document, 'artist')}>{document.track?.artist ?? '本地歌词'}</span> · {document.tracks.length} 条轨道</span><div>{document.tracks.map(track => <i key={track.id}>{track.label}</i>)}{librarySourceTag(document) && <i className="source-tag" title="歌词来源">{librarySourceTag(document)}</i>}{libraryTimingTag(document) && <i className="timing-tag" title="这首歌的歌词时间已整体校正">{libraryTimingTag(document)}</i>}</div></div>
      <div className="library-actions"><button title="导出第一条轨道" onClick={() => { const track = document.tracks[0]; if (track) void window.syllable.lyrics.export(`${document.track?.name ?? 'lyrics'}.${track.language}.lrc`.replace(/[<>:"/\\|?*]/g, '_'), serializeLrc(track)).catch(() => undefined) }}><Download size={14} /></button><button title="从资料库移除" onClick={() => remove(document)}><Trash2 size={14} /></button></div>
    </article>)}</div>}
  </div>
}
