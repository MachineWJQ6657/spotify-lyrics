import { memo } from 'react'
import { BrandMark } from './BrandMark'
import { WindowControls } from './Icons'

export const Titlebar = memo(function Titlebar({ title = '正在播放' }: { title?: string }) {
  return <header className="titlebar drag-region">
    <div className="brand"><span className="brand-mark"><BrandMark size={22} /></span><span>Syllable</span><span className="version">{version}</span></div>
    <div className="titlebar-center">{title}</div>
    <WindowControls />
  </header>
})
import { version } from '../../package.json'
