import { memo } from 'react'
import { Captions, CircleHelp, LayoutDashboard, Radio, Settings2, Sparkles } from 'lucide-react'

export type AppView = 'now' | 'library' | 'sources' | 'settings' | 'help'

export const Sidebar = memo(function Sidebar({ active, onChange }: { active: AppView; onChange(view: AppView): void }) {
  return <aside className="sidebar">
    <nav>
      <button onClick={() => onChange('now')} className={`nav-item ${active === 'now' ? 'active' : ''}`}><LayoutDashboard size={18} /><span>正在播放</span></button>
      <button onClick={() => onChange('library')} className={`nav-item ${active === 'library' ? 'active' : ''}`}><Captions size={18} /><span>歌词资料库</span></button>
      <button onClick={() => onChange('sources')} className={`nav-item ${active === 'sources' ? 'active' : ''}`}><Radio size={18} /><span>歌词源</span></button>
    </nav>
    <div className="sidebar-spacer" />
    <div className="tip-card">
      <Sparkles size={17} />
      <p>可直接拖入带语言后缀的 LRC，例如 <code>song.zh.lrc</code></p>
    </div>
    <nav>
      <button className={`nav-item ${active === 'settings' ? 'active' : ''}`} onClick={() => onChange('settings')}><Settings2 size={18} /><span>偏好设置</span></button>
      <button className={`nav-item ${active === 'help' ? 'active' : ''}`} onClick={() => onChange('help')}><CircleHelp size={18} /><span>帮助与诊断</span></button>
    </nav>
  </aside>
})
