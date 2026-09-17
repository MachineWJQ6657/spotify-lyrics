import { useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { finishPointerDrag } from './lib/pointer-drag'
import { usePlaybackConnection } from './hooks/usePlayback'
import { usePosition } from './hooks/usePosition'
import { useAppStore } from './store/useAppStore'
import { activeLineIndex, alignSecondaryTrack, visibleTracks } from './lib/lyrics'
import { useWindowSync } from './hooks/useWindowSync'
import { calibratedPosition, lyricPlaybackPosition } from './lib/clock'

export function Overlay() {
  usePlaybackConnection(false, false)
  useWindowSync()
  const { playback, lyrics, settings, patchSettings } = useAppStore()
  const activeLyrics = !playback?.track || lyrics?.trackId === playback.track.id ? lyrics : null
  const offsetMs = activeLyrics?.offsetMs ?? (playback?.playbackSource === 'demo' ? settings.offsetMs : 0)
  const position = calibratedPosition(lyricPlaybackPosition(usePosition(playback, 80), playback, activeLyrics?.sourceDurationMs), offsetMs)
  const tracks = useMemo(() => visibleTracks(activeLyrics, settings.enabledLanguages, settings.romanization), [activeLyrics, settings.enabledLanguages, settings.romanization])
  const base = tracks.find(track => track.kind === 'original') ?? tracks[0]
  const baseClass = base?.language === 'ja' ? 'japanese-grid' : base?.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
  const index = base ? activeLineIndex(base.lines, position) : -1
  const line = base?.lines[index]
  const alignedSecondaries = useMemo(() => base ? tracks.filter(track => track.id !== base.id).map(track => ({ track, lines: alignSecondaryTrack(base.lines, track.lines) })) : [], [base, tracks])
  const secondaries = line ? alignedSecondaries.map(({ track, lines }) => ({ track, line: lines[index] })).filter(item => item.line) : []
  const hitRegionText = JSON.stringify([line?.text, ...secondaries.map(item => [item.track.id, item.line?.text])])
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; active: boolean } | null>(null)
  useEffect(() => {
    const cancel = () => finishPointerDrag(dragRef, () => window.syllable.overlay.endMove())
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancel() }
  }, [settings.positionLocked])
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return
    if (settings.positionLocked || event.button !== 0 || event.clientX < 9 || event.clientY < 9 || event.clientX > window.innerWidth - 9 || event.clientY > window.innerHeight - 9) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false }
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  useLayoutEffect(() => {
    let frame = 0
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
      const payload = JSON.stringify({ regions, controlsAnchor })
      if (payload === previousPayload) return
      previousPayload = payload
      void window.syllable.overlay.setHitRegions(regions, controlsAnchor)
    }
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
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [settings.backgroundEnabled, settings.positionLocked, settings.fontSize, settings.fontWeight, settings.lineHeight, settings.alignment, line?.startMs, hitRegionText])
  const overlayStyle = {
    '--overlay-blur': `${settings.blur}px`, '--overlay-size': `${Math.max(34, settings.fontSize)}px`,
    '--overlay-bg-opacity': settings.backgroundOpacity / 100, '--overlay-text-opacity': settings.textOpacity / 100,
    '--overlay-radius': `${settings.cornerRadius}px`, '--overlay-line-height': settings.lineHeight / 100,
    '--overlay-font-weight': settings.fontWeight,
    '--overlay-text-color': settings.textColor === 'green' ? '#1ed760' : settings.textColor === 'warm' ? '#fff4e6' : '#ffffff'
  } as React.CSSProperties

  return <div className={`overlay-shell ${settings.alignment} effect-${settings.textEffect} ${settings.backgroundEnabled ? 'has-background' : 'no-background'} ${settings.positionLocked ? 'position-locked' : ''}`} style={overlayStyle} onPointerEnter={() => window.syllable.overlay.setControlsHover(true)} onPointerLeave={() => window.syllable.overlay.setControlsHover(false)}>
    <div className="overlay-surface">
      <div className="overlay-lyrics" onPointerDown={beginDrag} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <div className="overlay-line-content" key={`${playback?.track?.id ?? 'none'}-${line?.startMs ?? -1}`}>
          <div lang={base?.language === 'ja' ? 'ja' : base?.language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`overlay-primary karaoke-line ${baseClass}`}>{line?.words?.length ? line.words.map((word, wordIndex) => <span className={position >= word.startMs ? 'sung' : ''} key={`${word.startMs}-${wordIndex}`}>{word.text}</span>) : line?.text?.trim() || '♪'}</div>
          {secondaries.map(({ track, line: sibling }) => {
            const trackClass = track.language === 'ja' ? 'japanese-grid' : track.language === 'zh-Hans' ? 'chinese-text' : 'latin-text'
            return <div lang={track.language === 'ja' ? 'ja' : track.language === 'zh-Hans' ? 'zh-CN' : 'en'} className={`overlay-secondary ${track.kind} ${trackClass}`} key={track.id}>{sibling?.text}</div>
          })}
        </div>
      </div>
      <span className="overlay-resize-cue" aria-hidden="true" />
    </div>
  </div>
}
