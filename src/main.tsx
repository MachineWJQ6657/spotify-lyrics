import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

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

void view.then(View => {
  root.render(<React.StrictMode><View /></React.StrictMode>)
}).catch(error => {
  console.error('Failed to load Syllable window', error)
  root.render(<div className="startup-error">Syllable 窗口加载失败，请从托盘重新打开。</div>)
})
