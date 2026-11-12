import { memo, useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Eye, EyeOff, FileUp, Link2, LockKeyhole, Maximize2, Move, PanelRightClose, RotateCcw } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { displayLyricsOffset, listenedLyricsOffset } from '../lib/listened-offset'
import { languageFromFilename, makeTrack } from '../lib/lyrics'

const languageOptions = [
  { code: 'ja', label: '日本語' }, { code: 'romaji', label: 'Romaji' },
  { code: 'zh-Hans', label: '中文' }, { code: 'en', label: 'English' }
]

function Switch({ value, onChange, label, disabled = false }: { value: boolean; onChange(value: boolean): void; label: string; disabled?: boolean }) {
  return <button disabled={disabled} aria-label={label} aria-pressed={value} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /></button>
}

/** Fill of a range track left of the thumb, as a CSS percentage. */
export function rangeFill(value: number, min: number, max: number) {
  return `${max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0}%`
}

function Range({ value, min, max, step = 1, onChange, label, disabled = false }: { value: number; min: number; max: number; step?: number; onChange(value: number): void; label: string; disabled?: boolean }) {
  return <input type="range" aria-label={label} disabled={disabled} min={min} max={max} step={step} value={value}
    style={{ '--fill': rangeFill(value, min, max) } as React.CSSProperties} onChange={event => onChange(Number(event.target.value))} />
}

export type PanelTab = 'lyrics' | 'timing' | 'overlay' | 'connect'
export const TAB_KEY = 'syllable-ui-panel-tab'
export const PANEL_TAB_EVENT = 'syllable:panel-tab'
const readTab = (): PanelTab => {
  try { const value = localStorage.getItem(TAB_KEY); return value === 'timing' || value === 'overlay' || value === 'connect' ? value : 'lyrics' } catch { return 'lyrics' }
}

export const SettingsPanel = memo(function SettingsPanel({ onCollapse }: { onCollapse?: () => void }) {
  const [tab, setTab] = useState<PanelTab>(readTab)
  const selectTab = (value: PanelTab) => { setTab(value); try { localStorage.setItem(TAB_KEY, value) } catch { /* view-only preference */ } }
  // The overlay's control bar can ask for its settings ("悬浮窗设置").
  useEffect(() => {
    const show = (event: Event) => { const value = (event as CustomEvent<PanelTab>).detail; if (value) setTab(value) }
    window.addEventListener(PANEL_TAB_EVENT, show)
    return () => window.removeEventListener(PANEL_TAB_EVENT, show)
  }, [])
  const connected = useAppStore(state => state.connected)
  const localConnected = useAppStore(state => state.localConnected)
  const demoMode = useAppStore(state => state.demoMode)
  const playbackTrackId = useAppStore(state => state.playback?.track?.id)
  const settings = useAppStore(state => state.settings)
  const lyrics = useAppStore(state => state.lyrics)
  const setConnected = useAppStore(state => state.setConnected)
  const setDemoMode = useAppStore(state => state.setDemoMode)
  const setPlayback = useAppStore(state => state.setPlayback)
  const patchSettings = useAppStore(state => state.patchSettings)
  const setLyrics = useAppStore(state => state.setLyrics)
  const setLyricsOffset = useAppStore(state => state.setLyricsOffset)
  const [clientId, setClientId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const activeLyrics = !playbackTrackId || lyrics?.trackId === playbackTrackId ? lyrics : null
  const offsetMs = displayLyricsOffset(activeLyrics, demoMode ? settings.offsetMs : 0, settings.listenOffset !== false)
  const listened = !activeLyrics?.offsetMs && settings.listenOffset !== false && listenedLyricsOffset(activeLyrics) !== 0
  const changeOffset = (value: number) => activeLyrics ? setLyricsOffset(value) : demoMode ? patchSettings({ offsetMs: value }) : undefined

  useEffect(() => {
    const syncBounds = (bounds: { width: number; height: number }) => {
      const current = useAppStore.getState().settings
      if (current.overlayWidth !== bounds.width || current.overlayHeight !== bounds.height) patchSettings({ overlayWidth: bounds.width, overlayHeight: bounds.height })
    }
    void window.syllable.overlay.getBounds().then(syncBounds)
    return window.syllable.overlay.onBoundsChanged(syncBounds)
  }, [])

  const toggleLanguage = (code: string) => {
    const next = settings.enabledLanguages.includes(code) ? settings.enabledLanguages.filter(x => x !== code) : [...settings.enabledLanguages, code]
    patchSettings({ enabledLanguages: next })
  }
  const toggleOverlay = async () => {
    const next = !settings.overlayVisible
    patchSettings({ overlayVisible: next })
    await (next ? window.syllable.overlay.show() : window.syllable.overlay.hide())
  }
  const resizeOverlay = (width: number, height: number) => {
    patchSettings({ overlayWidth: width, overlayHeight: height })
    void window.syllable.overlay.setSize(width, height)
  }
  const connect = async () => {
    setConnecting(true); setMessage('正在浏览器中等待授权…')
    try {
      await window.syllable.auth.login(clientId); setConnected(true); setDemoMode(false)
      setPlayback(await window.syllable.playback.current()); setMessage('已连接 Spotify')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setConnecting(false) }
  }
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const currentTrack = useAppStore.getState().playback?.track ?? undefined
    const base = lyrics && lyrics.trackId === currentTrack?.id ? lyrics : { trackId: currentTrack?.id ?? 'local', track: currentTrack, tracks: [] }
    const additions = await Promise.all([...files].map(async (file, index) => {
      const language = languageFromFilename(file.name)
      return makeTrack(`local-${Date.now()}-${index}`, language.code, language.label, language.kind, await file.text(), file.name)
    }))
    const codes = [...new Set([...settings.enabledLanguages, ...additions.map(track => track.language)])]
    setLyrics({
      ...base,
      tracks: [...base.tracks.filter(track => !additions.some(item => item.language === track.language)), ...additions],
      userEditedTrackIds: [...new Set([...(base.userEditedTrackIds ?? []), ...additions.map(track => track.id)])],
      updatedAt: Date.now()
    })
    patchSettings({ enabledLanguages: codes }); setMessage(`已导入 ${additions.length} 条歌词轨道`)
  }

  const tabs: Array<{ id: PanelTab; label: string }> = [{ id: 'lyrics', label: '歌词' }, { id: 'timing', label: '同步' }, { id: 'overlay', label: '悬浮窗' }, { id: 'connect', label: '连接' }]
  return <aside className="settings-panel">
    <div className="panel-heading"><div><span>NOW PLAYING</span><h2>显示与同步</h2></div>{onCollapse && <button className="panel-collapse" title="收起设置面板，歌词区更宽" aria-label="收起设置面板" onClick={onCollapse}><PanelRightClose size={18} /></button>}</div>
    <div className="panel-tabs" role="tablist" aria-label="设置分类">{tabs.map(item => <button key={item.id} role="tab" id={`panel-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="panel-body" onClick={() => selectTab(item.id)}>{item.label}</button>)}</div>
    <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`panel-tab-${tab}`}>
      {tab === 'lyrics' && <>
        <section>
          <label className="setting-label">歌词语言 <small>可多选</small></label>
          <div className="language-grid">{languageOptions.map(item => {
            const selected = settings.enabledLanguages.includes(item.code)
            return <button className={selected ? 'selected' : ''} onClick={() => toggleLanguage(item.code)} key={item.code}><i />{item.label}{selected && <Check size={14} />}</button>
          })}</div>
          <label className="switch-row"><div><strong>日文罗马音</strong><span>有人工版本时优先显示</span></div><Switch label="日文罗马音" value={settings.romanization} onChange={romanization => patchSettings({ romanization })} /></label>
        </section>
        <section>
          <label className="setting-label">歌词字号 <small>{settings.fontSize}px</small></label>
          <Range min={34} max={88} value={settings.fontSize} onChange={fontSize => patchSettings({ fontSize })} label="歌词字号" />
        </section>
        <section>
          <input ref={inputRef} hidden multiple type="file" accept=".lrc,.txt" onChange={event => void importFiles(event.target.files)} />
          <button className="wide-button" onClick={() => inputRef.current?.click()}><FileUp size={16} />导入多语言 LRC</button>
          <p className="setting-hint">也可以直接把 LRC 文件拖进窗口；文件名带语言后缀（如 song.zh.lrc）会自动归到对应语言。</p>
          {message && <div className="inline-message">{message}</div>}
        </section>
      </>}
      {tab === 'timing' && <>
        <section>
          <label className="setting-label">逐曲同步校准 <small>{offsetMs > 0 ? '+' : ''}{offsetMs} ms{listened ? ' · 听音自动' : ''}</small></label>
          <Range min={-30000} max={30000} step={50} value={offsetMs} onChange={changeOffset} label="逐曲同步校准" />
          <div className="range-labels"><span>歌词提前</span><button onClick={() => changeOffset(0)}><RotateCcw size={12} />本曲归零</button><span>歌词延后</span></div>
          <div className="size-presets timing-presets"><button onClick={() => changeOffset(offsetMs - 1000)}>−1 秒</button><button onClick={() => changeOffset(offsetMs - 250)}>−250</button><button onClick={() => changeOffset(offsetMs + 250)}>+250</button><button onClick={() => changeOffset(offsetMs + 1000)}>+1 秒</button></div>
          <p className="setting-hint">只改这首歌的歌词时间，不影响 Spotify 播放进度；歌词出现得太早就往「延后」调。</p>
        </section>
        <section>
          <label className="switch-row" style={{ marginTop: 0 }}><div><strong>听音自动校准</strong><span>日语、中文、英文歌曲播放时在本机听几段声音，整体校正歌词提前或延后；音频不保存、不上传</span></div><Switch label="听音自动校准" value={settings.listenOffset !== false} onChange={listenOffset => patchSettings({ listenOffset })} /></label>
        </section>
      </>}
      {tab === 'overlay' && <>
        <section>
          <div className="section-heading"><div><strong>窗口大小与位置</strong><span>窗口边缘也可直接拖动缩放</span></div><Maximize2 size={15} /></div>
          <label className="setting-label top-gap">宽度 <small>{settings.overlayWidth}px</small></label>
          <Range min={480} max={2400} step={20} value={settings.overlayWidth} onChange={width => resizeOverlay(width, settings.overlayHeight)} label="悬浮窗宽度" />
          <label className="setting-label top-gap">高度 <small>{settings.overlayHeight}px</small></label>
          <Range min={140} max={1200} step={10} value={settings.overlayHeight} onChange={height => resizeOverlay(settings.overlayWidth, height)} label="悬浮窗高度" />
          <div className="size-presets"><button onClick={() => resizeOverlay(720, 190)}>紧凑</button><button onClick={() => resizeOverlay(920, 230)}>标准</button><button onClick={() => resizeOverlay(1280, 280)}>宽屏</button></div>
          <label className="setting-label top-gap">快速位置 <small>当前显示器</small></label>
          <div className="size-presets position-presets"><button onClick={() => void window.syllable.overlay.setPosition('top')}>顶部</button><button onClick={() => void window.syllable.overlay.setPosition('center')}>居中</button><button onClick={() => void window.syllable.overlay.setPosition('bottom')}>底部</button></div>
          <button className="wide-button subtle" onClick={() => void window.syllable.overlay.resetPosition()}><Move size={15} />恢复默认位置</button>
        </section>
        <section>
          <label className="switch-row" style={{ marginTop: 0 }}><div><strong>显示背景</strong><span>关闭后只保留歌词文字</span></div><Switch label="显示悬浮窗背景" value={settings.backgroundEnabled} onChange={backgroundEnabled => patchSettings({ backgroundEnabled })} /></label>
          <label className={`setting-label top-gap ${!settings.backgroundEnabled ? 'disabled-label' : ''}`}>背景透明度 <small>{settings.backgroundOpacity}%</small></label>
          <Range disabled={!settings.backgroundEnabled} min={10} max={100} value={settings.backgroundOpacity} onChange={backgroundOpacity => patchSettings({ backgroundOpacity })} label="背景透明度" />
          <label className={`setting-label top-gap ${!settings.backgroundEnabled ? 'disabled-label' : ''}`}>背景模糊 <small>{settings.blur}px</small></label>
          <Range disabled={!settings.backgroundEnabled} min={0} max={36} value={settings.blur} onChange={blur => patchSettings({ blur })} label="背景模糊" />
          <label className="setting-label top-gap">圆角 <small>{settings.cornerRadius}px</small></label>
          <Range min={0} max={32} value={settings.cornerRadius} onChange={cornerRadius => patchSettings({ cornerRadius })} label="圆角" />
        </section>
        <section>
          <label className="setting-label">文字效果</label>
          <div className="segmented three"><button className={settings.textEffect === 'none' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'none' })}>纯文字</button><button className={settings.textEffect === 'shadow' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'shadow' })}>柔和阴影</button><button className={settings.textEffect === 'outline' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'outline' })}>清晰描边</button></div>
          <label className="setting-label top-gap">文字颜色</label>
          <div className="segmented three"><button className={settings.textColor === 'white' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'white' })}>纯白</button><button className={settings.textColor === 'green' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'green' })}>Spotify 绿</button><button className={settings.textColor === 'warm' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'warm' })}>暖白</button></div>
          <label className="setting-label top-gap">文字对齐</label>
          <div className="segmented"><button className={settings.alignment === 'left' ? 'active' : ''} onClick={() => patchSettings({ alignment: 'left' })}>左对齐</button><button className={settings.alignment === 'center' ? 'active' : ''} onClick={() => patchSettings({ alignment: 'center' })}>居中</button></div>
          <label className="setting-label top-gap">文字透明度 <small>{settings.textOpacity}%</small></label>
          <Range min={45} max={100} value={settings.textOpacity} onChange={textOpacity => patchSettings({ textOpacity })} label="文字透明度" />
          <label className="setting-label top-gap">文字字重 <small>{settings.fontWeight}</small></label>
          <Range min={500} max={850} step={50} value={settings.fontWeight} onChange={fontWeight => patchSettings({ fontWeight })} label="文字字重" />
          <label className="setting-label top-gap">歌词行距 <small>{settings.lineHeight}%</small></label>
          <Range min={100} max={160} step={2} value={settings.lineHeight} onChange={lineHeight => patchSettings({ lineHeight })} label="歌词行距" />
        </section>
        <section>
          <label className="switch-row" style={{ marginTop: 0 }}><div><strong>锁定悬浮窗</strong><span>{settings.positionLocked ? '已锁定：歌词不挡鼠标，点击会穿透到下面的窗口；鼠标在歌词上停一下会出现控制条' : '未锁定：拖动歌词移动、拖边缘缩放、Ctrl+滚轮调字号、双击打开客户端'}</span></div><Switch label="锁定悬浮窗位置" value={settings.positionLocked} onChange={positionLocked => { patchSettings({ positionLocked, clickThrough: positionLocked }); void window.syllable.overlay.setMovable(!positionLocked) }} /></label>
        </section>
        <section>
          <label className="setting-label">快捷键</label>
          <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>L</kbd><span>显示 / 隐藏</span></div>
          <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>M</kbd><span>锁定 / 解锁</span></div>
          <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>U</kbd><span>解锁并显示控制栏</span></div>
        </section>
      </>}
      {tab === 'connect' && <section>
        <div className="connect-card">
          <div className="connect-title"><span className={localConnected || (connected && !demoMode) ? 'status-dot online' : 'status-dot'} /><strong>{localConnected ? 'Spotify 桌面端已同步' : connected && !demoMode ? 'Spotify Web API 已连接' : '尚未检测到 Spotify'}</strong></div>
          {localConnected && <div className="native-connected"><Check size={14} />Windows 媒体会话连接正常</div>}
          {connected && !demoMode ? <button className="wide-button" onClick={async () => { await window.syllable.auth.logout(); setConnected(false); useAppStore.getState().startDemo() }}>断开 Web API</button> : <>
            <div className="client-input"><LockKeyhole size={14} /><input value={clientId} onChange={event => setClientId(event.target.value)} placeholder="可选：Spotify Client ID" /></div>
            <button disabled={!clientId || connecting} className="wide-button spotify" onClick={() => void connect()}><Link2 size={16} />{connecting ? '等待授权…' : '连接 Spotify Web API'}</button>
            <p>连接 Web API 后可以提前准备下一首歌的歌词；只用本机 Spotify 播放时不需要。</p>
            <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify Developer Dashboard <ExternalLink size={12} /></a>
          </>}
          {message && <div className="inline-message">{message}</div>}
        </div>
      </section>}
    </div>
    <div className="panel-footer">
      <button className="wide-button primary" onClick={toggleOverlay}>{settings.overlayVisible ? <EyeOff size={17} /> : <Eye size={17} />}{settings.overlayVisible ? '隐藏桌面歌词' : '显示桌面歌词'}</button>
    </div>
  </aside>
})
