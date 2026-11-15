import { useEffect, useState } from 'react'
import { Captions, CheckCircle2, CircleHelp, Clock3, Download, ExternalLink, Keyboard, MousePointerClick, MonitorUp, Power, Settings2, Wifi } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { hasKana, scriptPresentation } from '../lib/script'
import { lyricDiagnosticContext } from '../lib/sync-diagnostics'
import { AudioSyncPanel } from './AudioSyncPanel'
import { releasedEntries } from '../lib/changelog'
import { version as appVersion } from '../../package.json'
import { referenceLabel } from '../lib/source-label'
import { displayLyricsOffset, listenedLyricsOffset } from '../lib/listened-offset'
import { currentSessionCalibration } from '../lib/session-calibration'


/** Measured delta > 0: the file runs ahead of the singing (shown too early). */
export function listenedClockLabel(measuredDeltaMs: number) {
  return measuredDeltaMs >= 0 ? `听音自动校准（原歌词比演唱早 ${measuredDeltaMs} ms）` : `听音自动校准（原歌词比演唱晚 ${-measuredDeltaMs} ms）`
}

export function InfoView({ mode, openEditor }: { mode: 'settings' | 'help'; openEditor(): void }) {
  const [exporting, setExporting] = useState(false)
  // Windows login item; only the installed build can register one.
  const [loginItem, setLoginItem] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  useEffect(() => {
    let current = true
    void window.syllable.app?.loginItem().then(value => { if (current) setLoginItem(value) }).catch(() => undefined)
    return () => { current = false }
  }, [])
  const [recentErrors, setRecentErrors] = useState<string[] | null>(null)
  useEffect(() => {
    if (mode !== 'help') return
    let current = true
    void window.syllable.app?.recentErrors?.().then(value => { if (current) setRecentErrors(value) }).catch(() => undefined)
    return () => { current = false }
  }, [mode])
  const toggleLoginItem = async () => {
    if (!loginItem?.supported) return
    const next = await window.syllable.app?.setLoginItem(!loginItem.enabled).catch(() => null)
    if (next) setLoginItem(next)
  }
  const [exportStatus, setExportStatus] = useState('')
  const exportDiagnostics = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const current = useAppStore.getState()
      const context = lyricDiagnosticContext(current.playback, current.lyrics, current.demoMode ? current.settings.offsetMs : 0, Date.now(), current.sessionCalibration)
      const saved = await window.syllable.playback.exportDiagnostics(context)
      setExportStatus(saved ? '诊断已保存在你选择的位置，未上传。' : '已取消保存。')
    } catch (error) { setExportStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setExporting(false) }
  }
  const { connected, localConnected, demoMode, playback, lyrics, settings, patchSettings, setLyricsOffset, sessionCalibration, clearSessionCalibration } = useAppStore()
  const activeLyrics = !playback?.track || lyrics?.trackId === playback.track.id ? lyrics : null
  const manual = currentSessionCalibration(sessionCalibration, playback, activeLyrics)
  const offsetMs = manual?.offsetMs ?? displayLyricsOffset(activeLyrics, demoMode ? settings.offsetMs : 0, settings.listenOffset !== false)
  const audioActive = playback?.isPlaying && playback.acousticAnchor?.trackId === playback.track?.id
    && playback.acousticAnchor && Date.now() < playback.acousticAnchor.expiresAtMs
  const listenedApplies = !manual && !activeLyrics?.offsetMs && settings.listenOffset !== false && listenedLyricsOffset(activeLyrics) !== 0
  const clockMode = manual ? '本次听感校准' : audioActive ? '声音校准（实验）'
    : listenedApplies ? listenedClockLabel(activeLyrics?.listenedOffset?.measuredDeltaMs ?? 0) : 'Spotify 播放进度'
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
      <article><Clock3 /><div><strong>本曲时间校准</strong><span>{offsetMs > 0 ? '+' : ''}{offsetMs} ms · {clockMode}</span></div><button onClick={() => manual ? clearSessionCalibration() : activeLyrics ? setLyricsOffset(0) : patchSettings({ offsetMs: 0 })}>{manual ? '撤销本次' : '归零'}</button></article>
      <article><Captions /><div><strong>歌词字号</strong><span>{settings.fontSize}px</span></div><button onClick={() => patchSettings({ fontSize: 56 })}>设为 56px</button></article>
      {loginItem?.supported && <article><Power /><div><strong>开机启动</strong><span>{loginItem.enabled ? '登录 Windows 后自动在后台启动，只显示桌面歌词' : '登录 Windows 后不自动启动'}</span></div><button onClick={() => void toggleLoginItem()}>{loginItem.enabled ? '关闭' : '开启'}</button></article>}
      <article><Settings2 /><div><strong>逐行编辑</strong><span>搜索、改词与取当前时间</span></div><button onClick={openEditor}>打开</button></article>
    </div>
    <div className="info-note">更细的语言、字号、偏移、悬浮窗外观和锁定选项都可直接在右侧调整。</div>
    <AudioSyncPanel />
  </div>

  const status = localConnected ? '本机 Spotify 媒体会话已连接' : connected && !demoMode ? 'Spotify Web API 已连接' : '尚未检测到 Spotify 播放'
  return <div className="content-page info-view">
    <div className="content-page-header"><span>HELP & DIAGNOSTICS</span><h1>帮助与诊断</h1><p>按钮没有反应时，先在这里确认播放源和快捷键状态。</p></div>
    <div className="diagnostic-card">
      <div className={`diagnostic-icon ${localConnected || connected ? 'online' : ''}`}><Wifi /></div>
      <div><strong>{status}</strong><span>{playback?.track ? <>已识别：<span {...trackNamePresentation}>{playback.track.name}</span> · <span {...trackArtistPresentation}>{playback.track.artist}</span>{playback.clockDriftMs != null ? ` · 内部采样差 ${playback.clockDriftMs > 0 ? '+' : ''}${playback.clockDriftMs} ms` : ''}</> : '请打开 Spotify 桌面端并播放任意歌曲'}</span></div>
      {(localConnected || connected) && <CheckCircle2 className="diagnostic-check" />}
    </div>
    <div className="info-note">
      {activeLyrics?.textReference && <p>{referenceLabel(activeLyrics.textReference)}</p>}
      <p>遇到歌词提前、延迟或切歌回跳时，可以导出最近的播放采样和当前歌词信息，方便排查。</p>
      <button className="diagnostics-export" onClick={() => void exportDiagnostics()} disabled={exporting}><Download size={14} />{exporting ? '正在保存…' : '导出同步诊断'}</button>
      {exportStatus && <p role="status">{exportStatus}</p>}
    </div>
    {playback?.transition && <div className="info-note">已识别 Spotify 自定义转场：音乐 cue {playback.transition.cuePointMs} ms，重叠 {playback.transition.overlapMs == null ? '未知' : `${playback.transition.overlapMs} ms`}。</div>}
    {recentErrors && <div className="info-note error-log-card">
      <strong>{recentErrors.length ? '最近的程序错误' : '没有记录到程序错误'}</strong>
      {recentErrors.length > 0 && <ul>{recentErrors.map((line, index) => <li key={index} title={line}>{line}</li>)}</ul>}
      {recentErrors.length > 0 && <button onClick={() => void window.syllable.app?.revealErrorLog?.()}>打开日志所在位置</button>}
    </div>}
    <ChangelogCard />
    <div className="help-grid">
      <article><Keyboard /><strong>Ctrl + Alt + U</strong><span>解锁并显示歌词控制栏；鼠标移到锁定歌词上也可唤出控制栏。快捷键被占用时，可右键绿色音符托盘选择“解锁并显示歌词控制栏”。</span></article>
      <article><Keyboard /><strong>Ctrl + Alt + S</strong><span>打开客户端；关闭窗口后也可单击右下角绿色音符托盘图标。右键托盘可退出程序；图标可能在 Windows 的隐藏图标箭头中。</span></article>
      <article><Keyboard /><strong>Ctrl + F</strong><span>在当前歌词里查找：原文、罗马音和翻译都能搜，Enter 跳到下一处，Ctrl+Enter 从那一句开始播放</span></article>
      <article><MousePointerClick /><strong>右键歌词</strong><span>复制这一句或整首歌词（可带罗马音和翻译），或从这一句开始播放</span></article>
      <article><Keyboard /><strong>Ctrl + Alt + L</strong><span>显示或隐藏桌面悬浮歌词</span></article>
      <article><Keyboard /><strong>Ctrl + Alt + M</strong><span>锁定 / 解锁桌面歌词。锁定后歌词不挡鼠标，点击穿透到下面的窗口；未锁定时可拖动、缩放，Ctrl+滚轮调字号</span></article>
      <article><CircleHelp /><strong>歌词不匹配</strong><span>在「正在播放」页点来源标签换一个歌词来源，或点「编辑」搜索其他版本、逐行校时。</span></article>
    </div>
    <AudioSyncPanel />
    <a className="docs-link" href="https://github.com/tranxuanthang/lrcget" target="_blank">了解 LRC 歌词格式 <ExternalLink size={13} /></a>
  </div>
}

/** Recent updates, newest first; older ones unfold on request. */
function ChangelogCard() {
  const entries = releasedEntries(appVersion)
  const [all, setAll] = useState(false)
  if (!entries.length) return null
  const shown = all ? entries : entries.slice(0, 3)
  return <div className="info-note changelog-card">
    <strong>最近更新</strong>
    {shown.map(entry => <section key={entry.version}>
      <h4>{entry.version}<span>{entry.date}</span></h4>
      <ul>{entry.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </section>)}
    {entries.length > shown.length && <button onClick={() => setAll(true)}>显示更早的 {entries.length - shown.length} 次更新</button>}
  </div>
}
