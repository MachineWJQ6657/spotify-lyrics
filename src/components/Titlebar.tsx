import { memo } from 'react'
import { BrandMark } from './BrandMark'
import { WindowControls } from './Icons'

export const Titlebar = memo(function Titlebar() {
  return <header className="titlebar drag-region">
    <div className="brand"><span className="brand-mark"><BrandMark size={28} /></span><span>Syllable</span><span className="version">0.4.17</span></div>
    <div className="titlebar-center">正在播放</div>
    <WindowControls />
  </header>
})
