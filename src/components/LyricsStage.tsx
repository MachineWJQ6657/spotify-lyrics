import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, LocateFixed, Music2, RefreshCw } from 'lucide-react'
import type { LyricLine, LyricTrack, LyricsDocument } from '../types'
import { activeLineIndex, alignSecondaryTrack, visibleTracks } from '../lib/lyrics'
import { lyricScrollTarget } from '../lib/lyrics-scroll'

interface Props { document: LyricsDocument | null; positionMs: number; enabled: string[]; romanization: boolean; onRetry?: () => void;
  onHeardLine?: (originalTrackId: string, lineIndex: number) => void; onClearCalibration?: () => void; calibrationLabel?: string }

interface LineGroupProps {
  line: LyricLine
  language: string
  index: number
  active: boolean
  past: boolean
  positionMs?: number
  secondary: Array<{ track: LyricTrack; line: LyricLine }>
  onHeard?: (index: number) => void
}

const LineGroup = memo(function LineGroup({ line, language, index, active, past, positionMs = 0, secondary, onHeard }: LineGroupProps) {
  const baseClass = language === 'ja' ? 'japanese-grid' : language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
  return <div data-line-index={index} className={`lyric-group ${active ? 'active' : ''} ${past ? 'past' : ''}`}>
    <div lang={language === 'ja' ? 'ja' : language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`lyric-primary ${active ? 'karaoke-line' : ''} ${baseClass}`}>{line.words?.length ? line.words.map((word, wordIndex) => <span className={positionMs >= word.startMs ? 'sung' : ''} key={`${word.startMs}-${wordIndex}`}>{word.text}</span>) : line.text || <Music2 size={22} />}</div>
    {secondary.map(({ track, line: sibling }) => {
      const trackClass = track.language === 'ja' ? 'japanese-grid' : track.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
      return <div lang={track.language === 'ja' ? 'ja' : track.language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`lyric-secondary ${track.kind} ${trackClass}`} key={track.id}>{sibling.text}</div>
    })}
    {onHeard && <button className="lyric-heard-button" aria-label={`将第 ${index + 1} 行设为现在开始`} onClick={() => onHeard(index)}>这句现在开始</button>}
  </div>
})

export function LyricsStage({ document, positionMs, enabled, romanization, onRetry, onHeardLine, onClearCalibration, calibrationLabel }: Props) {
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

  const centerActive = useCallback((behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current
    const list = listRef.current
    if (!viewport || !list) return
    const current = active >= 0 ? list.querySelector<HTMLElement>(`[data-line-index="${active}"]`) : null
    const top = lyricScrollTarget(active, viewport.clientHeight, current)
    if (top != null) viewport.scrollTo({ top, behavior })
  }, [active])

  useEffect(() => setFollowing(true), [document?.trackId, base?.id])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => {
      setViewportHeight(viewport.clientHeight)
      if (following) centerActive('auto')
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    const current = active >= 0
      ? listRef.current?.querySelector<HTMLElement>(`[data-line-index="${active}"]`)
      : null
    if (current) observer.observe(current)
    return () => observer.disconnect()
  }, [active, base, enabled, romanization, following, centerActive])

  useEffect(() => {
    if (following) centerActive(active > 0 ? 'smooth' : 'auto')
  }, [active, following, centerActive, viewportHeight])

  if (!document) return <div className="empty-lyrics"><span className="spinner" /><p>正在寻找最合适的歌词…</p></div>
  if (document.untimedOriginal) return <div className="lyrics-stage-shell">
    <div className="lyrics-viewport untimed-lyrics" tabIndex={0} aria-label="原文歌词，暂无可信时间轴，可上下滚动查看">
      <div className="info-note"><strong>已取得原文，暂无可信时间轴</strong><p>{document.textReference?.status === 'conflict' ? '已排除与 Spotify 原文冲突的同步歌词。' : '下方原文仅供阅读，不随播放进度滚动。'}</p>{onRetry && <button onClick={onRetry}>重新匹配时间轴</button>}</div>
      <div className="lyrics-list" style={{ paddingTop: 24, paddingBottom: 80 }}>
        {document.untimedOriginal.text.split(/\r?\n/).filter(Boolean).map((text, index) => <div className="lyric-group" key={index}>
          <div lang={document.untimedOriginal!.language} className={`lyric-primary ${document.untimedOriginal!.language === 'ja' ? 'japanese-grid' : document.untimedOriginal!.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'}`}>{text}</div>
        </div>)}
      </div>
    </div>
  </div>
  if (!base?.lines.length) return <div className="empty-lyrics"><AlertCircle size={24} /><h3>暂时没有同步歌词</h3><p>可重新尝试三源匹配，或导入本地 LRC。</p>{onRetry && <button onClick={onRetry}><RefreshCw size={14} />重新匹配歌词</button>}</div>

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
      onPointerDown={() => setFollowing(false)}
      onKeyDownCapture={event => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setFollowing(false)
      }}
    >
      <div ref={listRef} className="lyrics-list" style={{ paddingTop: viewportHeight * .44, paddingBottom: viewportHeight * .56 }}>
        {groups.map(({ line, secondary }, index) => <LineGroup
          key={`${line.startMs}-${index}`} line={line} language={base.language} index={index} secondary={secondary}
          active={index === active} past={index < active} positionMs={index === active && line.words?.length ? positionMs : undefined}
          onHeard={calibrating && onHeardLine ? markHeard : undefined}
        />)}
      </div>
    </div>
    {!following && <button className="lyrics-follow-button" title="同步到正在播放的歌词" onClick={() => {
      // Explicit recovery must not depend on requestAnimationFrame: Chromium
      // can suspend rAF in a minimized/background desktop window, leaving an
      // early-song target at scrollTop=0 permanently stranded below it.
      setFollowing(true)
      centerActive('auto')
    }}><LocateFixed size={15} />回到当前歌词</button>}
  </div>
}
