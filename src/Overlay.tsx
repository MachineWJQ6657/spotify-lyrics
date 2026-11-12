import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { finishPointerDrag } from './lib/pointer-drag'
import { usePlaybackConnection } from './hooks/usePlayback'
import { usePosition } from './hooks/usePosition'
import { useAppStore } from './store/useAppStore'
import { activeLineIndex, alignSecondaryTrack, visibleTracks } from './lib/lyrics'
import { useWindowSync } from './hooks/useWindowSync'
import { displayLyricsOffset } from './lib/listened-offset'
import { displayedLyricPosition } from './lib/session-calibration'
import { FIT_START, fitSearchStep, overlayContent, type FitSearch } from './lib/overlay-content'
import { scriptPresentation } from './lib/script'
import { msUntilNextLyricChange, wallDelayMs } from './lib/lyric-clock'
import { activeAcousticAnchor } from './lib/clock'

export function Overlay() {
  usePlaybackConnection(false, false)
  const settingsReady = useWindowSync()
  const { playback, lyrics, settings, patchSettings, sessionCalibration } = useAppStore()
  useLayoutEffect(() => {
    if (settingsReady) void window.syllable.overlay.ready()
  }, [settingsReady])
  const activeLyrics = !playback?.track || lyrics?.trackId === playback.track.id ? lyrics : null
  const offsetMs = displayLyricsOffset(activeLyrics, playback?.playbackSource === 'demo' ? settings.offsetMs : 0, settings.listenOffset !== false)
  const tracks = useMemo(() => visibleTracks(activeLyrics, settings.enabledLanguages, settings.romanization), [activeLyrics, settings.enabledLanguages, settings.romanization])
  const base = tracks.find(track => track.kind === 'original') ?? tracks[0]
  // Wake when the next line or word starts (at most 500 ms apart), not on a
  // fixed 80 ms tick: lines switch on time and idle lines cost ~2 renders/s.
  const nextDue = (clockMs: number) => base ? wallDelayMs(msUntilNextLyricChange(base.lines,
    displayedLyricPosition(clockMs, playback, activeLyrics, offsetMs, sessionCalibration)), activeAcousticAnchor(playback)?.rate) : undefined
  const position = displayedLyricPosition(usePosition(playback, 500, nextDue), playback, activeLyrics, offsetMs, sessionCalibration)
  const baseClass = base?.language === 'ja' ? 'japanese-grid' : base?.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
  const index = base ? activeLineIndex(base.lines, position) : -1
  const line = base?.lines[index]
  const alignedSecondaries = useMemo(() => base ? tracks.filter(track => track.id !== base.id).map(track => ({ track, lines: alignSecondaryTrack(base.lines, track.lines) })) : [], [base, tracks])
  const secondaries = line ? alignedSecondaries.map(({ track, lines }) => ({ track, line: lines[index] })).filter(item => item.line) : []
  const content = overlayContent(playback, activeLyrics, line)
  const titlePresentation = content.kind === 'title' ? scriptPresentation(content.title, `${playback?.track?.artist ?? ''} ${playback?.track?.album ?? ''}`, base?.language) : null
  const hitRegionText = JSON.stringify([Boolean(activeLyrics?.untimedOriginal), content.kind, content.kind === 'title' ? [content.title, content.subtitle] : line?.text, ...secondaries.map(item => [item.track.id, item.line?.text])])
  const paused = Boolean(playback?.track) && !playback?.isPlaying
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; active: boolean } | null>(null)
  const layoutGeneration = useRef(0)
  const [layoutRevision, setLayoutRevision] = useState(0)
  // Shrink a line that does not fit the window (a long line wrapping to three
  // rows plus romaji and translation) instead of clipping its first and last
  // rows. Re-measured whenever the text, type settings, window or fonts change.
  const lyricsRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => `${window.innerWidth}x${window.innerHeight}`)
  const [fontsRevision, setFontsRevision] = useState(0)
  useEffect(() => {
    const resize = () => setViewport(`${window.innerWidth}x${window.innerHeight}`)
    const fonts = () => setFontsRevision(value => value + 1)
    window.addEventListener('resize', resize)
    document.fonts.addEventListener('loadingdone', fonts)
    void document.fonts.ready.then(fonts)
    return () => { window.removeEventListener('resize', resize); document.fonts.removeEventListener('loadingdone', fonts) }
  }, [])
  const fitKey = `${hitRegionText}|${settings.fontSize}|${settings.fontWeight}|${settings.lineHeight}|${viewport}|${fontsRevision}|${layoutRevision}`
  const [fitState, setFitState] = useState<{ key: string; search: FitSearch }>({ key: '', search: FIT_START })
  const fitSearch = fitState.key === fitKey ? fitState.search : FIT_START
  const fit = fitSearch.value
  useLayoutEffect(() => {
    const box = lyricsRef.current, inner = contentRef.current
    if (!box || !inner || fitSearch.done) return
    const style = getComputedStyle(box)
    const available = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    const needed = inner.scrollHeight
    if (!(available > 0) || !(needed > 0)) return
    const fits = needed <= available + .5
    // The common case (fits at full size) costs no extra render.
    if (fits && fitSearch === FIT_START) return
    setFitState({ key: fitKey, search: fitSearchStep(fitSearch, fits) })
  }, [fitKey, fitSearch])
  useEffect(() => {
    let frame = 0
    let pending = false
    const publish = () => {
      frame = 0
      if (pending) { pending = false; window.syllable.overlay.pointerMoved() }
    }
    const move = () => {
      if (frame) { pending = true; return }
      // Do not delay the first entry behind a frame: a quick click/drag must
      // acquire input before the next native fallback sample.
      window.syllable.overlay.pointerMoved()
      frame = requestAnimationFrame(publish)
    }
    // Electron forwards mousemove while the native window ignores clicks.
    // The main process reads the real cursor; no renderer coordinates are trusted.
    window.addEventListener('mousemove', move, { passive: true })
    window.addEventListener('mouseleave', move, { passive: true })
    return () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseleave', move)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  useEffect(() => {
    const cancel = () => {
      finishPointerDrag(dragRef, () => window.syllable.overlay.endMove())
      window.syllable.overlay.pointerCaptured(false)
    }
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancel() }
  }, [settings.positionLocked])
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return
    if (settings.positionLocked || event.button !== 0 || event.clientX < 9 || event.clientY < 9 || event.clientX > window.innerWidth - 9 || event.clientY > window.innerHeight - 9) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false }
    window.syllable.overlay.pointerCaptured(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const continueDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      drag.active = true
      window.syllable.overlay.beginMove()
    }
    window.syllable.overlay.moveTo(event.screenX, event.screenY)
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!finishPointerDrag(dragRef, () => window.syllable.overlay.endMove(), event.pointerId)) return
    window.syllable.overlay.pointerCaptured(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  useLayoutEffect(() => {
    let frame = 0
    let settleTimer = 0
    let disposed = false
    let previousPayload = ''
    const publishHitRegions = () => {
      const readRegions = (selectors: string[]) => selectors.flatMap(selector => [...document.querySelectorAll(selector)]).map(element => {
        const rect = element.getBoundingClientRect()
        const pixel = (value: number) => Math.round(value * 2) / 2
        return { x: pixel(rect.x), y: pixel(rect.y), width: pixel(rect.width), height: pixel(rect.height) }
      }).filter(rect => rect.width > 0 && rect.height > 0)
      const textRegions = readRegions(['.overlay-primary', '.overlay-secondary'])
      const regions = settings.backgroundEnabled ? readRegions(['.overlay-surface']) : textRegions
      const controlsAnchor = textRegions.length ? (() => {
        const left = Math.min(...textRegions.map(rect => rect.x))
        const right = Math.max(...textRegions.map(rect => rect.x + rect.width))
        const width = 262
        const padding = 8
        const preferredX = settings.alignment === 'center' ? (left + right - width) / 2 : left
        return {
          x: Math.max(padding, Math.min(window.innerWidth - width - padding, preferredX)),
          y: 0
        }
      })() : undefined
      const layout = { generation: layoutGeneration.current, viewport: { width: window.innerWidth, height: window.innerHeight } }
      const payload = JSON.stringify({ regions, controlsAnchor, layout })
      if (payload === previousPayload) return
      previousPayload = payload
      void window.syllable.overlay.setHitRegions(regions, controlsAnchor, layout)
    }
    const refreshLayout = () => {
      previousPayload = ''
      schedulePublish()
      window.clearTimeout(settleTimer)
      // ResizeObserver does not report a position-only or completed transform
      // change. Measure again after monitor/font/line animation has settled.
      settleTimer = window.setTimeout(() => { previousPayload = ''; schedulePublish() }, 300)
    }
    const unsubscribeLayout = window.syllable.overlay.onLayoutReset(generation => {
      if (!Number.isSafeInteger(generation) || generation < layoutGeneration.current) return
      layoutGeneration.current = generation
      setLayoutRevision(generation)
      refreshLayout()
    })
    window.addEventListener('resize', refreshLayout)
    window.addEventListener('pageshow', refreshLayout)
    document.fonts.addEventListener('loadingdone', refreshLayout)
    void document.fonts.ready.then(() => { if (!disposed) refreshLayout() })
    const schedulePublish = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => { frame = 0; publishHitRegions() })
    }
    schedulePublish()
    const observer = new ResizeObserver(schedulePublish)
    const surface = document.querySelector('.overlay-surface')
    if (surface) observer.observe(surface)
    // The fixed-width surface can keep the same size while an inline lyric
    // becomes shorter or a translation/romanization arrives asynchronously.
    // Observe the actual hit targets too, including late font metric changes.
    document.querySelectorAll('.overlay-primary, .overlay-secondary').forEach(element => observer.observe(element))
    return () => {
      disposed = true
      unsubscribeLayout()
      window.removeEventListener('resize', refreshLayout)
      window.removeEventListener('pageshow', refreshLayout)
      document.fonts.removeEventListener('loadingdone', refreshLayout)
      window.clearTimeout(settleTimer)
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [settings.backgroundEnabled, settings.positionLocked, settings.fontSize, settings.fontWeight, settings.lineHeight, settings.alignment, line?.startMs, hitRegionText, layoutRevision, fit])
  const overlayStyle = {
    '--overlay-blur': `${settings.blur}px`, '--overlay-size': `${Math.max(34, settings.fontSize)}px`,
    '--overlay-bg-opacity': settings.backgroundOpacity / 100, '--overlay-text-opacity': settings.textOpacity / 100,
    '--overlay-radius': `${settings.cornerRadius}px`, '--overlay-line-height': settings.lineHeight / 100,
    '--overlay-font-weight': settings.fontWeight, '--overlay-fit': fit,
    '--overlay-text-color': settings.textColor === 'green' ? '#1ed760' : settings.textColor === 'warm' ? '#fff4e6' : '#ffffff'
  } as React.CSSProperties

  return <div className={`overlay-shell ${settings.alignment} effect-${settings.textEffect} ${settings.backgroundEnabled ? 'has-background' : 'no-background'} ${settings.positionLocked ? 'position-locked' : ''} ${paused ? 'paused' : ''}`} style={overlayStyle} onPointerEnter={() => window.syllable.overlay.setControlsHover(true)} onPointerLeave={() => window.syllable.overlay.setControlsHover(false)}>
    <div className="overlay-surface">
      <div ref={lyricsRef} className="overlay-lyrics" onPointerDown={beginDrag} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <div ref={contentRef} className="overlay-line-content" key={`${layoutRevision}-${playback?.track?.id ?? 'none'}-${line?.startMs ?? -1}-${content.kind}`}>
          {content.kind === 'title' ? <>
            <div lang={titlePresentation!.lang} className={`overlay-primary title-card ${titlePresentation!.className}`}>{content.title}</div>
            {content.subtitle && <div lang={scriptPresentation(content.subtitle).lang} className={`overlay-secondary artist ${scriptPresentation(content.subtitle).className}`}>{content.subtitle}</div>}
          </> : <div lang={base?.language === 'ja' ? 'ja' : base?.language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`overlay-primary karaoke-line ${baseClass}`}>{line?.words?.length ? line.words.map((word, wordIndex) => <span className={position >= word.startMs ? 'sung' : ''} key={`${word.startMs}-${wordIndex}`}>{word.text}</span>) : line?.text?.trim() || '♪'}</div>}
          {content.kind !== 'title' && secondaries.map(({ track, line: sibling }) => {
            const trackClass = track.language === 'ja' ? 'japanese-grid' : track.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
            return <div lang={track.language === 'ja' ? 'ja' : track.language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`overlay-secondary ${track.kind} ${trackClass}`} key={track.id}>{sibling?.text}</div>
          })}
          {activeLyrics?.untimedOriginal && <div className="overlay-secondary chinese-text" lang="zh-CN">暂无可信时间轴 · 原文可在客户端查看</div>}
        </div>
      </div>
      <span className="overlay-resize-cue" aria-hidden="true" />
    </div>
  </div>
}
