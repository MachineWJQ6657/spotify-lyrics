import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ClipboardPaste, ExternalLink, Eye, EyeOff, FileUp, Link2, LockKeyhole, Maximize2, Move, PanelRightClose, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { displayLyricsOffset, listenedLyricsOffset } from '../lib/listened-offset'
import { decodeLyricFile, importLyricFiles, importMessage } from '../lib/lyrics-import'
import { currentListenDecision, listeningTrackId, relistenCurrentSong, subscribeListening } from '../lib/listen-controller'
import { listenStatus } from '../lib/listen-status'
import { languageAvailability } from '../lib/language-availability'
import { PASTE_LANGUAGES, PasteTranslation, searchTranslation } from './PasteTranslation'
import { pastedTrackId } from '../lib/pasted-translation'
import type { LyricsDocument } from '../types'
import { t, tk } from '../lib/i18n'

const languageOptions = [
  { code: 'ja', label: tk('日本語') }, { code: 'romaji', label: 'Romaji' },
  { code: 'zh-Hans', label: tk('中文') }, { code: 'en', label: 'English' }
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

/**
 * The language switches. Each says what it can do for the song on screen:
 * nothing changes there for a language the song lacks (most songs have no
 * English translation), or for the language the song is in (always shown).
 */
export function LanguageSwitches({ document, enabled, onToggle, onPaste, onSearch }: { document: LyricsDocument | null; enabled: string[]; onToggle(code: string): void; onPaste?(code: string): void; onSearch?(code: string): void }) {
  const states = languageOptions.map(item => ({ ...item, name: t(item.label), selected: enabled.includes(item.code), state: languageAvailability(document, item.code) }))
  const missing = states.filter(item => item.selected && item.state === 'missing').map(item => item.name)
  // A translation the song lacks can be brought in from a web page.
  const pasteable = onPaste ? states.filter(item => item.selected && item.state === 'missing' && item.code in PASTE_LANGUAGES) : []
  // One that was pasted can be pasted again (another page, a better translation).
  const pasted = onPaste ? states.filter(item => item.selected && item.state === 'switchable' && document?.tracks.some(track => track.id === pastedTrackId(item.code))) : []
  return <>
    <div className="language-grid">{states.map(item =>
      <button className={`${item.selected ? 'selected' : ''} ${item.state === 'missing' || item.state === 'original' ? item.state : ''}`.trim()} aria-pressed={item.selected} key={item.code}
        title={item.state === 'missing' ? t('这首歌没有这种语言的歌词：{language}', { language: item.name }) : item.state === 'original' ? t('这首歌的原文，始终显示') : undefined}
        onClick={() => onToggle(item.code)}><i /><span>{item.name}</span>{item.state === 'missing' ? <em>{t('这首没有')}</em> : item.state === 'original' ? <em>{t('原文')}</em> : item.selected && <Check size={14} />}</button>)}</div>
    {missing.length > 0 && <p className="language-note">{t('这首歌没有这些语言的歌词：{languages}。有的歌会照常显示；翻译可以从网页上复制后粘贴进来，也可以导入对应语言的 LRC 文件。', { languages: missing.join(' / ') })}</p>}
    {pasteable.map(item => <div className="language-actions" key={item.code}>
      <button onClick={() => onSearch?.(item.code)}><Search size={13} />{t('上网查找{language}翻译', { language: item.name })}</button>
      <button onClick={() => onPaste?.(item.code)}><ClipboardPaste size={13} />{t('粘贴翻译')}</button>
    </div>)}
    {pasted.map(item => <div className="language-actions" key={item.code}>
      <button onClick={() => onPaste?.(item.code)}><ClipboardPaste size={13} />{t('重新粘贴{language}翻译', { language: item.name })}</button>
    </div>)}
  </>
}

export type PanelTab = 'lyrics' | 'timing' | 'overlay' | 'connect'
export const TAB_KEY = 'syllable-ui-panel-tab'
export const PANEL_TAB_EVENT = 'syllable:panel-tab'
const readTab = (): PanelTab => {
  try { const value = localStorage.getItem(TAB_KEY); return value === 'timing' || value === 'overlay' || value === 'connect' ? value : 'lyrics' } catch { return 'lyrics' }
}

export const SettingsPanel = memo(function SettingsPanel({ onCollapse }: { onCollapse?: () => void }) {
  const [tab, setTab] = useState<PanelTab>(readTab)
  const [pasteLanguage, setPasteLanguage] = useState<string | null>(null)
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
  // Listening calibration for this song: what it found, and "run it (again) now".
  const isPlaying = useAppStore(state => Boolean(state.playback?.isPlaying))
  const listeningNow = useSyncExternalStore(subscribeListening, listeningTrackId, listeningTrackId) === (playbackTrackId ?? null) && Boolean(playbackTrackId)
  const listenDecision = currentListenDecision(true)
  const listening = listenStatus({ document: activeLyrics, listening: listeningNow, enabled: settings.listenOffset !== false, playing: isPlaying,
    reason: 'reason' in listenDecision ? listenDecision.reason : undefined })

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
    setConnecting(true); setMessage(t('正在浏览器中等待授权…'))
    try {
      await window.syllable.auth.login(clientId); setConnected(true); setDemoMode(false)
      setPlayback(await window.syllable.playback.current()); setMessage(t('已连接 Spotify'))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setConnecting(false) }
  }
  const importFiles = async (files: File[]) => {
    if (!files.length) return
    const texts = await Promise.all(files.map(async file => ({ name: file.name, text: decodeLyricFile(await file.arrayBuffer()) })))
    // The song and its document as they are now: the files were read meanwhile.
    const state = useAppStore.getState()
    const result = importLyricFiles(state.lyrics, state.playback?.track ?? undefined, texts)
    if (result.document) {
      setLyrics(result.document)
      patchSettings({ enabledLanguages: [...new Set([...state.settings.enabledLanguages, ...result.imported.map(track => track.language)])] })
    }
    setMessage(importMessage(result))
  }

  const tabs: Array<{ id: PanelTab; label: string }> = [{ id: 'lyrics', label: t('歌词') }, { id: 'timing', label: t('同步') }, { id: 'overlay', label: t('悬浮窗') }, { id: 'connect', label: t('连接') }]
  return <aside className="settings-panel">
    <div className="panel-heading"><div><span>NOW PLAYING</span><h2>{t('显示与同步')}</h2></div>{onCollapse && <button className="panel-collapse" title={t('收起设置面板，歌词区更宽')} aria-label={t('收起设置面板')} onClick={onCollapse}><PanelRightClose size={18} /></button>}</div>
    <div className="panel-tabs" role="tablist" aria-label={t('设置分类')}>{tabs.map(item => <button key={item.id} role="tab" id={`panel-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="panel-body" onClick={() => selectTab(item.id)}>{item.label}</button>)}</div>
    <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`panel-tab-${tab}`}>
      {tab === 'lyrics' && <>
        <section>
          <label className="setting-label">{t('歌词语言')} <small>{t('可多选')}</small></label>
          <LanguageSwitches document={activeLyrics} enabled={settings.enabledLanguages} onToggle={toggleLanguage}
            onPaste={setPasteLanguage} onSearch={code => searchTranslation(code, activeLyrics?.track)} />
          {pasteLanguage && <PasteTranslation language={pasteLanguage} onClose={() => setPasteLanguage(null)} />}
          <label className="switch-row"><div><strong>{t('日文罗马音')}</strong><span>{t('有人工版本时优先显示')}</span></div><Switch label={t('日文罗马音')} value={settings.romanization} onChange={romanization => patchSettings({ romanization })} /></label>
        </section>
        <section>
          <label className="setting-label">{t('歌词字号')} <small>{settings.fontSize}px</small></label>
          <Range min={34} max={88} value={settings.fontSize} onChange={fontSize => patchSettings({ fontSize })} label={t('歌词字号')} />
          <label className="setting-label top-gap">{t('主窗口歌词对齐')}</label>
          <div className="segmented"><button className={settings.mainAlignment !== 'center' ? 'active' : ''} onClick={() => patchSettings({ mainAlignment: 'left' })}>{t('靠左')}</button><button className={settings.mainAlignment === 'center' ? 'active' : ''} onClick={() => patchSettings({ mainAlignment: 'center' })}>{t('居中')}</button></div>
        </section>
        <section>
          <input ref={inputRef} hidden multiple type="file" accept=".lrc,.txt" onChange={event => {
            // Cleared at once, so choosing the same file again (after fixing it) is a change too.
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            void importFiles(files)
          }} />
          <button className="wide-button" onClick={() => inputRef.current?.click()}><FileUp size={16} />{t('导入多语言 LRC')}</button>
          <p className="setting-hint">{t('也可以直接把 LRC 文件拖进窗口；文件名带语言后缀（如 song.zh.lrc）会自动归到对应语言。')}</p>
          {message && <div className="inline-message">{message}</div>}
        </section>
      </>}
      {tab === 'timing' && <>
        <section>
          <label className="setting-label">{t('逐曲同步校准')} <small>{offsetMs > 0 ? '+' : ''}{offsetMs} ms{listened ? ` · ${t('听音自动')}` : ''}</small></label>
          <Range min={-30000} max={30000} step={50} value={offsetMs} onChange={changeOffset} label={t('逐曲同步校准')} />
          <div className="range-labels"><span>{t('歌词提前')}</span><button onClick={() => changeOffset(0)}><RotateCcw size={12} />{t('本曲归零')}</button><span>{t('歌词延后')}</span></div>
          <div className="size-presets timing-presets"><button onClick={() => changeOffset(offsetMs - 1000)}>{t('−1 秒')}</button><button onClick={() => changeOffset(offsetMs - 250)}>−250</button><button onClick={() => changeOffset(offsetMs + 250)}>+250</button><button onClick={() => changeOffset(offsetMs + 1000)}>{t('+1 秒')}</button></div>
          <p className="setting-hint">{t('只改这首歌的歌词时间，不影响 Spotify 播放进度；歌词出现得太早就往「延后」调。')}</p>
        </section>
        <section>
          <label className="switch-row" style={{ marginTop: 0 }}><div><strong>{t('听音自动校准')}</strong><span>{t('播放日语、中文、英文歌曲时听几段声音，自动把歌词整体提前或延后')}</span></div><Switch label={t('听音自动校准')} value={settings.listenOffset !== false} onChange={listenOffset => patchSettings({ listenOffset })} /></label>
          <div className="listen-status">
            <p role="status">{listening.text}</p>
            <button className="wide-button" disabled={!listening.canRun} onClick={() => { relistenCurrentSong() }}><RefreshCw size={15} />{listening.action}</button>
          </div>
        </section>
      </>}
      {tab === 'overlay' && <>
        <section>
          <div className="section-heading"><div><strong>{t('窗口大小与位置')}</strong><span>{t('窗口边缘也可直接拖动缩放')}</span></div><Maximize2 size={15} /></div>
          <label className="setting-label top-gap">{t('宽度')} <small>{settings.overlayWidth}px</small></label>
          <Range min={480} max={2400} step={20} value={settings.overlayWidth} onChange={width => resizeOverlay(width, settings.overlayHeight)} label={t('悬浮窗宽度')} />
          <label className="setting-label top-gap">{t('高度')} <small>{settings.overlayHeight}px</small></label>
          <Range min={140} max={1200} step={10} value={settings.overlayHeight} onChange={height => resizeOverlay(settings.overlayWidth, height)} label={t('悬浮窗高度')} />
          <div className="size-presets"><button onClick={() => resizeOverlay(720, 190)}>{t('紧凑')}</button><button onClick={() => resizeOverlay(920, 230)}>{t('标准')}</button><button onClick={() => resizeOverlay(1280, 280)}>{t('宽屏')}</button></div>
          <label className="setting-label top-gap">{t('快速位置')} <small>{t('当前显示器')}</small></label>
          <div className="size-presets position-presets"><button onClick={() => void window.syllable.overlay.setPosition('top')}>{t('顶部')}</button><button onClick={() => void window.syllable.overlay.setPosition('center')}>{t('居中')}</button><button onClick={() => void window.syllable.overlay.setPosition('bottom')}>{t('底部')}</button></div>
          <button className="wide-button subtle" onClick={() => void window.syllable.overlay.resetPosition()}><Move size={15} />{t('恢复默认位置')}</button>
        </section>
        <section>
          <label className="switch-row" style={{ marginTop: 0 }}><div><strong>{t('显示背景')}</strong><span>{t('关闭后只保留歌词文字')}</span></div><Switch label={t('显示悬浮窗背景')} value={settings.backgroundEnabled} onChange={backgroundEnabled => patchSettings({ backgroundEnabled })} /></label>
          <label className={`setting-label top-gap ${!settings.backgroundEnabled ? 'disabled-label' : ''}`}>{t('背景不透明度')} <small>{settings.backgroundOpacity}%</small></label>
          <Range disabled={!settings.backgroundEnabled} min={10} max={100} value={settings.backgroundOpacity} onChange={backgroundOpacity => patchSettings({ backgroundOpacity })} label={t('背景不透明度')} />
          <label className={`setting-label top-gap ${!settings.backgroundEnabled ? 'disabled-label' : ''}`}>{t('背景模糊')} <small>{settings.blur}px</small></label>
          <Range disabled={!settings.backgroundEnabled} min={0} max={36} value={settings.blur} onChange={blur => patchSettings({ blur })} label={t('背景模糊')} />
          <label className="setting-label top-gap">{t('圆角')} <small>{settings.cornerRadius}px</small></label>
          <Range min={0} max={32} value={settings.cornerRadius} onChange={cornerRadius => patchSettings({ cornerRadius })} label={t('圆角')} />
        </section>
        <section>
          <label className="setting-label">{t('文字效果')}</label>
          <div className="segmented three"><button className={settings.textEffect === 'none' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'none' })}>{t('纯文字')}</button><button className={settings.textEffect === 'shadow' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'shadow' })}>{t('柔和阴影')}</button><button className={settings.textEffect === 'outline' ? 'active' : ''} onClick={() => patchSettings({ textEffect: 'outline' })}>{t('清晰描边')}</button></div>
          <label className="setting-label top-gap">{t('文字颜色')}</label>
          <div className="segmented three"><button className={settings.textColor === 'white' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'white' })}>{t('纯白')}</button><button className={settings.textColor === 'green' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'green' })}>{t('Spotify 绿')}</button><button className={settings.textColor === 'warm' ? 'active' : ''} onClick={() => patchSettings({ textColor: 'warm' })}>{t('暖白')}</button></div>
          <label className="setting-label top-gap">{t('文字对齐')}</label>
          <div className="segmented"><button className={settings.alignment === 'left' ? 'active' : ''} onClick={() => patchSettings({ alignment: 'left' })}>{t('左对齐')}</button><button className={settings.alignment === 'center' ? 'active' : ''} onClick={() => patchSettings({ alignment: 'center' })}>{t('居中')}</button></div>
          <label className="setting-label top-gap">{t('文字不透明度')} <small>{settings.textOpacity}%</small></label>
          <Range min={45} max={100} value={settings.textOpacity} onChange={textOpacity => patchSettings({ textOpacity })} label={t('文字不透明度')} />
          <p className="setting-hint">{t('100% 是完全不透明，数值越小文字越淡。')}</p>
          <label className="setting-label top-gap">{t('文字字重')} <small>{settings.fontWeight}</small></label>
          <Range min={500} max={850} step={50} value={settings.fontWeight} onChange={fontWeight => patchSettings({ fontWeight })} label={t('文字字重')} />
          <label className="setting-label top-gap">{t('歌词行距')} <small>{settings.lineHeight}%</small></label>
          <Range min={100} max={160} step={2} value={settings.lineHeight} onChange={lineHeight => patchSettings({ lineHeight })} label={t('歌词行距')} />
          <label className="switch-row"><div><strong>{t('显示下一句')}</strong><span>{t('在当前歌词下面用较小的字预告下一句；窗口放不下时自动隐藏')}</span></div><Switch label={t('显示下一句')} value={settings.overlayNextLine === true} onChange={overlayNextLine => patchSettings({ overlayNextLine })} /></label>
          <label className="switch-row"><div><strong>{t('暂停时隐藏')}</strong><span>{t('锁定的悬浮窗在暂停 10 秒后淡出，继续播放时自动出现')}</span></div><Switch label={t('暂停时隐藏悬浮窗')} value={settings.overlayHideWhenPaused === true} onChange={overlayHideWhenPaused => patchSettings({ overlayHideWhenPaused })} /></label>
        </section>
        <section>
          <label className="switch-row" style={{ marginTop: 0 }}><div><strong>{t('锁定悬浮窗')}</strong><span>{settings.positionLocked ? t('已锁定：歌词不挡鼠标，点击会穿透到下面的窗口；鼠标在歌词上停一下会出现控制条') : t('未锁定：拖动歌词移动、拖边缘缩放、Ctrl+滚轮调字号、双击打开客户端')}</span></div><Switch label={t('锁定悬浮窗位置')} value={settings.positionLocked} onChange={positionLocked => { patchSettings({ positionLocked, clickThrough: positionLocked }); void window.syllable.overlay.setMovable(!positionLocked) }} /></label>
        </section>
        <section>
          <label className="setting-label">{t('快捷键')}</label>
          <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>L</kbd><span>{t('显示 / 隐藏')}</span></div>
          <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>M</kbd><span>{t('锁定 / 解锁')}</span></div>
          <div className="hotkey-hint"><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>U</kbd><span>{t('解锁并显示控制栏')}</span></div>
        </section>
      </>}
      {tab === 'connect' && <section>
        <div className="connect-card">
          <div className="connect-title"><span className={localConnected || (connected && !demoMode) ? 'status-dot online' : 'status-dot'} /><strong>{localConnected ? t('Spotify 桌面端已同步') : connected && !demoMode ? t('Spotify Web API 已连接') : t('尚未检测到 Spotify')}</strong></div>
          {localConnected && <div className="native-connected"><Check size={14} />{t('Windows 媒体会话连接正常')}</div>}
          {connected && !demoMode ? <button className="wide-button" onClick={async () => { await window.syllable.auth.logout(); setConnected(false); useAppStore.getState().startDemo() }}>{t('断开 Web API')}</button> : <>
            <div className="client-input"><LockKeyhole size={14} /><input value={clientId} onChange={event => setClientId(event.target.value)} placeholder={t('可选：Spotify Client ID')} /></div>
            <button disabled={!clientId || connecting} className="wide-button spotify" onClick={() => void connect()}><Link2 size={16} />{connecting ? t('等待授权…') : t('连接 Spotify Web API')}</button>
            <p>{t('连接 Web API 后可以提前准备下一首歌的歌词；只用本机 Spotify 播放时不需要。')}</p>
            <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify Developer Dashboard <ExternalLink size={12} /></a>
          </>}
          {message && <div className="inline-message">{message}</div>}
        </div>
      </section>}
    </div>
    <div className="panel-footer">
      <button className="wide-button primary" onClick={toggleOverlay}>{settings.overlayVisible ? <EyeOff size={17} /> : <Eye size={17} />}{settings.overlayVisible ? t('隐藏桌面歌词') : t('显示桌面歌词')}</button>
    </div>
  </aside>
})
