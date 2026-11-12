import { useEffect, useRef, useState } from 'react'
import { BookOpen, CheckCircle2, Cloud, Database, Download, FileText, Languages, Search, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { LyricsDocument } from '../types'
import { listenedLyricsOffset } from '../lib/listened-offset'
import { shiftAmount, shiftDirection } from '../lib/timing-status'
import { serializeLrc } from '../lib/lyrics'
import { hasKana, scriptPresentation } from '../lib/script'

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

export function LibraryView({ mode, openEditor }: { mode: 'library' | 'sources'; openEditor(): void }) {
  const library = useAppStore(state => state.library)
  const deleteDocument = useAppStore(state => state.deleteLibraryDocument)
  const restoreDocument = useAppStore(state => state.restoreLibraryDocument)
  const documents = Object.values(library).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const [query, setQuery] = useState('')
  const [removed, setRemoved] = useState<LyricsDocument | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(undoTimer.current), [])
  const remove = (document: LyricsDocument) => {
    deleteDocument(document.trackId)
    setRemoved(document)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setRemoved(null), 6000)
  }
  const undo = () => {
    if (removed) restoreDocument(removed)
    window.clearTimeout(undoTimer.current)
    setRemoved(null)
  }
  const shown = documents.filter(document => matchesLibraryQuery(document, query))

  if (mode === 'sources') return <div className="content-page">
    <div className="content-page-header"><span>SOURCE PIPELINE</span><h1>歌词源与处理器</h1><p>先核对歌曲与语言版本，再比较歌词内容和完整度。元数据匹配分数不是歌词准确率，原文相符也不代表时间同步。</p></div>
    <div className="source-card-grid">
      <article><i className="source-icon cloud"><Cloud size={19} /></i><div><strong>Spotify / Musixmatch</strong><span>远程 · 原文对照</span></div><em>需实际取得数据</em><p>已有授权能够取得原文时，用于核对内容与顺序。本机播放连接不等于歌词访问权限；不把 Spotify 时间轴当作人声同步真值。</p></article>
      <article><i className="source-icon cloud"><Cloud size={19} /></i><div><strong>LRCLIB Exact</strong><span>远程 · 元数据查询</span></div><em><CheckCircle2 size={13} />已启用</em><p>按歌曲、艺人、专辑和时长查询。元数据一致仍可能是错误原文或翻译，必须继续核对内容。</p></article>
      <article><i className="source-icon search"><Search size={19} /></i><div><strong>LRCLIB Search</strong><span>远程 · 自动回退</span></div><em><CheckCircle2 size={13} />已启用</em><p>以标题和艺人身份为主，结合专辑、版本时长与同步格式评分。</p></article>
      <article><i className="source-icon cloud"><Languages size={19} /></i><div><strong>网易云多语言</strong><span>远程 · 原文与翻译补全</span></div><em><CheckCircle2 size={13} />已启用</em><p>提供原文和人工罗马音；中文翻译优先采用网易云，在确认对应关系后对齐原文。</p></article>
      <article><i className="source-icon search"><Search size={19} /></i><div><strong>酷狗同步歌词</strong><span>远程 · 补充候选</span></div><em><CheckCircle2 size={13} />已启用</em><p>下载后再次检查文件中的语言与录音版本，拒绝英文版等错配。候选仍需内容核对，不显示虚假的准确率。</p></article>
      <article><i className="source-icon local"><Database size={19} /></i><div><strong>Local Library</strong><span>本机 · 最高优先级</span></div><em><CheckCircle2 size={13} />{documents.length} 首</em><p>用户校对和导入的数据不会被远程结果覆盖。</p></article>
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
    <div className="content-page-header"><span>LOCAL LIBRARY</span><h1>歌词资料库</h1><p>所有导入、搜索和手动校时的歌词都按 Spotify Track ID 保存在本机。</p></div>
    {documents.length > 0 && <div className="library-toolbar">
      <label className="library-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="按歌名、艺人或专辑筛选" aria-label="筛选资料库" />{query && <button title="清除筛选" aria-label="清除筛选" onClick={() => setQuery('')}><X size={13} /></button>}</label>
      <span>{query ? `${shown.length} / ${documents.length} 首` : `共 ${documents.length} 首`}</span>
    </div>}
    {removed && <div className="library-undo" role="status"><span>已移除「{removed.track?.name ?? removed.trackId}」</span><button onClick={undo}><Undo2 size={13} />撤销</button></div>}
    {!documents.length ? <div className="library-empty"><BookOpen size={31} /><h3>资料库还是空的</h3><p>播放一首 Spotify 歌曲并搜索或导入歌词后，它会出现在这里。</p><button onClick={openEditor}><Search size={14} />搜索歌词</button></div>
    : !shown.length ? <div className="library-empty"><Search size={28} /><h3>没有匹配的歌曲</h3><p>换个关键词试试，歌名、艺人和专辑都可以。</p><button onClick={() => setQuery('')}><X size={14} />清除筛选</button></div>
    : <div className="library-grid">{shown.map(document => <article key={document.trackId}>
      <div className="library-cover">{document.track?.coverUrl ? <img src={document.track.coverUrl} /> : <FileText size={20} />}</div>
      <div className="library-copy"><strong {...libraryTrackPresentation(document, 'name')}>{document.track?.name ?? document.trackId}</strong><span><span {...libraryTrackPresentation(document, 'artist')}>{document.track?.artist ?? '本地歌词'}</span> · {document.tracks.length} 条轨道</span><div>{document.tracks.map(track => <i key={track.id}>{track.label}</i>)}{libraryTimingTag(document) && <i className="timing-tag" title="这首歌的歌词时间已整体校正">{libraryTimingTag(document)}</i>}</div></div>
      <div className="library-actions"><button title="导出第一条轨道" onClick={() => { const track = document.tracks[0]; if (track) void window.syllable.lyrics.export(`${document.track?.name ?? 'lyrics'}.${track.language}.lrc`, serializeLrc(track)) }}><Download size={14} /></button><button title="从资料库移除" onClick={() => remove(document)}><Trash2 size={14} /></button></div>
    </article>)}</div>}
  </div>
}
