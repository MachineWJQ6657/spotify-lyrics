import { memo, useCallback, useEffect, useState, useSyncExternalStore, type DragEvent } from 'react'
import './app.css'
import { sourceLabel } from './lib/source-label'
import { Languages, Maximize2, Minimize2, PanelRightOpen, PencilLine, Radio, Sparkles } from 'lucide-react'
import { Titlebar } from './components/Titlebar'
import { Sidebar, type AppView } from './components/Sidebar'
import { ClockedLyricsStage, ClockedLyricsEditor, ClockedPlayerBar } from './components/PlaybackSurfaces'
import { PANEL_TAB_EVENT, SettingsPanel, TAB_KEY } from './components/SettingsPanel'
import { SourceMenu } from './components/SourceMenu'
import { LYRICS_SOURCES, lyricsSourceIdOf } from './lib/lyrics-source'
import { LibraryView } from './components/LibraryView'
import { InfoView } from './components/InfoView'
import { useAppStore } from './store/useAppStore'
import { usePlaybackConnection } from './hooks/usePlayback'
import { useWindowSync } from './hooks/useWindowSync'
import { languageFromFilename, makeTrack } from './lib/lyrics'
import { hasKana, scriptPresentation } from './lib/script'
import { BrandMark } from './components/BrandMark'
import { recordSurfaceRender } from './lib/render-probe'
import { connectListener, listeningTrackId, subscribeListening } from './lib/listen-controller'
import { displayLyricsOffset } from './lib/listened-offset'
import { acousticController } from './lib/acoustic-controller'
import { currentSessionCalibration } from './lib/session-calibration'
import { timingStatus } from './lib/timing-status'
import { lyricSeekTarget, seekPlayback } from './lib/seek'
import { formatTime } from './lib/clock'
import { hasUnseenNews, markNewsSeen, readSeenVersion } from './lib/changelog'
import { version as appVersion } from '../package.json'
import type { LyricLine } from './types'

const VIEW_TITLES: Record<AppView, string> = { now: '正在播放', library: '歌词资料库', sources: '歌词源', settings: '偏好设置', help: '帮助与诊断' }
const PANEL_KEY = 'syllable-ui-panel-collapsed'
const readPanelCollapsed = () => { try { return localStorage.getItem(PANEL_KEY) === '1' } catch { return false } }
const FOCUS_KEY = 'syllable-ui-focus'
const readFocus = () => { try { return localStorage.getItem(FOCUS_KEY) === '1' } catch { return false } }

/**
 * Blurred album art behind the whole window. The previous cover stays under
 * the new one while it fades in, so a song change never flashes to black.
 * A missing cover (thumbnail not delivered yet) keeps the last one.
 */
const Backdrop = memo(function Backdrop({ cover }: { cover?: string }) {
  const [layers, setLayers] = useState<string[]>(() => cover ? [cover] : [])
  useEffect(() => {
    if (cover) setLayers(current => current[current.length - 1] === cover ? current : [...current.slice(-1), cover])
  }, [cover])
  return <div className="app-backdrop" aria-hidden="true">
    {layers.map(url => <div key={url} className="app-backdrop-art" style={{ backgroundImage: `url(${JSON.stringify(url)})` }} />)}
  </div>
})

export function App() {
  recordSurfaceRender('shell')
  usePlaybackConnection()
  useWindowSync()
  useEffect(() => acousticController.connect(), [])
  useEffect(() => connectListener(), [])
  const { playback, lyrics, settings, demoMode, localConnected, editorOpen, setEditorOpen, setLyrics, patchSettings, retryCurrentLyrics, setLyricsSource, sessionCalibration } = useAppStore()
  const activeLyrics = !playback?.track || lyrics?.trackId === playback.track.id ? lyrics : null
  const lyricOffset = displayLyricsOffset(activeLyrics, demoMode ? settings.offsetMs : 0, settings.listenOffset !== false)
  const manual = currentSessionCalibration(sessionCalibration, playback, activeLyrics)
  const [view, setView] = useState<AppView>('now')
  // A dot on the help page until the list of recent updates there has been opened.
  const [news, setNews] = useState(() => hasUnseenNews(readSeenVersion(), appVersion))
  useEffect(() => {
    if (view !== 'help' || !news) return
    markNewsSeen(appVersion)
    setNews(false)
  }, [view, news])
  const [panelCollapsed, setPanelCollapsed] = useState(readPanelCollapsed)
  const togglePanel = useCallback(() => setPanelCollapsed(value => {
    try { localStorage.setItem(PANEL_KEY, value ? '0' : '1') } catch { /* view-only preference */ }
    return !value
  }), [])
  // Focus mode: only the song header, the lyrics and the player bar. F11
  // toggles it; Esc leaves it when nothing else is open to close first.
  const [focus, setFocus] = useState(readFocus)
  const toggleFocus = useCallback(() => setFocus(value => {
    try { localStorage.setItem(FOCUS_KEY, value ? '0' : '1') } catch { /* view-only preference */ }
    return !value
  }), [])
  const focusActive = focus && view === 'now'
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F11') { event.preventDefault(); if (view === 'now') toggleFocus(); return }
      if (event.key !== 'Escape' || !focusActive || event.defaultPrevented) return
      if (document.querySelector('.editor-backdrop, .lyrics-find, .lyric-menu, .source-popover')) return
      toggleFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, focusActive, toggleFocus])
  // "悬浮窗设置" on the overlay's control bar: expand the panel at its overlay tab.
  useEffect(() => window.syllable.window.onShowSection?.(section => {
    if (section !== 'overlay-settings') return
    try { localStorage.setItem(TAB_KEY, 'overlay'); localStorage.setItem(PANEL_KEY, '0') } catch { /* view-only preference */ }
    setPanelCollapsed(false)
    // The panel is hidden in focus mode: leave it so the settings asked for are visible.
    try { localStorage.setItem(FOCUS_KEY, '0') } catch { /* view-only preference */ }
    setFocus(false)
    window.dispatchEvent(new CustomEvent(PANEL_TAB_EVENT, { detail: 'overlay' }))
  }), [])
  const listening = useSyncExternalStore(subscribeListening, listeningTrackId) === (playback?.track?.id ?? null) && Boolean(playback?.track)
  const durationMs = playback?.track?.durationMs
  const seekLine = useCallback((line: LyricLine) => { void seekPlayback(lyricSeekTarget(line.startMs, lyricOffset, durationMs)).catch(() => {}) }, [lyricOffset, durationMs])
  const seekLabel = useCallback((line: LyricLine) => formatTime(lyricSeekTarget(line.startMs, lyricOffset, durationMs)), [lyricOffset, durationMs])
  const status = timingStatus({
    document: activeLyrics, sessionCalibrated: Boolean(manual), listening, listenEnabled: settings.listenOffset !== false,
    acousticAnchor: Boolean(playback?.isPlaying && playback.acousticAnchor && Date.now() < playback.acousticAnchor.expiresAtMs)
  })
  const [dropMessage, setDropMessage] = useState('')
  const openEditor = useCallback(() => setEditorOpen(true), [setEditorOpen])
  const headingTitle = playback?.track?.name ?? ''
  const headingArtist = playback?.track?.artist ?? ''
  const headingAlbum = playback?.track?.album ?? ''
  const originalLanguage = activeLyrics?.tracks.find(track => track.kind === 'original')?.language
  const japaneseContext = [headingTitle, headingArtist, headingAlbum].find(hasKana) ?? ''
  const titlePresentation = scriptPresentation(headingTitle, japaneseContext, originalLanguage)
  const artistPresentation = scriptPresentation(headingArtist, japaneseContext, originalLanguage)
  const albumPresentation = scriptPresentation(headingAlbum, japaneseContext, originalLanguage)
  const mixLabel = playback?.transition ? 'MIX' : ''
  // Singles often repeat the title as the album name; say it once.
  const showAlbum = Boolean(headingAlbum) && headingAlbum.trim().toLowerCase() !== headingTitle.trim().toLowerCase()
  const trackCount = activeLyrics?.tracks.length ?? 0
  // The badge names the provider on screen ("网易云音乐"); imported or edited lyrics keep their own label.
  const shownSource = (activeLyrics?.tracks.find(track => track.kind === 'original') ?? activeLyrics?.tracks[0])?.source
  const shownProvider = LYRICS_SOURCES.find(item => item.id === lyricsSourceIdOf(shownSource))?.label
  const sourceText = shownProvider ?? sourceLabel(shownSource ?? (activeLyrics?.instrumental ? '纯音乐' : activeLyrics?.lookupFailed ? '歌词源暂时不可用' : activeLyrics?.providerRevision !== undefined && !activeLyrics.untimedOriginal ? '未找到歌词' : '正在搜索歌词…'))

  const importDroppedLyrics = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = [...event.dataTransfer.files].filter(file => /\.(?:lrc|txt)$/i.test(file.name))
    if (!files.length) { setDropMessage('只支持 LRC 或 TXT 歌词文件'); return }
    const state = useAppStore.getState()
    const currentTrack = state.playback?.track ?? undefined
    const base = state.lyrics && state.lyrics.trackId === currentTrack?.id ? state.lyrics : { trackId: currentTrack?.id ?? 'local', track: currentTrack, tracks: [] }
    const additions = await Promise.all(files.map(async (file, index) => {
      const language = languageFromFilename(file.name)
      return makeTrack(`local-${Date.now()}-${index}`, language.code, language.label, language.kind, await file.text(), file.name)
    }))
    setLyrics({
      ...base,
      tracks: [...base.tracks.filter(track => !additions.some(item => item.language === track.language)), ...additions],
      userEditedTrackIds: [...new Set([...(base.userEditedTrackIds ?? []), ...additions.map(track => track.id)])],
      updatedAt: Date.now()
    })
    patchSettings({ enabledLanguages: [...new Set([...state.settings.enabledLanguages, ...additions.map(track => track.language)])] })
    setDropMessage(`已导入 ${additions.length} 条歌词轨道`)
    window.setTimeout(() => setDropMessage(''), 2400)
  }

  useEffect(() => {
    // Restore native behavior as one transaction, before making the overlay
    // visible. The auxiliary renderer separately acknowledges its styled DOM.
    void window.syllable.overlay.restore(useAppStore.getState().settings)
  }, [])

  useEffect(() => {
    if (!demoMode) return
    const resetDemo = setInterval(() => {
      const state = useAppStore.getState()
      if (state.demoMode && state.playback?.track && Date.now() - state.playback.observedAtMs > state.playback.track.durationMs) state.startDemo()
    }, 1000)
    return () => clearInterval(resetDemo)
  }, [demoMode])

  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={event => void importDroppedLyrics(event)} style={{ '--lyric-size': `${settings.fontSize}px` } as React.CSSProperties}>
    <Backdrop cover={playback?.track?.coverUrl || undefined} />
    <Titlebar title={VIEW_TITLES[view]} />
    <div className={`body-grid ${panelCollapsed ? 'panel-collapsed' : ''} ${focusActive ? 'focus-mode' : ''}`}>
      <Sidebar active={view} onChange={setView} news={news} />
      <main className="main-content">
        {view === 'library' || view === 'sources' ? <LibraryView mode={view} openEditor={openEditor} /> : view === 'settings' || view === 'help' ? <InfoView mode={view} openEditor={openEditor} /> : <>
        <div className="now-header">
          <div className="now-track-heading">
            <div className="header-cover">{playback?.track?.coverUrl ? <img src={playback.track.coverUrl} /> : <BrandMark size={40} title="Syllable" />}</div>
            <div>
            <span className={`eyebrow ${demoMode ? 'demo' : ''}`} title={demoMode ? '演示模式，尚未同步 Spotify' : localConnected ? '已连接本机 Spotify 媒体会话' : '已连接 Spotify Web API'}><Radio size={12} /><span>{demoMode ? '演示模式 · 未连接' : localConnected ? 'Spotify 桌面端' : 'Spotify Web API'}</span></span>
            <h1 {...titlePresentation}>{playback?.track?.name ?? '等待 Spotify 播放'}</h1>
            <p><span {...artistPresentation}>{playback?.track?.artist ?? '连接 Spotify 后自动开始'}</span>{(showAlbum || !playback?.track) && <><i /><span {...albumPresentation}>{playback?.track?.album ?? 'Syllable'}</span></>}</p>
            </div>
          </div>
          <div className="source-badges">{demoMode && <span className="not-connected">打开 Spotify 桌面端并播放歌曲</span>}{mixLabel && <span title="这首歌带有 Spotify 自定义转场"><Sparkles size={13} />{mixLabel}</span>}<SourceMenu document={activeLyrics} label={sourceText} disabled={demoMode || !playback?.track} onSelect={setLyricsSource} onSearch={openEditor} />{trackCount > 0 && <span className="track-count" title={activeLyrics?.tracks.map(track => track.label).join(' · ')}><Languages size={13} />{trackCount} 条轨道</span>}<button className="header-focus" aria-pressed={focusActive} aria-label="专注模式" title={focusActive ? '退出专注模式（Esc 或 F11）' : '专注模式：只显示歌词（F11）'} onClick={toggleFocus}>{focusActive ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button><button className="header-edit" title="搜索歌词、编辑与逐行校时" onClick={openEditor}><PencilLine size={14} />编辑</button></div>
        </div>
        <div className="lyric-card">
          <div className={`card-watermark tone-${status.tone}`} title={status.title}>{status.tone === 'listening' ? <span className="listen-pulse" /> : <Sparkles size={14} />} {status.label}</div>
        <ClockedLyricsStage playback={playback} document={activeLyrics} offsetMs={lyricOffset} sessionCalibration={sessionCalibration} enabled={settings.enabledLanguages} romanization={settings.romanization} onRetry={retryCurrentLyrics}
          onSeekLine={seekLine} seekLabel={seekLabel} onSearch={openEditor} />
        </div>
        </>}
      </main>
      {panelCollapsed ? <aside className="settings-rail"><button title="展开设置面板" aria-label="展开设置面板" onClick={togglePanel}><PanelRightOpen size={18} /></button></aside> : <SettingsPanel onCollapse={togglePanel} />}
    </div>
    <ClockedPlayerBar playback={playback} demoMode={demoMode} />
    {editorOpen && <ClockedLyricsEditor playback={playback} document={activeLyrics} offsetMs={lyricOffset} sessionCalibration={sessionCalibration} />}
    {dropMessage && <div className="drop-toast">{dropMessage}</div>}
  </div>
}
