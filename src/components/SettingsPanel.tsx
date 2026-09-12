import { memo, useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Eye, EyeOff, FileUp, Link2, LockKeyhole, Maximize2, MousePointer2, Move, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { languageFromFilename, makeTrack } from '../lib/lyrics'

const languageOptions = [
  { code: 'ja', label: '日本語' }, { code: 'romaji', label: 'Romaji' },
  { code: 'zh-Hans', label: '中文' }, { code: 'en', label: 'English' }
]

function Switch({ value, onChange, label }: { value: boolean; onChange(value: boolean): void; label: string }) {
  return <button aria-label={label} aria-pressed={value} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /></button>
}

export const SettingsPanel = memo(function SettingsPanel() {
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
  const offsetMs = activeLyrics?.offsetMs ?? (demoMode ? settings.offsetMs : 0)
  const changeOffset = (value: number) => activeLyrics ? setLyricsOffset(value) : demoMode ? patchSettings({ offsetMs: value }) : undefined

  useEffect(() => {
    void window.syllable.overlay.setMovable(!settings.positionLocked)
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

  return <aside className="settings-panel">
    <div className="panel-heading"><div><span>NOW PLAYING VIEW</span><h2>歌词与悬浮窗</h2></div><SlidersHorizontal size={19} /></div>
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
      <input type="range" min="34" max="88" value={settings.fontSize} onChange={event => patchSettings({ fontSize: Number(event.target.value) })} />
      <label className="setting-label top-gap">逐曲同步校准 <small>{offsetMs > 0 ? '+' : ''}{offsetMs} ms</small></label>
      <input type="range" min="-30000" max="30000" step="50" value={offsetMs} onChange={event => changeOffset(Number(event.target.value))} />
      <div className="range-labels"><span>提前</span><button onClick={() => changeOffset(0)}><RotateCcw size={12} />本曲归零</button><span>延后</span></div>
      <div className="size-presets timing-presets"><button onClick={() => changeOffset(offsetMs - 250)}>−250 ms</button><button onClick={() => changeOffset(0)}>0</button><button onClick={() => changeOffset(offsetMs + 250)}>+250 ms</button></div>
      <div className="size-presets timing-presets"><button onClick={() => changeOffset(offsetMs - 1000)}>−1 秒</button><button onClick={() => changeOffset(offsetMs + 1000)}>+1 秒</button></div>
    </section>

    <section>
      <div className="section-heading"><div><strong>悬浮窗外观</strong><span>窗口边缘也可直接拖动缩放</span></div><Maximize2 size={15} /></div>
      <label className="setting-label top-gap">窗口宽度 <small>{settings.overlayWidth}px</small></label>
      <input type="range" min="480" max="2400" step="20" value={settings.overlayWidth} onChange={event => resizeOverlay(Number(event.target.value), settings.overlayHeight)} />
      <label className="setting-label top-gap">窗口高度 <small>{settings.overlayHeight}px</small></label>
      <input type="range" min="140" max="1200" step="10" value={settings.overlayHeight} onChange={event => resizeOverlay(settings.overlayWidth, Number(event.target.value))} />
      <div className="size-presets"><button onClick={() => resizeOverlay(720, 190)}>紧凑</button><button onClick={() => resizeOverlay(920, 230)}>标准</button><button onClick={() => resizeOverlay(1280, 280)}>宽屏</button></div>
      <label className="setting-label top-gap">快速位置 <small>当前显示器</small></label>
      <div className="size-presets position-presets"><button onClick={() => void window.syllable.overlay.setPosition('top')}>顶部</button><button onClick={() => void window.syllable.overlay.setPosition('center')}>居中</button><button onClick={() => void window.syllable.overlay.setPosition('bottom')}>底部</button></div>

      <label className="switch-row"><div><strong>显示背景</strong><span>关闭后只保留歌词文字</span></div><Switch label="显示悬浮窗背景" value={settings.backgroundEnabled} onChange={backgroundEnabled => patchSettings({ backgroundEnabled })} /></label>
      <label className={`setting-label top-gap ${!settings.backgroundEnabled ? 'disabled-label' : ''}`}>背景透明度 <small>{settings.backgroundOpacity}%</small></label>
      <input disabled={!settings.backgroundEnabled} type="range" min="10" max="100" value={settings.backgroundOpacity} onChange={event => patchSettings({ backgroundOpacity: Number(event.target.value) })} />
      <label className="setting-label top-gap">文字透明度 <small>{settings.textOpacity}%</small></label>
      <input type="range" min="45" max="100" value={settings.textOpacity} onChange={event => patchSettings({ textOpacity: Number(event.target.value) })} />
      <label className="setting-label top-gap">圆角 <small>{settings.cornerRadius}px</small></label>
      <input type="range" min="0" max="32" value={settings.cornerRadius} onChange={event => patchSettings({ cornerRadius: Number(event.target.value) })} />
      <label className="setting-label top-gap">背景模糊 <small>{settings.blur}px</small></label>
      <input disabled={!settings.backgroundEnabled} type="range" min="0" max="36" value={settings.blur} onChange={event => patchSettings({ blur: Number(event.target.value) })} />

      <label className="setting-label top-gap">文字效果</label>
      <div className="segmented three"><button className={settings.textEffect === 'none' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'none' })}>纯文字</button><button className={settings.textEffect === 'shadow' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'shadow' })}>柔和阴影</button><button className={settings.textEffect === 'outline' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'outline' })}>清晰描边</button></div>
      <label className="setting-label top-gap">文字颜色</label>
      <div className="segmented three"><button className={settings.textColor === 'white' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'white' })}>纯白</button><button className={settings.textColor === 'green' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'green' })}>Spotify 绿</button><button className={settings.textColor === 'warm' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'warm' })}>暖白</button></div>
      <label className="setting-label top-gap">文字字重 <small>{settings.fontWeight}</small></label>
      <input type="range" min="500" max="850" step="50" value={settings.fontWeight} onChange={event => patchSettings({ fontWeight: Number(event.target.value) })} />
      <label className="setting-label top-gap">歌词行距 <small>{settings.lineHeight}%</small></label>
      <input type="range" min="100" max="160" step="2" value={settings.lineHeight} onChange={event => patchSettings({ lineHeight: Number(event.target.value) })} />
      <label className="setting-label top-gap">文字对齐</label>
      <div className="segmented"><button className={settings.alignment === 'left' ? 'active' : ''} onClick={() => patchSettings({ alignment: 'left' })}>左对齐</button><button className={settings.alignment === 'center' ? 'active' : ''} onClick={() => patchSettings({ alignment: 'center' })}>居中</button></div>
      <label className="switch-row"><div><strong>锁定位置</strong><span>关闭后可直接拖动歌词，并自动退出文字穿透</span></div><Switch label="锁定悬浮窗位置" value={settings.positionLocked} onChange={positionLocked => { patchSettings({ positionLocked, ...(!positionLocked ? { clickThrough: false } : {}) }); void window.syllable.overlay.setMovable(!positionLocked) }} /></label>
      <button className="wide-button subtle" onClick={() => void window.syllable.overlay.resetPosition()}><Move size={15} />恢复默认位置</button>
    </section>

    <section className="action-stack">
      <button className="wide-button primary" onClick={toggleOverlay}>{settings.overlayVisible ? <EyeOff size={17} /> : <Eye size={17} />}{settings.overlayVisible ? '隐藏桌面歌词' : '显示桌面歌词'}</button>
      <label className="switch-row compact"><div><MousePointer2 size={16} /><strong>歌词文字穿透（解锁位置时自动关闭）</strong></div><Switch label="鼠标穿透" value={settings.clickThrough} onChange={clickThrough => { patchSettings({ clickThrough }); void window.syllable.overlay.setClickThrough(clickThrough) }} /></label>
      <input ref={inputRef} hidden multiple type="file" accept=".lrc,.txt" onChange={event => void importFiles(event.target.files)} />
      <button className="wide-button" onClick={() => inputRef.current?.click()}><FileUp size={16} />导入多语言 LRC</button>
      <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>L</kbd><span>显示 / 隐藏</span></div>
      <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>M</kbd><span>切换鼠标穿透</span></div>
    </section>

    <section className="connect-card">
      <div className="connect-title"><span className={localConnected || (connected && !demoMode) ? 'status-dot online' : 'status-dot'} /><strong>{localConnected ? 'Spotify 桌面端已同步' : connected && !demoMode ? 'Spotify Web API 已连接' : '尚未检测到 Spotify'}</strong></div>
      {localConnected && <div className="native-connected"><Check size={14} />Windows 媒体会话连接正常</div>}
      {connected && !demoMode ? <button className="wide-button" onClick={async () => { await window.syllable.auth.logout(); setConnected(false); useAppStore.getState().startDemo() }}>断开 Web API</button> : <>
        <div className="client-input"><LockKeyhole size={14} /><input value={clientId} onChange={event => setClientId(event.target.value)} placeholder="可选：Spotify Client ID" /></div>
        <button disabled={!clientId || connecting} className="wide-button spotify" onClick={() => void connect()}><Link2 size={16} />{connecting ? '等待授权…' : '连接 Spotify Web API'}</button>
        <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify Developer Dashboard <ExternalLink size={12} /></a>
      </>}
      {message && <div className="inline-message">{message}</div>}
    </section>
  </aside>
})
