import { Captions, CheckCircle2, CircleHelp, Clock3, ExternalLink, Keyboard, MonitorUp, Settings2, Wifi } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { lyricDurationScale, lyricSourcePosition } from '../lib/clock'
import { hasKana, scriptPresentation } from '../lib/script'

export function InfoView({ mode, openEditor }: { mode: 'settings' | 'help'; openEditor(): void }) {
  const { connected, localConnected, demoMode, playback, lyrics, settings, patchSettings, setLyricsOffset } = useAppStore()
  const activeLyrics = !playback?.track || lyrics?.trackId === playback.track.id ? lyrics : null
  const offsetMs = activeLyrics?.offsetMs ?? (demoMode ? settings.offsetMs : 0)
  const durationScale = lyricDurationScale(playback?.track?.durationMs, activeLyrics?.sourceDurationMs, playback?.transition)
  const mixCorrectionMs = playback ? Math.round(lyricSourcePosition(playback.positionMs, playback.track?.durationMs, activeLyrics?.sourceDurationMs, playback.transition) - playback.positionMs) : 0
  const clockMode = playback?.transition ? 'Spotify Mix 自动时轴' : durationScale !== 1 ? `Spotify 时长校准 ${durationScale.toFixed(3)}×` : 'Spotify 1:1'
  const trackContext = [playback?.track?.name ?? '', playback?.track?.artist ?? '', playback?.track?.album ?? ''].find(hasKana) ?? ''
  const originalLanguage = activeLyrics?.tracks.find(track => track.kind === 'original')?.language
  const trackNamePresentation = scriptPresentation(playback?.track?.name ?? '', trackContext, originalLanguage)
  const trackArtistPresentation = scriptPresentation(playback?.track?.artist ?? '', trackContext, originalLanguage)
  const toggleOverlay = async () => {
    const visible = !settings.overlayVisible
    patchSettings({ overlayVisible: visible })
    await (visible ? window.syllable.overlay.show() : window.syllable.overlay.hide())
  }
  if (mode === 'settings') return <div className="content-page info-view">
    <div className="content-page-header"><span>PREFERENCES</span><h1>偏好设置</h1><p>常用选项集中在右侧面板；这里提供状态总览和快捷操作。</p></div>
    <div className="status-grid">
      <article><MonitorUp /><div><strong>桌面歌词</strong><span>{settings.overlayVisible ? '正在显示' : '当前隐藏'}</span></div><button onClick={() => void toggleOverlay()}>{settings.overlayVisible ? '隐藏' : '显示'}</button></article>
      <article><Clock3 /><div><strong>本曲时间校准</strong><span>{offsetMs > 0 ? '+' : ''}{offsetMs} ms · {clockMode}</span></div><button onClick={() => activeLyrics ? setLyricsOffset(0) : patchSettings({ offsetMs: 0 })}>归零</button></article>
      <article><Captions /><div><strong>歌词字号</strong><span>{settings.fontSize}px</span></div><button onClick={() => patchSettings({ fontSize: 56 })}>设为 56px</button></article>
      <article><Settings2 /><div><strong>逐行编辑</strong><span>搜索、改词与取当前时间</span></div><button onClick={openEditor}>打开</button></article>
    </div>
    <div className="info-note">更细的语言、字号、偏移、模糊和鼠标穿透选项都可直接在右侧调整。</div>
  </div>

  const status = localConnected ? '本机 Spotify 媒体会话已连接' : connected && !demoMode ? 'Spotify Web API 已连接' : '尚未检测到 Spotify 播放'
  return <div className="content-page info-view">
    <div className="content-page-header"><span>HELP & DIAGNOSTICS</span><h1>帮助与诊断</h1><p>按钮没有反应时，先在这里确认播放源和快捷键状态。</p></div>
    <div className="diagnostic-card">
      <div className={`diagnostic-icon ${localConnected || connected ? 'online' : ''}`}><Wifi /></div>
      <div><strong>{status}</strong><span>{playback?.track ? <>已识别：<span {...trackNamePresentation}>{playback.track.name}</span> · <span {...trackArtistPresentation}>{playback.track.artist}</span>{playback.clockDriftMs != null ? ` · 实时时钟差 ${playback.clockDriftMs > 0 ? '+' : ''}${playback.clockDriftMs} ms` : ''}</> : '请打开 Spotify 桌面端并播放任意歌曲'}</span></div>
      {(localConnected || connected) && <CheckCircle2 className="diagnostic-check" />}
    </div>
    {playback?.transition && <div className="info-note">已识别 Spotify 自定义转场：音乐 cue {playback.transition.cuePointMs} ms（仅诊断），重叠 {playback.transition.overlapMs ?? 0} ms，速度曲线时钟修正 {mixCorrectionMs > 0 ? '+' : ''}{mixCorrectionMs} ms。</div>}
    {!playback?.transition && durationScale !== 1 && <div className="info-note">Spotify 的混合播放时长与高置信度发行版歌词不同；仅将歌词时钟按 {durationScale.toFixed(4)}× 映射到 Spotify 实时进度，播放本身不会被修改。</div>}
    <div className="help-grid">
      <article><Keyboard /><strong>Ctrl + Alt + L</strong><span>显示或隐藏桌面悬浮歌词</span></article>
      <article><Keyboard /><strong>Ctrl + Alt + M</strong><span>切换悬浮窗鼠标穿透</span></article>
      <article><CircleHelp /><strong>歌词不匹配</strong><span>点击歌曲标题右侧的铅笔，搜索候选并逐行校时。</span></article>
    </div>
    <a className="docs-link" href="https://github.com/tranxuanthang/lrcget" target="_blank">了解 LRC 歌词格式 <ExternalLink size={13} /></a>
  </div>
}
