import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { useAppStore } from './store/useAppStore'
import { resolveLanguage, setLanguage, t } from './lib/i18n'

const isOverlay = window.location.hash === '#/overlay'
const isOverlayControls = window.location.hash === '#/overlay-controls'
const root = ReactDOM.createRoot(document.getElementById('root')!)

// Each BrowserWindow has its own JavaScript realm even when Chromium reuses the
// renderer process. Loading the complete editor and library UI in the two tiny
// auxiliary windows wastes memory and makes the hover controls slower to wake.
// Keep their dependency graphs separate and only parse the view this window uses.
const view = isOverlayControls
  ? import('./OverlayControls').then(module => module.OverlayControls)
  : isOverlay
    ? import('./Overlay').then(module => module.Overlay)
    : import('./App').then(module => module.App)

/**
 * Sets this window's language from the saved setting before anything below
 * renders, and renders the view anew when it changes: texts are read with t()
 * while rendering, and memoized parts would otherwise keep the old language.
 */
function Localized({ children }: { children: React.ReactNode }) {
  const language = resolveLanguage(useAppStore(state => state.settings.language), navigator.language)
  setLanguage(language)
  useEffect(() => {
    window.document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
    // The main process words the tray menu and its own messages.
    if (!isOverlay && !isOverlayControls) void window.syllable.app?.setLanguage?.(language)
  }, [language])
  return <React.Fragment key={language}>{children}</React.Fragment>
}

void view.then(View => {
  root.render(<React.StrictMode><Localized><View /></Localized></React.StrictMode>)
}).catch(error => {
  console.error('Failed to load Syllable window', error)
  root.render(<div className="startup-error">{t('Syllable 窗口加载失败，请从托盘重新打开。')}</div>)
})
