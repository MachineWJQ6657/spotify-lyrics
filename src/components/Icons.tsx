import { Minus, Square, X } from 'lucide-react'

export function WindowControls() {
  return <div className="window-controls no-drag">
    <button aria-label="最小化" onClick={() => void window.syllable.window.minimize()}><Minus size={14} /></button>
    <button aria-label="最大化" onClick={() => void window.syllable.window.maximize()}><Square size={11} /></button>
    <button className="window-close" aria-label="关闭" onClick={() => void window.syllable.window.close()}><X size={14} /></button>
  </div>
}
