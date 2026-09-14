import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { Cloud, Languages, PencilLine, Radio, Sparkles } from 'lucide-react'
import { Titlebar } from './components/Titlebar'
import { Sidebar, type AppView } from './components/Sidebar'
import { ClockedLyricsStage, ClockedLyricsEditor, ClockedPlayerBar } from './components/PlaybackSurfaces'
import { SettingsPanel } from './components/SettingsPanel'
import { LibraryView } from './components/LibraryView'
import { InfoView } from './components/InfoView'
import { useAppStore } from './store/useAppStore'
import { usePlaybackConnection } from './hooks/usePlayback'
import { useWindowSync } from './hooks/useWindowSync'
import { languageFromFilename, makeTrack } from './lib/lyrics'
import { lyricDurationScale } from './lib/clock'
import { hasKana, scriptPresentation } from './lib/script'
import { BrandMark } from './components/BrandMark'
import { recordSurfaceRender } from './lib/render-probe'

export function App() {
  recordSurfaceRender('shell')
  usePlaybackConnection()
  useWindowSync()
  const { playback, lyrics, settings, demoMode, localConnected, editorOpen, setEditorOpen, setLyrics, patchSettings, retryCurrentLyrics } = useAppStore()
  const activeLyrics = !playback?.track || lyrics?.trackId === playback.track.id ? lyrics : null
  const lyricOffset = activeLyrics?.offsetMs ?? (demoMode ? settings.offsetMs : 0)
  const timelineScale = lyricDurationScale(playback?.track?.durationMs, activeLyrics?.sourceDurationMs, playback?.transition)
  const [view, setView] = useState<AppView>('now')
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
  const mixSpeed = playback?.transition?.speedAutomation[0]?.speed
  const mixLabel = playback?.transition
    ? `MIX 时轴${mixSpeed && Math.abs(mixSpeed - 1) > .0001 ? ` · ${mixSpeed.toFixed(3)}×` : ''}`
    : timelineScale !== 1 ? `时长校准 · ${timelineScale.toFixed(3)}×` : ''

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
    if (settings.overlayVisible) void window.syllable.overlay.show()
    if (settings.clickThrough) void window.syllable.overlay.setClickThrough(true)
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
    <Titlebar />
    <div className="body-grid">
      <Sidebar active={view} onChange={setView} />
      <main className="main-content">
        {view === 'library' || view === 'sources' ? <LibraryView mode={view} openEditor={openEditor} /> : view === 'settings' || view === 'help' ? <InfoView mode={view} openEditor={openEditor} /> : <>
        <div className="now-header">
          <div className="now-track-heading">
            <div className="header-cover">{playback?.track?.coverUrl ? <img src={playback.track.coverUrl} /> : <BrandMark size={46} title="Syllable" />}</div>
            <div>
            <span className={`eyebrow ${demoMode ? 'demo' : ''}`} title={demoMode ? '演示模式，尚未同步 Spotify' : localConnected ? '已连接本机 Spotify 媒体会话' : '已连接 Spotify Web API'}><Radio size={12} /><span>{demoMode ? '演示模式 · 未连接' : localConnected ? 'Spotify 桌面端' : 'Spotify Web API'}</span></span>
            <h1 {...titlePresentation}>{playback?.track?.name ?? '等待 Spotify 播放'}</h1>
            <p><span {...artistPresentation}>{playback?.track?.artist ?? '连接 Spotify 后自动开始'}</span><i /><span {...albumPresentation}>{playback?.track?.album ?? 'Syllable'}</span></p>
            </div>
          </div>
          <div className="source-badges">{demoMode && <span className="not-connected">打开 Spotify 桌面端并播放歌曲</span>}{mixLabel && <span title="已识别 Spotify 自定义转场；歌词以 Spotify 传输进度为基准，只应用有效的速度曲线"><Sparkles size={13} />{mixLabel}</span>}<span><Cloud size={13} />{activeLyrics?.tracks[0]?.source ?? 'Searching'}</span><span><Languages size={13} />{activeLyrics?.tracks.length ?? 0} tracks</span><button title="搜索、编辑与校时" onClick={openEditor}><PencilLine size={16} /></button></div>
        </div>
        <div className="lyric-card">
          <div className="ambient ambient-one" /><div className="ambient ambient-two" />
          <div className="card-watermark"><Sparkles size={14} /> SPOTIFY TIMELINE</div>
        <ClockedLyricsStage playback={playback} document={activeLyrics} offsetMs={lyricOffset} enabled={settings.enabledLanguages} romanization={settings.romanization} onRetry={retryCurrentLyrics} />
        </div>
        </>}
      </main>
      <SettingsPanel />
    </div>
    <ClockedPlayerBar playback={playback} demoMode={demoMode} />
    {editorOpen && <ClockedLyricsEditor playback={playback} document={activeLyrics} offsetMs={lyricOffset} />}
    {dropMessage && <div className="drop-toast">{dropMessage}</div>}
  </div>
}
