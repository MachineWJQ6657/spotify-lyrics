import { BookOpen, CheckCircle2, Cloud, Database, Download, FileText, Languages, Search, Sparkles, Trash2 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { serializeLrc } from '../lib/lyrics'
import { hasKana, scriptPresentation } from '../lib/script'

export function LibraryView({ mode, openEditor }: { mode: 'library' | 'sources'; openEditor(): void }) {
  const library = useAppStore(state => state.library)
  const deleteDocument = useAppStore(state => state.deleteLibraryDocument)
  const documents = Object.values(library).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  if (mode === 'sources') return <div className="content-page">
    <div className="content-page-header"><span>SOURCE PIPELINE</span><h1>歌词源与处理器</h1><p>自动匹配会依次经过精确查询、候选搜索、可信度评分与本地缓存。</p></div>
    <div className="source-card-grid">
      <article><i className="source-icon cloud"><Cloud size={19} /></i><div><strong>LRCLIB Exact</strong><span>远程 · 第一优先级</span></div><em><CheckCircle2 size={13} />已启用</em><p>按歌曲、艺人、专辑和时长进行精确匹配。</p></article>
      <article><i className="source-icon search"><Search size={19} /></i><div><strong>LRCLIB Search</strong><span>远程 · 自动回退</span></div><em><CheckCircle2 size={13} />已启用</em><p>以标题和艺人身份为主，结合专辑、版本时长与同步格式评分。</p></article>
      <article><i className="source-icon cloud"><Languages size={19} /></i><div><strong>网易云多语言</strong><span>远程 · 翻译与罗马音补全</span></div><em><CheckCircle2 size={13} />已启用</em><p>在独立时间轴中补齐中文翻译和人工罗马音，单源失败不会阻断显示。</p></article>
      <article><i className="source-icon search"><Search size={19} /></i><div><strong>酷狗同步歌词</strong><span>远程 · 完整度回退</span></div><em><CheckCircle2 size={13} />已启用</em><p>现有结果缺段时补充候选，并按版本时长、有效行数和尾部覆盖率择优。</p></article>
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
    {!documents.length ? <div className="library-empty"><BookOpen size={31} /><h3>资料库还是空的</h3><p>播放一首 Spotify 歌曲并搜索或导入歌词后，它会出现在这里。</p><button onClick={openEditor}><Search size={14} />搜索歌词</button></div> : <div className="library-grid">{documents.map(document => <article key={document.trackId}>
      <div className="library-cover">{document.track?.coverUrl ? <img src={document.track.coverUrl} /> : <FileText size={20} />}</div>
      <div className="library-copy"><strong {...libraryTrackPresentation(document, 'name')}>{document.track?.name ?? document.trackId}</strong><span><span {...libraryTrackPresentation(document, 'artist')}>{document.track?.artist ?? '本地歌词'}</span> · {document.tracks.length} 条轨道</span><div>{document.tracks.map(track => <i key={track.id}>{track.label}</i>)}</div></div>
      <div className="library-actions"><button title="导出第一条轨道" onClick={() => { const track = document.tracks[0]; if (track) void window.syllable.lyrics.export(`${document.track?.name ?? 'lyrics'}.${track.language}.lrc`, serializeLrc(track)) }}><Download size={14} /></button><button title="从资料库移除" onClick={() => deleteDocument(document.trackId)}><Trash2 size={14} /></button></div>
    </article>)}</div>}
  </div>
}
