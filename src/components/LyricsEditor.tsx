import { useEffect, useMemo, useRef, useState } from 'react'
import { sourceLabel } from '../lib/source-label'
import { Clock3, Download, Languages, LoaderCircle, Plus, Save, Search, Trash2, WandSparkles, X } from 'lucide-react'
import type { LyricsCandidate, LyricTrack } from '../types'
import { detectLyricsLanguage, makeRomanizedTrack, makeTrack, serializeLrc } from '../lib/lyrics'
import { formatTime } from '../lib/clock'
import { activeLineIndex } from '../lib/lyrics'
import { useAppStore } from '../store/useAppStore'
import { languagePresentation, scriptPresentation } from '../lib/script'

function editableTime(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  const seconds = ((ms % 60_000) / 1000).toFixed(2).padStart(5, '0')
  return `${minutes}:${seconds}`
}
export function parseEditableTime(value: string) {
  const match = value.trim().match(/^(\d+):([0-5]?\d(?:\.\d{1,3})?)$/)
  return match ? Math.round(Number(match[1]) * 60_000 + Number(match[2]) * 1000) : null
}

/**
 * Typing a time passes through invalid text ("1:2", "1:"), so the field keeps
 * its own draft and commits on Enter or blur; Escape or an invalid value
 * restores the stored time.
 */
function TimeInput({ ms, onCommit }: { ms: number; onCommit(value: number): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && parseEditableTime(draft) === null
  const commit = () => {
    const value = draft === null ? null : parseEditableTime(draft)
    if (value !== null && value !== ms) onCommit(value)
    setDraft(null)
  }
  return <input className={invalid ? 'invalid' : ''} value={draft ?? editableTime(ms)} aria-label="开始时间（分:秒）" title="格式 分:秒，例如 1:23.45；回车确认"
    onFocus={event => event.currentTarget.select()}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); window.setTimeout(() => (event.target as HTMLInputElement).blur()) }
    }} />
}

export function LyricsEditor({ positionMs }: { positionMs: number }) {
  const { editorOpen, setEditorOpen, lyrics, playback, addLyricTrack, removeLyricTrack, updateLyricLine, shiftLyricTrack } = useAppStore()
  const [activeId, setActiveId] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<LyricsCandidate[]>([])
  const [query, setQuery] = useState({ track: '', artist: '' })
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!editorOpen) return
    setActiveId(lyrics?.tracks[0]?.id ?? '')
    setQuery({ track: playback?.track?.name ?? '', artist: playback?.track?.artist ?? '' })
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditorOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [editorOpen])

  const active = useMemo(() => lyrics?.tracks.find(track => track.id === activeId) ?? lyrics?.tracks[0], [lyrics, activeId])
  const playingIndex = active ? activeLineIndex(active.lines, positionMs) : -1
  const listRef = useRef<HTMLDivElement>(null)
  // Open at the line being sung instead of the top of a long file. The clock
  // starts at 0 when the dialog mounts, so wait for the first real position;
  // afterwards the list stays where the user scrolls it.
  const pendingScroll = useRef(true)
  useEffect(() => { pendingScroll.current = true }, [editorOpen, active?.id])
  useEffect(() => {
    if (!editorOpen || !pendingScroll.current || playingIndex < 0) return
    pendingScroll.current = false
    listRef.current?.querySelector<HTMLElement>(`[data-row="${playingIndex}"]`)?.scrollIntoView({ block: 'center' })
  }, [editorOpen, playingIndex])
  const trackQueryPresentation = scriptPresentation(query.track, query.artist)
  const artistQueryPresentation = scriptPresentation(query.artist, query.track)
  if (!editorOpen) return null

  const search = async () => {
    if (!query.track.trim()) return
    setSearching(true); setMessage('')
    try {
      const found = await window.syllable.lyrics.search({ ...query, album: playback?.track?.album, durationMs: playback?.track?.durationMs })
      setResults(found); if (!found.length) setMessage('没有找到候选歌词')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setSearching(false) }
  }
  const applyCandidate = async (candidate: LyricsCandidate) => {
    if (!candidate.syncedLyrics) { setMessage('这个候选只有纯文本歌词，暂时不能自动同步'); return }
    const language = detectLyricsLanguage(candidate.syncedLyrics)
    const label = language === 'ja' ? '日本語' : language === 'zh-Hans' ? '中文原文' : language === 'en' ? 'English' : 'Original'
    const original = makeTrack(`remote-${candidate.id}`, language, label, 'original', candidate.syncedLyrics, `${candidate.provider} · 手动选择`)
    addLyricTrack(original); setActiveId(original.id); setResults([]); setMessage('已应用候选歌词')
    if (language === 'ja') {
      try {
        const converted = await window.syllable.lyrics.romanize(original.lines.map(line => line.text))
        const base = makeRomanizedTrack(original)
        addLyricTrack({ ...base, source: 'Kuroshiro · Kuromoji', lines: base.lines.map((line, index) => ({ ...line, text: converted[index] ?? line.text })) })
      } catch { /* original lyrics remain usable */ }
    }
  }
  const addTranslation = () => {
    const original = lyrics?.tracks.find(track => track.kind === 'original') ?? lyrics?.tracks[0]
    if (!original) return
    const existing = new Set(lyrics?.tracks.map(track => track.language))
    const next = !existing.has('zh-Hans') ? { language: 'zh-Hans', label: '中文' } : !existing.has('en') ? { language: 'en', label: 'English' } : { language: `custom-${Date.now()}`, label: '自定义翻译' }
    const track: LyricTrack = { id: `translation-${Date.now()}`, ...next, kind: 'translation', source: '本地编辑', lines: original.lines.map(line => ({ startMs: line.startMs, endMs: line.endMs, text: '' })) }
    addLyricTrack(track); setActiveId(track.id)
  }
  const exportTrack = async () => {
    if (!active) return
    const safeName = `${playback?.track?.name ?? 'lyrics'}.${active.language}.lrc`.replace(/[<>:"/\\|?*]/g, '_')
    const path = await window.syllable.lyrics.export(safeName, serializeLrc(active))
    if (path) setMessage(`已导出到 ${path}`)
  }

  return <div className="editor-backdrop no-drag" onMouseDown={event => { if (event.target === event.currentTarget) setEditorOpen(false) }}>
    <div className="lyrics-editor">
      <header className="editor-header">
        <div><span>LYRICS WORKSPACE</span><h2>歌词搜索与逐行校时</h2></div>
        <button onClick={() => setEditorOpen(false)}><X size={18} /></button>
      </header>
      <div className="editor-search">
        <div><Search size={14} /><input {...trackQueryPresentation} value={query.track} onChange={event => setQuery({ ...query, track: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !searching) void search() }} placeholder="歌曲名" /><input {...artistQueryPresentation} value={query.artist} onChange={event => setQuery({ ...query, artist: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !searching) void search() }} placeholder="艺人" /></div>
        <button onClick={() => void search()} disabled={searching}>{searching ? <LoaderCircle className="spin-icon" size={14} /> : <Search size={14} />}搜索候选</button>
      </div>
      <div className="candidate-strip">{results.map(item => <button key={item.id} onClick={() => void applyCandidate(item)}><strong {...scriptPresentation(item.trackName, item.artistName)}>{item.trackName}</strong><span><span {...scriptPresentation(item.artistName, item.trackName)}>{item.artistName}</span> · {formatTime(item.durationMs)}</span><i>待核验</i></button>)}</div>
      <div className="editor-toolbar">
        <div className="track-tabs">{lyrics?.tracks.map(track => <button className={`${track.id === active?.id ? 'active' : ''} ${languagePresentation(track.language).className}`} lang={languagePresentation(track.language).lang} onClick={() => setActiveId(track.id)} key={track.id}><i />{track.label}<small>{track.lines.length}</small></button>)}</div>
        <div className="editor-actions">
          <button onClick={addTranslation}><Plus size={13} />新建翻译</button>
          <button disabled={!active} onClick={() => active && shiftLyricTrack(active.id, -100)}>-100ms</button>
          <button disabled={!active} onClick={() => active && shiftLyricTrack(active.id, 100)}>+100ms</button>
          <button disabled={!active} onClick={() => void exportTrack()}><Download size={13} />导出</button>
          <button className="danger" disabled={!active || active.kind === 'original'} onClick={() => active && removeLyricTrack(active.id)}><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="editor-body">
        {!active ? <div className="editor-empty"><Languages size={28} /><h3>还没有歌词轨道</h3><p>在上方搜索同步歌词，或回到主界面导入 LRC。</p></div> : <>
          <div className="editor-columns"><span>#</span><span>时间</span><span>歌词文本</span><span /></div>
          <div ref={listRef} className="line-editor-list">{active.lines.map((line, index) => <div data-row={index} className={`line-editor-row ${index === playingIndex ? 'playing' : ''}`} key={`${line.startMs}-${index}`}>
            <span className="line-number">{String(index + 1).padStart(2, '0')}</span>
            <div className="time-editor"><Clock3 size={12} /><TimeInput ms={line.startMs} onCommit={value => updateLyricLine(active.id, index, { startMs: value })} /></div>
            <input className={`text-editor ${languagePresentation(active.language).className}`} lang={languagePresentation(active.language).lang} value={line.text} placeholder={active.kind === 'translation' ? '输入这一行的翻译…' : '歌词文本'} onChange={event => updateLyricLine(active.id, index, { text: event.target.value })} />
            <button className="stamp-button" title="设为当前播放时间" onClick={() => updateLyricLine(active.id, index, { startMs: positionMs })}><WandSparkles size={13} />取当前</button>
          </div>)}</div>
        </>}
      </div>
      <footer className="editor-footer"><span>{message || `${sourceLabel(active?.source ?? '未选择轨道')} · 所有修改会自动保存`}</span><button onClick={() => setEditorOpen(false)}><Save size={13} />完成</button></footer>
    </div>
  </div>
}
