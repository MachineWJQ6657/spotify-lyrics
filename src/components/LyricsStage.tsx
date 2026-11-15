import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ChevronDown, ChevronUp, Copy, LocateFixed, Music2, Play, RefreshCw, Search, X } from 'lucide-react'
import type { LyricLine, LyricTrack, LyricsDocument } from '../types'
import { activeLineIndex, alignSecondaryTrack, visibleTracks } from '../lib/lyrics'
import { lyricScrollTarget } from '../lib/lyrics-scroll'
import { findLineMatches, nearestMatch, stepMatch } from '../lib/find-lyrics'
import { rowText, songText } from '../lib/copy-lyrics'

interface Props { document: LyricsDocument | null; positionMs: number; enabled: string[]; romanization: boolean; onRetry?: () => void;
  onHeardLine?: (originalTrackId: string, lineIndex: number) => void; onClearCalibration?: () => void; calibrationLabel?: string
  /** Click a line to play from it; `seekLabel` names the song time it jumps to. */
  onSeekLine?: (line: LyricLine) => void; seekLabel?: (line: LyricLine) => string; onSearch?: () => void }

interface LineGroupProps {
  line: LyricLine
  language: string
  index: number
  active: boolean
  past: boolean
  positionMs?: number
  secondary: Array<{ track: LyricTrack; line: LyricLine }>
  onHeard?: (index: number) => void
  onSeek?: (index: number) => void
  seekLabel?: string
  /** Find-in-lyrics: this row contains the query (`current` is the one scrolled to). */
  found?: 'match' | 'current'
  /** Right-click: open the row's menu at the pointer. */
  onMenu?: (index: number, x: number, y: number) => void
}

const LineGroup = memo(function LineGroup({ line, language, index, active, past, positionMs = 0, secondary, onHeard, onSeek, seekLabel, found, onMenu }: LineGroupProps) {
  const baseClass = language === 'ja' ? 'japanese-grid' : language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
  const seekable = Boolean(onSeek && !onHeard)
  return <div data-line-index={index} className={`lyric-group ${active ? 'active' : ''} ${past ? 'past' : ''} ${seekable ? 'seekable' : ''} ${found ? `find-${found}` : ''}`}
    title={seekable && seekLabel ? `从 ${seekLabel} 播放这一句` : undefined}
    onContextMenu={onMenu ? event => { event.preventDefault(); onMenu(index, event.clientX, event.clientY) } : undefined}
    onClick={seekable ? () => {
      // Selecting text with the mouse also ends in a click; that is not a seek.
      if (window.getSelection()?.toString()) return
      onSeek!(index)
    } : undefined}>
    <div lang={language === 'ja' ? 'ja' : language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`lyric-primary ${active ? 'karaoke-line' : ''} ${baseClass}`}>{line.words?.length ? line.words.map((word, wordIndex) => <span className={positionMs >= word.startMs ? 'sung' : ''} key={`${word.startMs}-${wordIndex}`}>{word.text}</span>) : line.text || <Music2 size={22} />}</div>
    {secondary.map(({ track, line: sibling }) => {
      const trackClass = track.language === 'ja' ? 'japanese-grid' : track.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
      return <div lang={track.language === 'ja' ? 'ja' : track.language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`lyric-secondary ${track.kind} ${trackClass}`} key={track.id}>{sibling.text}</div>
    })}
    {seekable && seekLabel && <span className="lyric-seek-hint" aria-hidden="true"><Play size={10} fill="currentColor" />{seekLabel}</span>}
    {onHeard && <button className="lyric-heard-button" aria-label={`将第 ${index + 1} 行设为现在开始`} onClick={() => onHeard(index)}>这句现在开始</button>}
  </div>
})

export function LyricsStage({ document, positionMs, enabled, romanization, onRetry, onHeardLine, onClearCalibration, calibrationLabel, onSeekLine, seekLabel, onSearch }: Props) {
  const tracks = useMemo(() => visibleTracks(document, enabled, romanization), [document, enabled, romanization])
  const base = tracks.find(track => track.kind === 'original') ?? tracks[0]
  const active = base ? activeLineIndex(base.lines, positionMs) : -1
  const groups = useMemo(() => {
    if (!base) return []
    const aligned = tracks.filter(track => track.id !== base.id)
      .map(track => ({ track, lines: alignSecondaryTrack(base.lines, track.lines) }))
    return base.lines.map((line, index) => ({
      line,
      secondary: aligned.flatMap(({ track, lines }) => lines[index] ? [{ track, line: lines[index]! }] : [])
    }))
  }, [base, tracks])
  const viewportRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrationError, setCalibrationError] = useState('')
  const markHeard = useCallback((index: number) => {
    if (!base || base.kind !== 'original' || !onHeardLine) return
    try {
      onHeardLine(base.id, index)
      setCalibrating(false); setFollowing(true); setCalibrationError('')
    } catch (error) { setCalibrationError(error instanceof Error ? error.message : String(error)) }
  }, [base, onHeardLine])
  useEffect(() => { setCalibrating(false); setCalibrationError('') }, [document?.trackId, base?.id])
  const seekLine = useCallback((index: number) => {
    const line = base?.lines[index]
    if (!line || !onSeekLine) return
    onSeekLine(line)
    setFollowing(true)
  }, [base, onSeekLine])

  const centerActive = useCallback((behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current
    const list = listRef.current
    if (!viewport || !list) return
    const current = active >= 0 ? list.querySelector<HTMLElement>(`[data-line-index="${active}"]`) : null
    const top = lyricScrollTarget(active, viewport.clientHeight, current)
    if (top != null) viewport.scrollTo({ top, behavior })
  }, [active])

  useEffect(() => setFollowing(true), [document?.trackId, base?.id])

  // Find in lyrics (Ctrl+F): rows whose original, romaji or translation
  // contains the query are marked, and Enter walks through them.
  const [find, setFind] = useState<{ query: string; cursor: number } | null>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const rowTexts = useMemo(() => groups.map(group => [group.line.text, ...group.secondary.map(item => item.line.text)]), [groups])
  const matches = useMemo(() => find?.query ? findLineMatches(rowTexts, find.query) : [], [rowTexts, find?.query])
  const findCursor = find && matches.length ? Math.min(find.cursor, matches.length - 1) : -1
  const currentMatch = findCursor >= 0 ? matches[findCursor] : -1
  const searchable = groups.length > 0 && !document?.untimedOriginal
  const openFind = useCallback(() => {
    setFind(current => current ?? { query: '', cursor: 0 })
    findInput.current?.focus()
    findInput.current?.select()
  }, [])
  useEffect(() => {
    if (!searchable) return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return
      // The lyrics editor has its own search box.
      if (window.document.querySelector('.editor-backdrop')) return
      event.preventDefault()
      openFind()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchable, openFind])
  useEffect(() => setFind(null), [document?.trackId])
  // Esc closes the find bar wherever the focus is (after clicking a line it is
  // no longer in the input, and the bar's tooltip still says Esc). An open
  // menu or the editor takes the key first.
  const findOpen = find != null
  useEffect(() => {
    if (!findOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (window.document.querySelector('.editor-backdrop, .lyric-menu, .source-popover')) return
      setFind(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [findOpen])

  // Right-click a row: copy it or the whole song, play from it, or search.
  const [menu, setMenu] = useState<{ index: number; x: number; y: number; selection: string; startMs: number; text: string } | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const menuRef = useRef<HTMLDivElement>(null)
  const openMenu = useCallback((index: number, x: number, y: number) => {
    const line = base?.lines[index]
    if (line) setMenu({ index, x, y, selection: window.getSelection()?.toString().trim() ?? '', startMs: line.startMs, text: line.text })
  }, [base])
  // The same song's lyrics were replaced under an open menu (another source,
  // an edit): its row number now names another line, so the menu closes
  // instead of copying or playing that one.
  const menuRow = menu ? base?.lines[menu.index] : undefined
  const menuStale = Boolean(menu && (menuRow?.startMs !== menu.startMs || menuRow?.text !== menu.text))
  useEffect(() => { if (menuStale) setMenu(null) }, [menuStale])
  const copyText = useCallback((text: string, done: string) => {
    setMenu(null)
    if (!text) return
    const show = (message: string) => {
      setToast(message)
      window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(''), 1800)
    }
    // Main-process clipboard first (works without window focus); the web API is the fallback.
    const write = window.syllable.app?.copyText
      ? window.syllable.app.copyText(text).then(ok => ok ? undefined : navigator.clipboard.writeText(text))
      : navigator.clipboard.writeText(text)
    void write.then(() => show(done), () => show('复制失败'))
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  useEffect(() => setMenu(null), [document?.trackId])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    // The click that dismisses the menu must not also seek to the row under it.
    const swallow = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault() }
    const outside = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      close()
      if (event.button !== 0) return
      window.addEventListener('click', swallow, true)
      window.addEventListener('mouseup', () => window.setTimeout(() => window.removeEventListener('click', swallow, true), 0), { once: true })
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('mousedown', outside)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', outside); window.removeEventListener('wheel', close)
      window.removeEventListener('blur', close); window.removeEventListener('resize', close); window.removeEventListener('keydown', escape)
    }
  }, [menu])
  useEffect(() => {
    if (currentMatch < 0) return
    const viewport = viewportRef.current
    const row = listRef.current?.querySelector<HTMLElement>(`[data-line-index="${currentMatch}"]`)
    const top = viewport ? lyricScrollTarget(currentMatch, viewport.clientHeight, row) : null
    if (!viewport || top == null) return
    setFollowing(false)
    viewport.scrollTo({ top, behavior: 'smooth' })
  }, [currentMatch, find?.query])

  const centerRef = useRef(centerActive)
  centerRef.current = centerActive
  // The lyrics, the visible tracks or the follow state changed: measure and
  // jump to the sung line before paint.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setViewportHeight(viewport.clientHeight)
    if (following) centerRef.current('auto')
  }, [base, enabled, romanization, following])
  // The viewport or the sung row changed size (window resize, fonts, a
  // translation arriving): jump again. Starting to observe reports once at
  // once; that is not a size change. Reacting to it (and running the jump
  // above on every new line) centred each line instantly, so the smooth
  // scroll below never had anything left to do and the list snapped.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let primed = false
    const observer = new ResizeObserver(() => {
      if (!primed) { primed = true; return }
      setViewportHeight(viewport.clientHeight)
      if (following) centerRef.current('auto')
    })
    observer.observe(viewport)
    const current = active >= 0
      ? listRef.current?.querySelector<HTMLElement>(`[data-line-index="${active}"]`)
      : null
    if (current) observer.observe(current)
    return () => observer.disconnect()
  }, [active, base, enabled, romanization, following])

  // A new line glides into place while the window is on screen. A hidden or
  // minimized window does not animate (Chromium suspends its frames), so
  // there the list jumps, and it jumps once more when the window comes back.
  const centredLine = useRef(active)
  useEffect(() => {
    // Only a new line glides. The first layout (the list's padding follows the
    // measured height), a resize or following again jump: gliding there moved
    // the list by almost half the viewport when the lyrics first appeared.
    const lineChanged = centredLine.current !== active
    centredLine.current = active
    if (!following) return
    const animated = lineChanged && active > 0 && window.document.visibilityState === 'visible'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    centerActive(animated ? 'smooth' : 'auto')
  }, [active, following, centerActive, viewportHeight])
  useEffect(() => {
    if (!following) return
    const onVisible = () => { if (window.document.visibilityState === 'visible') centerRef.current('auto') }
    window.document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => { window.document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible) }
  }, [following])

  if (!document) return <div className="empty-lyrics"><span className="spinner" /><p>正在寻找最合适的歌词…</p></div>
  if (document.untimedOriginal) return <div className="lyrics-stage-shell">
    <div className="lyrics-viewport untimed-lyrics" tabIndex={0} aria-label="原文歌词，暂无可信时间轴，可上下滚动查看">
      <div className="info-note"><strong>已取得原文，暂无可信时间轴</strong><p>{document.textReference?.status === 'conflict' ? '已排除与 Spotify 原文冲突的同步歌词。' : '下方是歌词原文，不随播放滚动。'}</p>{onRetry && <button onClick={onRetry}>重新匹配时间轴</button>}</div>
      <div className="lyrics-list" style={{ paddingTop: 24, paddingBottom: 80 }}>
        {document.untimedOriginal.text.split(/\r?\n/).filter(Boolean).map((text, index) => <div className="lyric-group" key={index}>
          <div lang={document.untimedOriginal!.language} className={`lyric-primary ${document.untimedOriginal!.language === 'ja' ? 'japanese-grid' : document.untimedOriginal!.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'}`}>{text}</div>
        </div>)}
      </div>
    </div>
  </div>
  if (!base?.lines.length && document?.instrumental) return <div className="empty-lyrics instrumental"><Music2 size={24} /><h3>纯音乐</h3><p>歌词源确认这首歌没有歌词。</p>{onSearch && <button className="quiet" onClick={onSearch}><Search size={14} />不是纯音乐？手动搜索</button>}</div>
  if (!base?.lines.length) return <div className="empty-lyrics"><AlertCircle size={24} /><h3>暂时没有同步歌词</h3><p>可重新尝试三源匹配、换个关键词手动搜索，或把 LRC 文件拖进窗口。</p><div className="empty-actions">{onRetry && <button onClick={onRetry}><RefreshCw size={14} />重新匹配歌词</button>}{onSearch && <button className="quiet" onClick={onSearch}><Search size={14} />手动搜索</button>}</div></div>

  return <div className={`lyrics-stage-shell ${calibrating ? 'is-calibrating' : ''}`}>
    {base.kind === 'original' && (onHeardLine || calibrationLabel) && <div className="lyrics-calibration-bar">
      <div className="lyrics-calibration-actions">
        <button disabled={!onHeardLine} aria-pressed={calibrating} onClick={() => { setCalibrating(!calibrating); setFollowing(false); setCalibrationError('') }}>{calibrating ? '取消选句' : '跟歌声校准'}</button>
        {calibrationLabel && <><span>{calibrationLabel}</span><button onClick={onClearCalibration}>撤销本次</button></>}
      </div>
      {calibrating && <p>滚动找到正在听的段落，在一句刚开始唱时点“这句现在开始”。只改歌词，不跳转歌曲；暂停、跳转或换歌后清除。</p>}
      {calibrationError && <p role="alert">{calibrationError}</p>}
    </div>}
    <div
      ref={viewportRef}
      className="lyrics-viewport"
      tabIndex={0}
      aria-label="同步歌词，可上下滚动查看"
      onWheelCapture={() => setFollowing(false)}
      onPointerDown={event => {
        // A right-click opens the row menu; it is not scrolling away. It used
        // to stop the list following the song until 回到当前歌词 was clicked.
        if (event.button !== 2) setFollowing(false)
      }}
      onKeyDownCapture={event => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setFollowing(false)
      }}
    >
      <div ref={listRef} className="lyrics-list" style={{ paddingTop: viewportHeight * .44, paddingBottom: viewportHeight * .56 }}>
        {groups.map(({ line, secondary }, index) => <LineGroup
          key={`${line.startMs}-${index}`} line={line} language={base.language} index={index} secondary={secondary}
          active={index === active} past={index < active} positionMs={index === active && line.words?.length ? positionMs : undefined}
          onHeard={calibrating && onHeardLine ? markHeard : undefined}
          onSeek={onSeekLine ? seekLine : undefined} seekLabel={onSeekLine && seekLabel ? seekLabel(line) : undefined}
          found={index === currentMatch ? 'current' : find?.query && matches.includes(index) ? 'match' : undefined}
          onMenu={calibrating ? undefined : openMenu}
        />)}
      </div>
    </div>
    {find ? <div className="lyrics-find" role="search">
      <Search size={14} aria-hidden="true" />
      <input ref={findInput} autoFocus value={find.query} placeholder="在歌词中查找" aria-label="在歌词中查找" spellCheck={false}
        onChange={event => { const query = event.target.value; setFind({ query, cursor: nearestMatch(findLineMatches(rowTexts, query), active) }) }}
        onKeyDown={event => {
          // Enter that confirms an IME candidate is not "next match".
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') { event.preventDefault(); setFind(null) }
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (event.ctrlKey && currentMatch >= 0 && onSeekLine) seekLine(currentMatch)
          else if (matches.length) setFind({ query: find.query, cursor: stepMatch(findCursor, matches.length, event.shiftKey ? -1 : 1) })
        }} />
      <span className="lyrics-find-count" role="status">{!find.query.trim() ? '' : matches.length ? `${findCursor + 1} / ${matches.length}` : '没有找到'}</span>
      <button title="上一处（Shift+Enter）" aria-label="上一处" disabled={matches.length < 2} onClick={() => setFind({ query: find.query, cursor: stepMatch(findCursor, matches.length, -1) })}><ChevronUp size={15} /></button>
      <button title="下一处（Enter）" aria-label="下一处" disabled={matches.length < 2} onClick={() => setFind({ query: find.query, cursor: stepMatch(findCursor, matches.length, 1) })}><ChevronDown size={15} /></button>
      <button title="关闭（Esc）" aria-label="关闭查找" onClick={() => setFind(null)}><X size={15} /></button>
    </div> : searchable && <button className="lyrics-find-open" title="在歌词中查找（Ctrl+F）" aria-label="在歌词中查找" onClick={openFind}><Search size={14} /></button>}
    {menu && createPortal(<div ref={menuRef} className="lyric-menu no-drag" role="menu" aria-label="歌词操作"
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 268)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 250)) }}>
      {menu.selection && <button type="button" role="menuitem" onClick={() => copyText(menu.selection, '已复制选中的文字')}><Copy size={14} />复制选中的文字</button>}
      <button type="button" role="menuitem" disabled={!rowText(rowTexts[menu.index] ?? [])} onClick={() => copyText(rowText(rowTexts[menu.index] ?? []), '已复制这一句')}><Copy size={14} />复制这一句</button>
      <button type="button" role="menuitem" onClick={() => copyText(songText(rowTexts, false), '已复制整首歌词')}><Copy size={14} />复制整首歌词</button>
      {rowTexts.some(texts => texts.slice(1).some(text => text.trim())) && <button type="button" role="menuitem" onClick={() => copyText(songText(rowTexts, true), '已复制整首歌词')}><Copy size={14} />复制整首歌词（含罗马音和翻译）</button>}
      <i role="separator" />
      {onSeekLine && base.lines[menu.index] && <button type="button" role="menuitem" onClick={() => { const index = menu.index; setMenu(null); seekLine(index) }}><Play size={14} />从这一句播放{seekLabel ? `（${seekLabel(base.lines[menu.index])}）` : ''}</button>}
      <button type="button" role="menuitem" onClick={() => { setMenu(null); openFind() }}><Search size={14} />在歌词中查找<kbd>Ctrl+F</kbd></button>
    </div>, window.document.body)}
    {toast && <div className="lyrics-toast" role="status">{toast}</div>}
    {!following && <button className="lyrics-follow-button" title="同步到正在播放的歌词" onClick={() => {
      // Explicit recovery must not depend on requestAnimationFrame: Chromium
      // can suspend rAF in a minimized/background desktop window, leaving an
      // early-song target at scrollTop=0 permanently stranded below it.
      setFollowing(true)
      centerActive('auto')
    }}><LocateFixed size={15} />回到当前歌词</button>}
  </div>
}
